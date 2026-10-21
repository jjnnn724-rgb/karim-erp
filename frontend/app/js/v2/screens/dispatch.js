/**
 * V2 — Dispatches screen · شاشة 13 في سجل الترحيل (دورة القرار الكاملة)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * W1-1 (2026-10-15): الشاشة كانت قراءةً فقط؛ صارت تنفّذ دورة الإذن كاملة
 * بنفس عقد الشاشات 01–12 وسجل leaves:
 *   إنشاء (طلب صرف جديد) · اعتماد/رفض الشيف · اعتماد/رفض المخازن ·
 *   استلام القسم بالتوقيع · تعديل قبل اعتماد المخازن · حذف (نهائي للأدمن
 *   وموثّق) · تفاصيل · طباعة الإذن (ورقة A4 بالتواقيع) · طباعة الكشف.
 *
 * قواعد لم تُخترع:
 *   • الباب الواحد للشبكة: js/v2/data/dispatch-repo.js — لا fetch/ apiFetch
 *     في هذا الملف (الاختبارات تفرضه نصيًا).
 *   • نصوص اللوحات والحمولات (payloads) منسوخة من features/kitchen.js حرفًا
 *     بحرف — بما فيها الشواذ المقصودة (requestedQty:actualWeight في الوزن
 *     المتغير، ومفتاح estWeightKg عند الإنشاء).
 *   • بوابة الرصيد = المخزن الرئيسي (/warehouse/main-availability) — نفس
 *     معادلة dispatchStockGate الخادمية، لا إجمالي الأرصدة القديم.
 *   • التواقيع عبر js/v2/signature.js المقفلة على اسم الحساب، ويحسمها
 *     الخادم (requireSignature). بلا اسم حساب لا تُفتح لوحة قرار موقّعة.
 *   • الحذف والحالات: الواجهة تعرض ما يعرضه القديم؛ الكلمة النهائية للخادم.
 *   • الأخطاء تُطبع من ردّ الخادم (e.message) لا من نصوص مخترعة، والتكرار
 *     (409 DUPLICATE_DISPATCH) يُكشف بالرسالة لأن core/api.js:serverErrorInfo
 *     يقرأ data.error لا data.code.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.181';
import { statusBadge, resolveStatus } from '../status.js?v=4.9.181';
import { formatInt } from '../data/employees-repo.js?v=4.9.181';
import { openInAppReport } from '../report-viewer.js?v=4.9.181';
import { formatQty, formatMoney } from '../data/reports-repo.js?v=4.9.181';
import {
    fetchDispatches, dispatchToRow, summarizeDispatches,
    CREATE_ROLES, chainStage, deptCodesOf,
    chefActionsVisible, warehouseActionsVisible, deleteVisible, receiveVisible,
    editVisible, printVisible,
    fetchMainAvailability, fetchDispatchCatalog, catalogItem, arSearchKey, searchCatalog,
    fetchDepartmentOptions, deptNameByCode, fetchDispatchSettings, fetchDispatchFull,
    createDispatch, editDispatch, deleteDispatch,
    chefApproveDispatch, chefRejectDispatch, approveDispatch, rejectDispatch, receiveDispatch,
} from '../data/dispatch-repo.js?v=4.9.181';
import {
    normalizeSignerName, signaturePadMarkup, initSignaturePad, readSignaturePad,
    disposeSignaturePads,
} from '../signature.js?v=4.9.181';

const SIGN_KINDS = new Set(['chef-approve', 'chef-reject', 'approve', 'reject', 'receive']);
const SIG_IDS = {
    chefApprove: 'v2dsp-chef-approve-sig',
    chefReject: 'v2dsp-chef-reject-sig',
    approve: 'v2dsp-approve-sig',
    reject: 'v2dsp-reject-sig',
    receive: 'v2dsp-receive-sig',
};
const ALL_SIG_IDS = Object.values(SIG_IDS);

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Local YYYY-MM-DD (device calendar — same basis as the legacy today()). */
function isoDay(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function firstOfMonth() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
}

/* نفس fD/fDT في core/utils.js لكن بالعربية دائمًا (V2 عربي بالكامل). */
function fD(v) {
    return v ? new Date(v).toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
function fDT(v) {
    return v ? new Date(v).toLocaleString('ar-EG') : '';
}

function signatureErrorText(err) {
    return ({
        SIGNER_NAME_MISSING: 'اسم الموقّع غير متاح في الجلسة — أعد تسجيل الدخول ثم حاول مجددًا',
        SIGNER_MISMATCH: 'التوقيع باسم حسابك فقط — لا يمكن توقيع اسم آخر',
        NO_INK: 'تعذر رسم التوقيع — راجع خانة التوقيع',
        NO_PAD: 'تعذر تهيئة لوحة التوقيع — أعد فتح اللوحة',
    })[err] || 'تعذر قراءة التوقيع';
}

function template(from, to, canCreate) {
    return `
      <section class="erp-card erp-v2-dispatch">
        <div class="erp-card__head">
          <h3 class="erp-card__title">أذون الصرف
            <span class="erp-eyebrow" dir="ltr" lang="en">Dispatch Orders</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <span class="erp-v2-dispatch__tools erp-no-print">
            ${canCreate ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-new>
              <i class="ji" data-i="plus" aria-hidden="true"></i><span>طلب صرف جديد</span>
            </button>` : ''}
            <label class="erp-text-sm erp-text-muted" for="v2dsp-from">من</label>
            <input class="erp-input erp-input--ltr" id="v2dsp-from" type="date" value="${esc(from)}">
            <label class="erp-text-sm erp-text-muted" for="v2dsp-to">إلى</label>
            <input class="erp-input erp-input--ltr" id="v2dsp-to" type="date" value="${esc(to)}" max="${esc(isoDay(0))}">
            <button type="button" class="erp-btn erp-btn--sm" data-v2-clear hidden>عرض الكل</button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-print aria-label="طباعة الكشف">
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span>
            </button>
          </span>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
          <p class="erp-text-sm erp-text-muted">
            دورة الإذن كاملة من هنا (إنشاء · اعتماد الشيف · اعتماد المخازن ·
            استلام بتوقيع · تعديل · حذف · طباعة) — الأزرار حسب الدور، والخادم
            يحسم كل خطوة والتواقيع إلكترونية مقفلة باسم الحساب. الافتراضي الشهر
            الحالي؛ إفراغ التاريخين يعرض الكل.
          </p>
          <div data-v2-panel hidden></div>
          <div data-v2-table></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, userId?: number|string|null, userName?: string|null,
 *          deptCode?: string|null, notify?: (message:string, kind?:string)=>void,
 *          confirmFn?: (message:string)=>boolean|Promise<boolean>}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountDispatchScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 dispatch]', m);
    const confirmFn = typeof ctx.confirmFn === 'function'
        ? ctx.confirmFn
        : (message) => Promise.resolve(window.confirm(message));
    const role = ctx.role ? String(ctx.role) : '';
    const signerName = normalizeSignerName(ctx.userName || '');
    const user = {
        userId: ctx.userId != null ? ctx.userId : null,
        deptCode: ctx.deptCode || '',
        name: signerName,
    };

    let rawRows = [];                       // آخر قراءة خام من الخادم
    let rawById = new Map();
    let loading = false;
    let readSeq = 0;                        // أحدث قراءة تفوز
    let busy = false;                       // قرار واحد في المرة
    let panelSeq = 0;                       // إغلاق اللوحة يُلغي أي تجهيز جارٍ
    let panelKind = null;
    let panelRaw = null;
    let retryState = null;                  // {kind, raw} لإعادة محاولة لوحة فشل تجهيزها
    let formState = null;                   // {catalog, byId, byName, avail, depts}
    let suggestState = [];
    let settingsState = null;               // {name, currency, logoB64} — مرة واحدة

    host.insertAdjacentHTML('beforeend', template(firstOfMonth(), isoDay(0), CREATE_ROLES.includes(role)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const panelEl = q('[data-v2-panel]');
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');
    const clearBtn = q('[data-v2-clear]');

    /* ── العملة والاسم/الشعار — من صف الإعدادات الواحد ─────────────────── */

    async function ensureSettings() {
        if (settingsState) {return settingsState;}
        try {settingsState = await fetchDispatchSettings();}
        catch (_) {settingsState = {name: '', currency: '', logoB64: ''};}
        return settingsState;
    }

    const currencyOf = () => (settingsState && settingsState.currency) || '';

    function moneyText(v) {
        const m = formatMoney(v, currencyOf());
        return m.hasUnit ? `${esc(m.amount)} <span class="erp-text-muted">${esc(m.unit)}</span>` : m.amount;
    }
    function moneyPlain(v) {
        const m = formatMoney(v, currencyOf());
        return m.hasUnit ? `${m.amount} ${m.unit}` : m.amount;
    }

    /* ── الجدول ─────────────────────────────────────────────────────────── */

    const table = createDataTable({
        caption: 'سجل أذون الصرف — بيانات حية',
        mode: 'client',
        pageSize: 20,
        stickyHeader: true,
        emptyMessage: 'لا توجد أذون في الفترة المحددة',
        emptyHint: 'وسّع الفترة أو اعرض الكل.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'id', header: 'الإذن', type: 'number', sortable: true,
                width: '100px', align: 'end', className: 'erp-mono',
                render: (row) => `<span class="erp-num" dir="ltr">#${esc(row.id ?? '؟')}</span>`,
            },
            { key: 'dept', header: 'القسم', sortable: true, filterable: true, width: '150px' },
            {
                key: 'itemsText', header: 'الأصناف والكميات', filterable: true,
                render: (row) => (row.itemsText ? esc(row.itemsText) : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'date', header: 'التاريخ', sortable: true, filterable: true,
                width: '120px', align: 'center', className: 'erp-tnum',
                render: (row) => esc(row.date ? fD(row.date) : '—'),
            },
            {
                key: 'status', header: 'الحالة', sortable: true, filterable: true, width: '190px',
                value: (row) => row.status,
                render: (row) => {
                    if (!row.status) {return `<span class="erp-text-muted">—</span>`;}
                    const stage = chainStage(row._raw || {});
                    return `${statusBadge('dispatch', row.status)}${stage ? `<div class="erp-text-sm erp-text-muted">${esc(stage)}</div>` : ''}`;
                },
            },
            {
                key: 'by', header: 'الطالب', width: '140px',
                render: (row) => (row.by ? esc(row.by) : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'actions', header: 'إجراءات', width: '340px', className: 'erp-v2-dispatch-actions',
                render: (row) => rowActionsHtml(row._raw || {}),
            },
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    function btn(act, id, icon, label, extraClass = '') {
        return `<button type="button" class="erp-btn erp-btn--sm ${extraClass}" data-v2-act="${act}" data-id="${esc(String(id))}">
          <i class="ji" data-i="${icon}" aria-hidden="true"></i><span>${esc(label)}</span></button>`;
    }

    /** أزرار الصف بأيادٍ مرآة لشروط الشاشة القديمة (dispatch-repo يوثّق الأسطر). */
    function rowActionsHtml(raw) {
        if (!raw || raw.id === undefined) {return '—';}
        const id = raw.id;
        const out = [btn('view', id, 'eye', 'عرض')];
        if (printVisible(raw)) {out.push(btn('print', id, 'printer', 'طباعة'));}
        if (editVisible(role, raw, user)) {out.push(btn('edit', id, 'pencil', 'تعديل'));}
        if (chefActionsVisible(role, raw)) {
            out.push(btn('chef-approve', id, 'chef-hat', 'اعتماد الشيف', 'erp-btn--primary'));
            out.push(btn('chef-reject', id, 'circle-x', 'رفض', 'erp-btn--danger'));
        }
        if (warehouseActionsVisible(role, raw)) {
            out.push(btn('approve', id, 'circle-check', 'اعتماد وصرف', 'erp-btn--primary'));
            out.push(btn('reject', id, 'circle-x', 'رفض', 'erp-btn--danger'));
        }
        if (receiveVisible(role, raw, user)) {out.push(btn('receive', id, 'inbox', 'استلام', 'erp-btn--primary'));}
        if (deleteVisible(role, raw)) {out.push(btn('delete', id, 'trash', 'حذف', 'erp-btn--danger'));}
        return out.join('');
    }

    /* ── اللوحة: غلاف ومكوّنات مشتركة ───────────────────────────────────── */

    function panelShell(title, icon, bodyHtml) {
        return `<div class="erp-dispatch-panel">
          <div class="erp-dispatch-panel__head">
            <h3><i class="ji" data-i="${esc(icon)}" aria-hidden="true"></i> ${title}</h3>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close>
              <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
            </button>
          </div>
          <div class="erp-dispatch-panel__body erp-stack">${bodyHtml}</div>
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
          <div class="erp-dispatch-panel__actions">
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
        suggestState = [];
        disposeSignaturePads(ALL_SIG_IDS);
        panelEl.innerHTML = '';
        panelEl.hidden = true;
    }

    const panelAlive = (seq) => el.isConnected && seq === panelSeq;

    function panelMsg(text) {
        const box = panelEl.querySelector('[data-v2-panel-msg]');
        if (box) {box.textContent = text || '';}
        if (text) {notify(text);}
    }

    function readSig(id) {
        const res = readSignaturePad(panelEl, id, signerName);
        if (res.error) {panelMsg(signatureErrorText(res.error)); return null;}
        return res.dataUrl;
    }

    /* ── البيانات المرجعية للنماذج (كتالوج + أرصدة الرئيسي + أقسام) ────── */

    async function loadFormData(needDepts) {
        const jobs = [fetchDispatchCatalog(), fetchMainAvailability()];
        if (needDepts) {jobs.push(fetchDepartmentOptions());}
        const [catalogRows, avail, depts] = await Promise.all(jobs);
        const catalog = catalogRows.map(catalogItem);
        return {
            catalog,
            byId: new Map(catalog.map((c) => [Number(c.id), c])),
            byName: new Map(catalog.map((c) => [arSearchKey(c.name), c])),
            avail,
            depts: depts || [],
        };
    }

    const catOf = (itemName) => (formState ? formState.byName.get(arSearchKey(itemName || '')) || null : null);
    const availOf = (cat) => (cat && formState ? formState.avail.get(Number(cat.id)) || 0 : 0);

    /* ── صفوف الأصناف في نموذج الإنشاء/التعديل ─────────────────────────── */

    function itemRowHtml(entry) {
        const cat = entry.cat || null;
        const name = entry.name || (cat && cat.name) || '';
        const unit = (cat && cat.unit) || entry.unit || 'قطعة';
        const max = cat ? (formState.avail.get(Number(cat.id)) || 0) : 0;
        const headClose = `<span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-remove-item
                  aria-label="إزالة الصنف ${esc(name)}"><i class="ji" data-i="trash" aria-hidden="true"></i></button>`;
        if (entry.cw) {
            const pkgUom = (cat && cat.packagingUom) || entry.packagingUom || 'كرتون';
            return `<div class="erp-di" data-di data-item-id="${cat ? esc(cat.id) : ''}"
                         data-name="${esc(name)}" data-cw="1" data-unit="${esc(pkgUom)}" data-pkg-uom="${esc(pkgUom)}">
              <div class="erp-di__head">
                <strong>${esc(name)}</strong>
                <span class="erp-badge" data-tone="info">وزن متغير</span>
                <span class="erp-text-sm erp-text-muted">${cat ? (max > 0 ? `المتاح في المخزن الرئيسي: ${formatQty(max)} كجم` : '⚠ لا رصيد حاليًا في المخزن الرئيسي') : '⚠ الصنف غير موجود في المخزن حاليًا'}</span>
                ${headClose}
              </div>
              <div class="erp-di__fields">
                <label class="erp-field"><span class="erp-label">عدد الكراتين *</span>
                  <input class="erp-input" type="number" data-f="pkg" min="1" step="1" value="${entry.pkg ?? ''}"
                         inputmode="numeric" aria-label="عدد الكراتين ${esc(name)}">
                </label>
                <span class="erp-text-sm erp-text-muted" data-di-est></span>
              </div>
            </div>`;
        }
        const units = cat ? [{ uom: cat.unit, factor: 1 }, ...cat.secondaryUnits] : [{ uom: unit, factor: 1 }];
        const selected = entry.uom || '';
        const extra = selected && !units.some((u) => u.uom === selected) ? [{ uom: selected, factor: 1 }] : [];
        const list = [...units, ...extra];
        const selVal = selected ? selected : units[0].uom;
        const opts = list.map((u) => `<option value="${esc(u.uom)}" data-factor="${u.factor}" ${u.uom === selVal ? 'selected' : ''}>${esc(u.uom)}</option>`).join('');
        return `<div class="erp-di" data-di data-item-id="${cat ? esc(cat.id) : ''}"
                     data-name="${esc(name)}" data-cw="0" data-unit="${esc(unit)}">
          <div class="erp-di__head">
            <strong>${esc(name)}</strong>
            <span class="erp-text-sm erp-text-muted">${cat ? `المتاح في المخزن الرئيسي: ${formatQty(max)} ${esc(unit)}` : '⚠ الصنف غير موجود في المخزن حاليًا'}</span>
            ${headClose}
          </div>
          <div class="erp-di__fields">
            <label class="erp-field"><span class="erp-label">الكمية *</span>
              <input class="erp-input" type="number" data-f="qty" min="0" step="0.001" value="${entry.qty ?? ''}"
                     inputmode="decimal" aria-label="كمية ${esc(name)}">
            </label>
            <label class="erp-field"><span class="erp-label">وحدة الطلب</span>
              <select class="erp-select" data-f="uom" aria-label="وحدة ${esc(name)}">${opts}</select>
            </label>
            <span class="erp-text-sm erp-text-muted" data-di-eq></span>
          </div>
        </div>`;
    }

    function updateFormSummary() {
        let count = 0;
        for (const row of panelEl.querySelectorAll('[data-di]')) {
            const cat = row.dataset.itemId ? (formState && formState.byId.get(Number(row.dataset.itemId))) : null;
            if (row.dataset.cw === '1') {
                const boxes = parseInt(row.querySelector('[data-f=pkg]')?.value, 10) || 0;
                const avgBox = cat ? cat.avgBoxPerCrate : 0;
                const est = avgBox > 0 ? Math.round(boxes * avgBox * 1000) / 1000 : 0;
                const estEl = row.querySelector('[data-di-est]');
                if (estEl) {
                    estEl.textContent = est > 0
                        ? `الوزن التقديري المتوقع: ~${formatQty(est)} كجم — الصرف بالوزن الفعلي من الميزان`
                        : 'يُصرف بالوزن الفعلي من الميزان';
                }
            } else {
                const qty = parseFloat(row.querySelector('[data-f=qty]')?.value) || 0;
                const sel = row.querySelector('[data-f=uom]');
                const opt = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
                const factor = opt ? Number(opt.dataset.factor || 1) : 1;
                const unit = sel && sel.options[0] ? sel.options[0].value : (row.dataset.unit || '');
                const eqEl = row.querySelector('[data-di-eq]');
                if (eqEl) {
                    eqEl.textContent = (factor !== 1 && qty > 0)
                        ? `= ${formatQty(Math.round(qty * factor * 1000) / 1000)} ${unit}`
                        : '';
                }
            }
            count += 1;
        }
        const sumEl = panelEl.querySelector('[data-v2-form-summary]');
        if (sumEl) {sumEl.textContent = `عدد الأصناف: ${formatInt(count)}`;}
    }

    function updateSuggestions() {
        const input = panelEl.querySelector('[data-v2-item-search]');
        const box = panelEl.querySelector('[data-v2-suggest]');
        if (!input || !box) {return;}
        const query = input.value.trim();
        if (!query) {
            suggestState = [];
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        suggestState = searchCatalog(formState.catalog, query, (i) => formState.avail.get(Number(i.id)) || 0);
        if (!suggestState.length) {
            box.innerHTML = '<div class="erp-text-sm erp-text-muted erp-di-sug__empty">لا أصناف مطابقة برصيد في المخزن الرئيسي</div>';
            box.hidden = false;
            return;
        }
        box.innerHTML = suggestState.map((i, idx) => {
            const on = formState.avail.get(Number(i.id)) || 0;
            return `<button type="button" class="erp-di-sug__item" data-v2-sug="${idx}">
              <strong>${esc(i.name)}</strong>
              <span class="erp-text-sm erp-text-muted">المتاح: ${formatQty(on)} ${esc(i.unit)}${i.catchWeight ? ' · وزن متغير' : ''}</span>
            </button>`;
        }).join('');
        box.hidden = false;
    }

    function addSuggestion(idx) {
        const cat = suggestState[idx];
        if (!cat || !formState) {return;}
        const dup = [...panelEl.querySelectorAll('[data-di]')]
            .some((r) => r.dataset.itemId && Number(r.dataset.itemId) === Number(cat.id));
        if (dup) {notify(`"${cat.name}" مضاف بالفعل في الطلب`); return;}
        const container = panelEl.querySelector('[data-v2-items]');
        if (!container) {return;}
        container.insertAdjacentHTML('beforeend', itemRowHtml({ cat, cw: cat.catchWeight, name: cat.name }));
        const input = panelEl.querySelector('[data-v2-item-search]');
        if (input) {input.value = '';}
        const box = panelEl.querySelector('[data-v2-suggest]');
        if (box) {box.hidden = true; box.innerHTML = '';}
        suggestState = [];
        updateFormSummary();
    }

    /** تجميع أصناف النموذج — نفس حمولة القديم حرفًا (estWeightKg للوزن المتغير،
     *  والتحويل الفوري للوحدة الثانوية). فحوص الرصيد للإنشاء فقط كما في القديم
     *  (التعديل الخادمي بلا بوابة رصيد — بوابة الاعتماد هي الحاكمة). */
    function collectFormItems(mode) {
        const items = [];
        for (const row of panelEl.querySelectorAll('[data-di]')) {
            const name = row.dataset.name || '';
            const cat = row.dataset.itemId ? (formState && formState.byId.get(Number(row.dataset.itemId))) : null;
            const max = cat ? (formState.avail.get(Number(cat.id)) || 0) : 0;
            if (row.dataset.cw === '1') {
                const boxes = parseInt(row.querySelector('[data-f=pkg]')?.value, 10) || 0;
                const pkgUom = (cat && cat.packagingUom) || row.dataset.pkgUom || 'كرتون';
                const avgBox = cat ? cat.avgBoxPerCrate : 0;
                const estKg = avgBox > 0 ? Math.round(boxes * avgBox * 1000) / 1000 : 0;
                if (name && boxes > 0) {
                    if (mode === 'create' && !(max > 0)) {
                        panelMsg(`لا يوجد أي رصيد من "${name}" في المخزن — لا يُقبل في طلب صرف`);
                        return null;
                    }
                    items.push({ itemName: name, qty: boxes, unit: pkgUom, packagingQty: boxes, packagingUom: pkgUom, estWeightKg: estKg || null });
                }
                continue;
            }
            const qty = parseFloat(row.querySelector('[data-f=qty]')?.value) || 0;
            const sel = row.querySelector('[data-f=uom]');
            const opt = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
            const factor = opt ? Number(opt.dataset.factor || 1) : 1;
            const baseUnit = (sel && sel.options[0] ? sel.options[0].value : row.dataset.unit) || 'قطعة';
            if (!(name && qty > 0)) {continue;}
            const baseQty = factor !== 1 ? Math.round(qty * factor * 1000) / 1000 : qty;
            if (mode === 'create' && baseQty > max + 1e-6) {
                panelMsg(`الرصيد غير كافٍ من "${name}": المتاح ${formatQty(max)} فقط ولا يمكن طلب ${formatQty(baseQty)}`);
                return null;
            }
            if (factor !== 1 && opt) {
                items.push({ itemName: name, qty: baseQty, unit: baseUnit, requestedQty: qty, requestedUom: opt.value });
            } else {
                items.push({ itemName: name, qty, unit: baseUnit });
            }
        }
        return items;
    }

    /* ── نموذج الإنشاء/التعديل ──────────────────────────────────────────── */

    function formHtml(kind, raw) {
        const isEdit = kind === 'edit';
        const depts = formState.depts || [];
        let deptField;
        if (role === 'dept_head') {
            const code = isEdit ? (raw.deptCode || '') : (deptCodesOf(user)[0] || '');
            const name = deptNameByCode(depts, code) || code || '—';
            deptField = `<div class="erp-field"><span class="erp-label">القسم الطالب</span>
              <input class="erp-input" type="text" value="${esc(name)}" readonly aria-readonly="true">
              <small class="erp-text-sm erp-text-muted">رئيس القسم ينشئ ويعدّل لقسمه فقط — والقرار للخادم.</small></div>`;
        } else {
            const sel = isEdit ? String(raw.deptCode || '').toLowerCase() : '';
            deptField = `<label class="erp-field"><span class="erp-label">${isEdit ? 'القسم الطالب (يمكن نقله لقسم آخر)' : 'القسم الطالب *'}</span>
              <select class="erp-select" data-f="dept">
                <option value="">— اختر القسم —</option>
                ${depts.map((d) => `<option value="${esc(d.code)}" ${String(d.code).toLowerCase() === sel ? 'selected' : ''}>${esc(d.name || d.code)}</option>`).join('')}
              </select></label>`;
        }
        const prefill = isEdit && Array.isArray(raw.items) ? raw.items.map((it) => {
            const cat = catOf(it.itemName || it.name);
            if (cat && cat.catchWeight) {
                return itemRowHtml({ cat, cw: true, pkg: it.packagingQty ?? it.qty ?? '', packagingUom: it.packagingUom });
            }
            return itemRowHtml({
                cat, cw: false,
                qty: it.requestedQty ?? it.qty ?? '',
                uom: it.requestedUom || '',
                unit: it.unit || '',
            });
        }).join('') : '';
        return panelShell(
            `${isEdit ? 'تعديل إذن الصرف' : 'طلب صرف جديد'}${isEdit && raw.deptName ? ` — ${esc(raw.deptName)}` : ''}`,
            isEdit ? 'pencil' : 'plus',
            `${deptField}
             ${isEdit && raw.status === 'chef_approved'
                ? '<div class="erp-flow-note" data-tone="warning">⚠ هذا الطلب معتمد من الشيف — الحفظ <strong>يلغي الاعتماد</strong> ويرجعه للمراجعة على الأرقام الجديدة</div>'
                : ''}
             <div class="erp-flow-note" data-tone="info">
               ابحث عن الصنف من المخزن واختره — <strong>المتاح</strong> المعروض هو رصيد
               المخزن الرئيسي وحده (نفس بوابة الخادم)، والصنف صفر الرصيد لا يُعرض.
             </div>
             <label class="erp-field"><span class="erp-label" for="v2dsp-item-search">إضافة صنف من المخزن</span>
               <input class="erp-input" type="search" id="v2dsp-item-search" data-v2-item-search
                      placeholder="ابحث باسم الصنف أو الباركود…" autocomplete="off">
             </label>
             <div class="erp-di-sug" data-v2-suggest hidden></div>
             <div class="erp-stack" data-v2-items>${prefill}</div>
             ${isEdit
                ? `<label class="erp-field"><span class="erp-label">سبب التعديل (يُوثَّق في سجل الطلب)</span>
                     <input class="erp-input" data-f="reason" placeholder="مثال: تعديل كميات بعد الجرد">
                   </label>`
                : `<label class="erp-field"><span class="erp-label">ملاحظات الطلب</span>
                     <textarea class="erp-input" data-f="notes" rows="2"></textarea>
                   </label>`}
             <div class="erp-text-sm erp-text-muted" data-v2-form-summary></div>
             ${panelActions(isEdit ? 'حفظ التعديل' : 'إرسال الطلب', isEdit ? 'save' : 'send')}`);
    }

    async function openFormPanel(kind, raw, seq) {
        setPanel(panelLoading(kind === 'edit' ? 'تعديل إذن الصرف' : 'طلب صرف جديد', kind === 'edit' ? 'pencil' : 'plus'));
        try {
            formState = await loadFormData(true);
            if (!panelAlive(seq)) {return;}
            setPanel(formHtml(kind, raw));
            updateFormSummary();
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            retryState = { kind, raw };
            setPanel(panelRetry(kind === 'edit' ? 'تعديل إذن الصرف' : 'طلب صرف جديد',
                kind === 'edit' ? 'pencil' : 'plus',
                `تعذر تجهيز النموذج: ${(e && e.message) || 'خطأ في القراءة'}`));
        }
    }

    async function submitCreate() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        let deptCode;
        if (role === 'dept_head') {
            deptCode = deptCodesOf(user)[0] || '';
        } else {
            deptCode = panelEl.querySelector('[data-f=dept]')?.value || '';
            if (!deptCode) {panelMsg('حدد القسم الطالب'); return;}
        }
        const notes = panelEl.querySelector('[data-f=notes]')?.value.trim() || '';
        const items = collectFormItems('create');
        if (items === null) {return;}
        if (!items.length) {panelMsg('أضف صنفًا واحدًا على الأقل'); return;}
        const deptName = deptNameByCode(formState.depts, deptCode) || undefined;
        busy = true;
        try {
            await createDispatch({ deptCode, deptName, items, notes, status: 'pending', date: isoDay(0) });
            closePanel();
            notify(role === 'dept_head'
                ? 'تم إرسال طلب الصرف — بانتظار اعتماد الشيف العمومي'
                : 'تم إرسال طلب الصرف');
            await reload();
        } catch (e) {
            const m = String((e && e.message) || '');
            if ((e && e.code === 'DUPLICATE_DISPATCH') || /مكرر|مشابه|DUPLICATE/.test(m)) {
                panelMsg('الطلب مسجل بالفعل — لم يتكرر');
            } else {
                panelMsg(m || 'تعذر إرسال طلب الصرف — راجع أرصدة المخزن');
            }
        } finally {
            busy = false;
        }
    }

    async function submitEdit() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const raw = panelRaw;
        if (!raw) {return;}
        const items = collectFormItems('edit');
        if (items === null) {return;}
        if (!items.length) {panelMsg('اكتب صنفًا واحدًا على الأقل باسم وكمية صحيحة'); return;}
        const reason = panelEl.querySelector('[data-f=reason]')?.value.trim() || '';
        const deptCode = role === 'dept_head'
            ? undefined
            : (panelEl.querySelector('[data-f=dept]')?.value || undefined);
        busy = true;
        try {
            const res = await editDispatch(raw.id, { items, deptCode, reason });
            closePanel();
            notify(res && res.chefApprovalReset
                ? 'تم التعديل — أُلغي اعتماد الشيف وأُعيد الطلب للمراجعة'
                : 'تم تعديل الإذن بنجاح');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'فشل تعديل الإذن');
        } finally {
            busy = false;
        }
    }

    /* ── لوحات القرار ──────────────────────────────────────────────────── */

    function chefApproveHtml(raw) {
        const items = Array.isArray(raw.items) ? raw.items : [];
        const rows = items.map((item) => {
            const cat = catOf(item.itemName || item.name);
            const onHand = availOf(cat);
            const isCw = !!(cat && cat.catchWeight);
            const req = Number(item.qty) || 0;
            const short = isCw ? !(onHand > 0) : onHand < req;
            const unit = isCw ? 'كجم' : ((cat && cat.unit) || item.unit || '');
            return `<div class="erp-flow-note" data-tone="${short ? 'danger' : 'success'}">
              <div class="erp-dispatch-line__row">
                <strong>${esc(item.itemName)}</strong>
                ${isCw ? '<span class="erp-badge" data-tone="info">وزن متغير</span>' : ''}
                <span class="erp-badge" data-tone="${short ? 'danger' : 'success'}">المتاح: ${formatQty(onHand)} ${esc(unit)}</span>
              </div>
              <div class="erp-text-sm erp-text-muted">المطلوب: ${formatQty(req)} ${esc(item.unit || '')}${isCw ? ' — الوزن الفعلي من الميزان عند الصرف' : ''}</div>
              ${short ? '<div class="erp-dispatch-line__flag erp-text-sm"><i class="ji" data-i="alert-triangle" aria-hidden="true"></i> الرصيد غير كافٍ — لا يمكن اعتماد الإذن، عدِّل الكمية أو جهّز المخزون أولًا</div>' : ''}
            </div>`;
        }).join('');
        const blocked = items.some((item) => {
            const cat = catOf(item.itemName || item.name);
            const onHand = availOf(cat);
            const isCw = !!(cat && cat.catchWeight);
            return isCw ? !(onHand > 0) : onHand < (Number(item.qty) || 0);
        });
        return panelShell(`اعتماد الشيف العمومي — ${esc(raw.deptName || '')}`, 'chef-hat',
            `<div class="erp-flow-note" data-tone="info">اعتمادك ينقل الطلب إلى <strong>المخازن</strong> للصرف والخصم — لا يُخصم أي مخزون بهذه الخطوة.</div>
             ${rows}
             ${blocked ? '<div class="erp-flow-note" data-tone="danger"><i class="ji" data-i="circle-x" aria-hidden="true"></i> <strong>لا يمكن الاعتماد:</strong> يوجد أصناف بلا رصيد كافٍ في المخزن — لا يُقبل إذن صرف بلا رصيد نهائيًا. عدِّل الكميات أو جهّز المخزون.</div>' : ''}
             <label class="erp-field"><span class="erp-label">ملاحظات الشيف (اختياري)</span>
               <textarea class="erp-input" data-f="notes" rows="2"></textarea></label>
             ${signaturePadMarkup(SIG_IDS.chefApprove, 'توقيع الشيف العمومي', signerName)}
             ${panelActions('اعتماد وإحالة للمخازن', 'circle-check',
                blocked ? '<span class="erp-badge" data-tone="danger">يوجد أصناف بلا رصيد كافٍ</span>' : '', blocked)}`);
    }

    function chefRejectHtml(raw) {
        const names = (Array.isArray(raw.items) ? raw.items : []).map((i) => i.itemName).filter(Boolean).join('، ');
        return panelShell(`رفض الشيف العمومي — ${esc(raw.deptName || '')}`, 'circle-x',
            `<div class="erp-flow-note" data-tone="warning"><strong>الأصناف:</strong> ${esc(names || '—')}</div>
             <label class="erp-field"><span class="erp-label">سبب الرفض</span>
               <textarea class="erp-input" data-f="reason" rows="3"
                 placeholder="مثال: الكمية كبيرة على احتياج القسم / الصنف غير مناسب"></textarea></label>
             ${signaturePadMarkup(SIG_IDS.chefReject, 'توقيع الشيف العمومي على الرفض', signerName)}
             ${panelActions('تأكيد الرفض', 'circle-x')}`);
    }

    function approveHtml(raw) {
        const items = Array.isArray(raw.items) ? raw.items : [];
        let total = 0;
        const rows = items.map((item, idx) => {
            const cat = catOf(item.itemName || item.name);
            const onHand = availOf(cat);
            const avgCost = cat ? cat.avgCost : 0;
            const isCw = !!(cat && cat.catchWeight);
            const pkgUom = (cat && cat.packagingUom) || item.packagingUom || 'كرتون';
            const cwUom = (cat && cat.catchWeightUom) || 'kg';
            const dataAttrs = `data-ap-row="${idx}" data-cw="${isCw ? 1 : 0}" data-cost="${avgCost}" data-max="${onHand}"
                 data-avgbox="${cat ? cat.avgBoxPerCrate : 0}" data-pkg-uom="${esc(pkgUom)}" data-cw-uom="${esc(cwUom)}"`;
            if (!isCw) {
                const q0 = Math.min(Number(item.qty) || 0, onHand);
                total += q0 * avgCost;
                return `<div class="erp-dispatch-line" ${dataAttrs}>
                  <div class="erp-dispatch-line__row">
                    <strong>${esc(item.itemName)}</strong>
                    <span class="erp-text-sm erp-text-muted">المتاح: ${formatQty(onHand)} | المطلوب: ${formatQty(item.qty)}${item.requestedUom && item.requestedQty ? ` <span class="erp-badge" data-tone="brand">طلب بـ ${formatQty(item.requestedQty)} ${esc(item.requestedUom)}</span>` : ''}</span>
                  </div>
                  <div class="erp-di__fields">
                    <label class="erp-field"><span class="erp-label">الكمية المعتمدة</span>
                      <input class="erp-input" type="number" data-ap="qty" step="0.001" min="0" max="${onHand}" value="${q0}">
                    </label>
                    <div class="erp-field"><span class="erp-label">القيمة</span>
                      <div data-ap="val" class="erp-num">${moneyText(q0 * avgCost)}</div>
                    </div>
                  </div>
                  ${onHand < (Number(item.qty) || 0) ? '<div class="erp-dispatch-line__flag erp-text-sm"><i class="ji" data-i="alert-triangle" aria-hidden="true"></i> الكمية المطلوبة أكبر من المتوفر</div>' : ''}
                </div>`;
            }
            const reqBoxes = Number(item.packagingQty ?? item.qty) || 0;
            return `<div class="erp-dispatch-line" ${dataAttrs}>
              <div class="erp-dispatch-line__row">
                <strong>${esc(item.itemName)}</strong>
                <span class="erp-badge" data-tone="info">وزن متغير</span>
                <span class="erp-text-sm erp-text-muted">المطلوب: <b>${formatQty(reqBoxes)} ${esc(pkgUom)}</b> | المتاح: ${formatQty(onHand)} كجم</span>
              </div>
              <div class="erp-di__fields">
                <label class="erp-field"><span class="erp-label">عدد الكراتين المصروفة *</span>
                  <input class="erp-input" type="number" data-ap="pkg" step="1" min="1" value="${reqBoxes || ''}" placeholder="عدد الكراتين">
                </label>
                <label class="erp-field"><span class="erp-label">الوزن الفعلي بالكيلو (الميزان) *</span>
                  <input class="erp-input" type="number" data-ap="weight" step="0.001" min="0.001" max="${onHand}" placeholder="أوزن الكراتين وأدخل الوزن">
                </label>
                <div class="erp-field"><span class="erp-label">القيمة (على الفعلي)</span>
                  <div data-ap="val" class="erp-num">${moneyText(0)}</div>
                </div>
              </div>
              <div class="erp-text-sm erp-text-muted" data-ap="est"></div>
              <div class="erp-text-sm erp-text-muted" data-ap="avg"></div>
            </div>`;
        }).join('');
        return panelShell(`الموافقة على طلب صرف — ${esc(raw.deptName || '')}`, 'circle-check',
            `<div class="erp-flow-note" data-tone="warning">اعتماد المخزن <strong>يخصم الكمية من المخزون ويسجل تكلفة القسم في نفس المعاملة</strong> — راجع الكميات والوزن الفعلي قبل التأكيد.</div>
             <div class="erp-stack">${rows}</div>
             <div class="erp-flow-note" data-tone="brand"><i class="ji" data-i="banknote" aria-hidden="true"></i> القيمة الإجمالية:
               <strong data-v2-approve-total>${moneyText(total)}</strong></div>
             <label class="erp-field"><span class="erp-label">ملاحظات الاعتماد</span>
               <textarea class="erp-input" data-f="notes" rows="2"></textarea></label>
             ${signaturePadMarkup(SIG_IDS.approve, 'توقيع أمين المخزن المعتمد', signerName)}
             ${panelActions('تأكيد الموافقة', 'circle-check')}`);
    }

    function updateApproveTotal() {
        let total = 0;
        for (const row of panelEl.querySelectorAll('[data-ap-row]')) {
            const cost = Number(row.dataset.cost) || 0;
            if (row.dataset.cw === '1') {
                const weight = parseFloat(row.querySelector('[data-ap=weight]')?.value) || 0;
                const boxes = parseFloat(row.querySelector('[data-ap=pkg]')?.value) || 0;
                total += weight * cost;
                const valEl = row.querySelector('[data-ap=val]');
                if (valEl) {valEl.innerHTML = moneyText(weight * cost);}
                const avgEl = row.querySelector('[data-ap=avg]');
                if (avgEl) {avgEl.textContent = (weight > 0 && boxes > 0) ? `متوسط الكرتون المحسوب: ${formatQty(weight / boxes)} كجم` : '';}
                const estEl = row.querySelector('[data-ap=est]');
                if (estEl) {
                    const avgBox = Number(row.dataset.avgbox) || 0;
                    const est = boxes * avgBox;
                    if (est > 0 && boxes > 0) {
                        const diff = weight > 0 ? Math.round((weight - est) * 1000) / 1000 : null;
                        const diffPct = (diff != null && est > 0) ? Math.round(diff / est * 1000) / 10 : null;
                        estEl.textContent = `الوزن التقديري المتوقع: ~${formatQty(Math.round(est * 1000) / 1000)} كجم${diff != null ? ` — فرق الميزان: ${diff >= 0 ? '+' : ''}${formatQty(diff)} كجم (${diffPct > 0 ? '+' : ''}${diffPct}%)` : ''}`;
                    } else {
                        estEl.textContent = '';
                    }
                }
            } else {
                const qty = parseFloat(row.querySelector('[data-ap=qty]')?.value) || 0;
                total += qty * cost;
                const valEl = row.querySelector('[data-ap=val]');
                if (valEl) {valEl.innerHTML = moneyText(qty * cost);}
            }
        }
        const totalEl = panelEl.querySelector('[data-v2-approve-total]');
        if (totalEl) {totalEl.innerHTML = moneyText(total);}
    }

    function rejectHtml(raw) {
        const count = Array.isArray(raw.items) ? raw.items.length : 0;
        return panelShell('رفض طلب صرف', 'circle-x',
            `<div class="erp-flow-note" data-tone="warning"><strong>القسم:</strong> ${esc(raw.deptName || '—')}<br><strong>الأصناف:</strong> ${formatInt(count)}</div>
             <label class="erp-field"><span class="erp-label">سبب الرفض</span>
               <textarea class="erp-input" data-f="reason" rows="3"></textarea></label>
             ${signaturePadMarkup(SIG_IDS.reject, 'توقيع أمين المخزن على الرفض', signerName)}
             ${panelActions('تأكيد الرفض', 'circle-x')}`);
    }

    function receiveHtml(raw) {
        const items = (raw.approvedItems && raw.approvedItems.length ? raw.approvedItems : raw.items) || [];
        const rows = items.map((item, idx) => {
            const approved = Number(item.approvedQty ?? item.qty) || 0;
            const isCw = Boolean(item.catchWeightEnabled || item.actualWeight);
            const apBoxes = Number(item.packagingQty) || 0;
            const pkgUom = item.packagingUom || 'كرتون';
            return `<div class="erp-dispatch-line" data-ap-row="${idx}" data-cw="${isCw ? 1 : 0}"
                         data-approved="${approved}" data-apboxes="${apBoxes}">
              <div class="erp-dispatch-line__row">
                <strong>${esc(item.itemName || item.name)}</strong>
                ${isCw ? '<span class="erp-badge" data-tone="info">وزن متغير</span>' : ''}
                <span class="erp-badge" data-tone="info">المعتمد: ${formatQty(approved)} ${esc(item.unit || '')}${isCw && apBoxes > 0 ? ` (${formatQty(apBoxes)} ${esc(pkgUom)})` : ''}</span>
              </div>
              <div class="erp-di__fields">
                <label class="erp-field"><span class="erp-label">${isCw ? 'الوزن المستلم فعليًا (كجم)' : 'الكمية المستلمة'}</span>
                  <input class="erp-input" type="number" data-ap="recv" min="0" max="${approved}" step="0.001" value="${approved}">
                </label>
                ${isCw ? `<label class="erp-field"><span class="erp-label">عدد الكراتين المستلمة</span>
                  <input class="erp-input" type="number" data-ap="recvpkg" min="0" max="${apBoxes || ''}" step="1" value="${apBoxes || ''}">
                </label>` : ''}
              </div>
            </div>`;
        }).join('');
        return panelShell(`استلام إذن الصرف — ${esc(raw.deptName || '')}`, 'inbox',
            `<div class="erp-flow-note" data-tone="info">الاستلام والتوقيع باسم حسابك فقط (<strong>${esc(signerName || '—')}</strong>) — لا يمكن توقيع أي اسم آخر. راجع الكميات ثم أكّد. لا يمكن تسجيل الاستلام مرتين.</div>
             <div class="erp-stack">${rows}</div>
             <label class="erp-field"><span class="erp-label">ملاحظات الاستلام</span>
               <textarea class="erp-input" data-f="notes" rows="2" placeholder="أي عجز أو تلف أو ملاحظة عند الاستلام"></textarea></label>
             ${signaturePadMarkup(SIG_IDS.receive, `توقيع المستلم — ${signerName}`, signerName)}
             ${panelActions('تأكيد الاستلام والتوقيع', 'inbox')}`);
    }

    function detailsHtml(raw) {
        const source = (raw.approvedItems && raw.approvedItems.length ? raw.approvedItems : raw.items) || [];
        const chefAudit = raw.chefApprovedAt
            ? `<div class="erp-flow-note" data-tone="info"><i class="ji" data-i="chef-hat" aria-hidden="true"></i> اعتمد <strong>الشيف العمومي</strong> الطلب بواسطة <strong>${esc(raw.chefApprovedBy || '—')}</strong> بتاريخ ${esc(fDT(raw.chefApprovedAt))} وأحاله إلى المخازن.</div>`
            : (raw.needsChefApproval
                ? `<div class="erp-flow-note" data-tone="warning"><i class="ji" data-i="hourglass" aria-hidden="true"></i> الطلب مقدم من <strong>رئيس القسم</strong> — بانتظار اعتماد الشيف العمومي قبل وصوله للمخازن.</div>`
                : '');
        const receiptAudit = raw.kitchenReceivedAt
            ? `<div class="erp-flow-note" data-tone="success"><i class="ji" data-i="circle-check" aria-hidden="true"></i> تم استلام الإذن وتوقيعه من ${esc(raw.deptName)} بواسطة <strong>${esc(raw.kitchenReceivedBy || '—')}</strong> بتاريخ ${esc(fDT(raw.kitchenReceivedAt))}.<br><small>التوقيع الإلكتروني محفوظ ضمن سجل الإذن.</small></div>`
            : '<div class="erp-flow-note" data-tone="info">الإذن معتمد من المخازن ولم يتم تسجيل استلام القسم وتوقيعه بعد.</div>';
        const rowsHtml = source.map((item) => {
            const cw = item.catchWeightEnabled || item.actualWeight;
            const q = cw && item.packagingQty
                ? `${formatQty(item.approvedQty || item.qty || 0)} ${esc(item.catchWeightUom || item.unit || 'كجم')} <small class="erp-text-muted">(${formatQty(item.packagingQty)} ${esc(item.packagingUom || 'كرتون')})</small>`
                : formatQty(item.approvedQty || item.qty || 0);
            return `<tr>
              <td class="erp-td fw-bold">${esc(item.itemName || item.name)}${cw ? ' <span class="erp-badge" data-tone="info">وزن متغير</span>' : ''}</td>
              <td class="erp-td">${esc(item.unit || '—')}</td>
              <td class="erp-td erp-tnum">${q}</td>
              <td class="erp-td erp-tnum">${item.approvedValue ? moneyText(item.approvedValue) : '—'}</td>
            </tr>`;
        }).join('');
        return panelShell(`تفاصيل طلب الصرف #${esc(raw.id)}`, 'clipboard-list',
            `<div class="details-list">
               <div class="details-item"><strong>القسم:</strong> <span>${esc(raw.deptName || '—')}</span></div>
               <div class="details-item"><strong>الحالة:</strong> <span>${statusBadge('dispatch', raw.status)}</span></div>
               <div class="details-item"><strong>التاريخ:</strong> <span>${esc(fD(raw.date))}</span></div>
               <div class="details-item"><strong>الطالب:</strong> <span>${esc(raw.createdBy || '—')}${raw.creatorRole === 'dept_head' ? ' <span class="erp-badge" data-tone="brand">رئيس قسم</span>' : ''}</span></div>
               <div class="details-item"><strong>المرحلة الحالية:</strong> <span>${esc(chainStage(raw) || '—')}</span></div>
             </div>
             <div class="tbl-wrap">
               <table class="erp-table__grid">
                 <thead><tr><th class="erp-th">الصنف</th><th class="erp-th">الوحدة</th><th class="erp-th">الكمية</th><th class="erp-th">القيمة</th></tr></thead>
                 <tbody>${rowsHtml || '<tr><td class="erp-td" colspan="4">لا أصناف</td></tr>'}</tbody>
               </table>
             </div>
             <div class="details-list">
               <div class="details-item"><strong>ملاحظات الطلب:</strong> <span>${esc(raw.notes || '—')}</span></div>
               ${raw.approveNotes ? `<div class="details-item"><strong>ملاحظات الاعتماد:</strong> <span>${esc(raw.approveNotes)}</span></div>` : ''}
               ${raw.rejectionReason ? `<div class="details-item"><strong>سبب الرفض:</strong> <span>${esc(raw.rejectionReason)}</span></div>` : ''}
             </div>
             ${chefAudit}${receiptAudit}
             <div class="erp-dispatch-panel__actions">
               <span class="erp-grow"></span>
               <button type="button" class="erp-btn erp-btn--primary" data-v2-panel-close>إغلاق</button>
             </div>`);
    }

    /* ── فتح اللوحة وتوجيه الأزرار ─────────────────────────────────────── */

    async function openPanel(kind, raw) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (SIGN_KINDS.has(kind) && !signerName) {
            notify('اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع');
            return;
        }
        if (kind === 'edit' && !editVisible(role, raw, user)) {
            notify('التعديل متاح قبل اعتماد المخازن فقط');
            return;
        }
        if (kind === 'create' && !CREATE_ROLES.includes(role)) {
            notify('لا صلاحية لإنشاء طلب صرف بهذا الحساب');
            return;
        }
        closePanel();
        const seq = panelSeq;
        panelKind = kind;
        panelRaw = raw;
        panelEl.hidden = false;

        if (kind === 'create' || kind === 'edit') {await openFormPanel(kind, raw, seq); return;}
        if (kind === 'view') {
            await ensureSettings();
            if (!panelAlive(seq)) {return;}
            setPanel(detailsHtml(raw));
            return;
        }
        if (kind === 'chef-approve' || kind === 'approve') {
            const title = kind === 'chef-approve' ? 'اعتماد الشيف العمومي' : 'الموافقة على طلب صرف';
            const icon = kind === 'chef-approve' ? 'chef-hat' : 'circle-check';
            setPanel(panelLoading(title, icon));
            await ensureSettings();
            try {
                formState = await loadFormData(false);
                if (!panelAlive(seq)) {return;}
                if (kind === 'chef-approve') {
                    setPanel(chefApproveHtml(raw));
                    initSignaturePad(panelEl, SIG_IDS.chefApprove, signerName);
                } else {
                    setPanel(approveHtml(raw));
                    initSignaturePad(panelEl, SIG_IDS.approve, signerName);
                    updateApproveTotal();
                }
            } catch (e) {
                if (!panelAlive(seq)) {return;}
                retryState = { kind, raw };
                setPanel(panelRetry(title, icon, `تعذر تجهيز اللوحة: ${(e && e.message) || 'خطأ في القراءة'}`));
            }
            return;
        }
        if (kind === 'chef-reject') {
            setPanel(chefRejectHtml(raw));
            initSignaturePad(panelEl, SIG_IDS.chefReject, signerName);
            return;
        }
        if (kind === 'reject') {
            setPanel(rejectHtml(raw));
            initSignaturePad(panelEl, SIG_IDS.reject, signerName);
            return;
        }
        if (kind === 'receive') {
            await ensureSettings();
            if (!panelAlive(seq)) {return;}
            setPanel(receiveHtml(raw));
            initSignaturePad(panelEl, SIG_IDS.receive, signerName);
        }
    }

    async function confirmDelete(raw) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const st = resolveStatus('dispatch', raw.status);
        const label = (st && st.label) ? st.label : (raw.status || '');
        const strong = role === 'admin' && String(raw.status) !== 'pending';
        const msg = strong
            ? `⚠️ حذف نهائي لإذن صرف (${label})؟\nهذا مستند مالي موقّع — سيُحذف نهائيًا ويُوثّق باسمك في سجل الأدمن.\nهل أنت متأكد؟`
            : 'حذف طلب الصرف المعلق نهائيًا؟ (المعتمد/المستلم لا يُحذف إلا بواسطة الأدمن — حذف نهائي موثّق)';
        const ok = await confirmFn(msg);
        if (!ok) {return;}
        busy = true;
        try {
            await deleteDispatch(raw.id);
            notify(strong ? 'حُذف إذن الصرف نهائيًا (موثّق باسم الأدمن)' : 'حُذف طلب الصرف المعلق');
            await reload();
        } catch (e) {
            notify((e && e.message) || 'تعذر حذف الإذن');
        } finally {
            busy = false;
        }
    }

    /* ── إرسال لوحات القرار ─────────────────────────────────────────────── */

    async function submitChefApprove() {
        const raw = panelRaw;
        const sig = readSig(SIG_IDS.chefApprove);
        if (sig == null) {return;}
        const notes = panelEl.querySelector('[data-f=notes]')?.value.trim() || '';
        busy = true;
        try {
            await chefApproveDispatch(raw.id, { notes, signatureData: sig, signerName });
            closePanel();
            notify('تم اعتماد الطلب وإحالته للمخازن');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر اعتماد الطلب');
        } finally {
            busy = false;
        }
    }

    async function submitChefReject() {
        const raw = panelRaw;
        const reason = panelEl.querySelector('[data-f=reason]')?.value.trim();
        if (!reason) {panelMsg('أدخل سبب الرفض'); return;}
        const sig = readSig(SIG_IDS.chefReject);
        if (sig == null) {return;}
        busy = true;
        try {
            await chefRejectDispatch(raw.id, { reason, signatureData: sig, signerName });
            closePanel();
            notify('تم رفض الطلب وسيظهر لرئيس القسم');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر رفض الطلب');
        } finally {
            busy = false;
        }
    }

    async function submitApprove() {
        const raw = panelRaw;
        let failMsg = '';
        const approvedItems = [];
        for (const row of panelEl.querySelectorAll('[data-ap-row]')) {
            const idx = Number(row.dataset.apRow);
            const item = raw.items[idx] || {};
            const cost = Number(row.dataset.cost) || 0;
            const onHand = Number(row.dataset.max) || 0;
            if (row.dataset.cw === '1') {
                const actualWeight = parseFloat(row.querySelector('[data-ap=weight]')?.value) || 0;
                const packagingQty = parseFloat(row.querySelector('[data-ap=pkg]')?.value) || 0;
                if (!(actualWeight > 0)) {failMsg = `أدخل الوزن الفعلي بالكيلو للصنف "${item.itemName}"`; break;}
                if (!(packagingQty > 0)) {failMsg = `أدخل عدد الكراتين المصروفة للصنف "${item.itemName}"`; break;}
                if (actualWeight > onHand) {failMsg = `الوزن الفعلي من "${item.itemName}" أكبر من المتوفر (${formatQty(onHand)} كجم)`; break;}
                // طلب بـ actualWeight في requestedQty — نفس شذوذ القديم المقصود (kitchen.js:1158)
                approvedItems.push({
                    name: item.itemName, itemName: item.itemName,
                    unit: row.dataset.cwUom || 'kg',
                    requestedQty: actualWeight,
                    requestedPackagingQty: Number(item.packagingQty ?? item.qty) || null,
                    approvedQty: actualWeight,
                    avgCost: cost, approvedValue: actualWeight * cost,
                    actualWeight, packagingQty,
                    packagingUom: row.dataset.pkgUom || 'كرتون',
                    catchWeightUom: row.dataset.cwUom || 'kg',
                });
                continue;
            }
            const approvedQty = parseFloat(row.querySelector('[data-ap=qty]')?.value);
            if (Number.isNaN(approvedQty) || approvedQty < 0) {failMsg = 'تحقق من الكميات المعتمدة'; break;}
            if (approvedQty > onHand) {failMsg = `الكمية المعتمدة من "${item.itemName}" أكبر من المتوفر`; break;}
            if (approvedQty > 0) {
                approvedItems.push({
                    name: item.itemName, itemName: item.itemName,
                    unit: item.unit,
                    requestedQty: item.qty,
                    approvedQty,
                    avgCost: cost, approvedValue: approvedQty * cost,
                    actualWeight: null, packagingQty: null, packagingUom: null,
                    catchWeightUom: row.dataset.cwUom || 'kg',
                });
            }
        }
        if (failMsg) {panelMsg(failMsg); return;}
        if (!approvedItems.length) {panelMsg('تحقق من البيانات'); return;}
        const sig = readSig(SIG_IDS.approve);
        if (sig == null) {return;}
        const approveNotes = panelEl.querySelector('[data-f=notes]')?.value.trim() || '';
        busy = true;
        try {
            const result = await approveDispatch(raw.id, { approvedItems, approveNotes, signatureData: sig, signerName });
            closePanel();
            notify(`تمت الموافقة وحُسبت مصاريف القسم بقيمة ${moneyPlain(result && result.totalValue || 0)}`);
            await reload();
        } catch (e) {
            if (e && e.code === 'DISPATCH_APPROVE_IN_PROGRESS') {
                notify('الإذن قيد الاعتماد فعلًا — لا تضغط مجددًا');
            } else {
                panelMsg((e && e.message) || 'تعذر اعتماد طلب الصرف');
            }
        } finally {
            busy = false;
        }
    }

    async function submitReject() {
        const raw = panelRaw;
        const reason = panelEl.querySelector('[data-f=reason]')?.value.trim();
        if (!reason) {panelMsg('أدخل سبب الرفض'); return;}
        const sig = readSig(SIG_IDS.reject);
        if (sig == null) {return;}
        busy = true;
        try {
            await rejectDispatch(raw.id, { reason, signatureData: sig, signerName });
            closePanel();
            notify('تم رفض الطلب');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر رفض طلب الصرف');
        } finally {
            busy = false;
        }
    }

    async function submitReceive() {
        const raw = panelRaw;
        let failMsg = '';
        const receivedItems = [];
        for (const row of panelEl.querySelectorAll('[data-ap-row]')) {
            const idx = Number(row.dataset.apRow);
            const item = ((raw.approvedItems && raw.approvedItems.length ? raw.approvedItems : raw.items) || [])[idx] || {};
            const approved = Number(row.dataset.approved) || 0;
            const received = Number(row.querySelector('[data-ap=recv]')?.value);
            if (!Number.isFinite(received) || received < 0 || received > approved) {
                failMsg = 'تحقق من كميات الاستلام؛ لا تتجاوز الكمية المعتمدة';
                break;
            }
            const isCw = row.dataset.cw === '1';
            const apBoxes = Number(row.dataset.apboxes) || 0;
            let recvPkg = null;
            if (isCw) {
                const rawPkg = row.querySelector('[data-ap=recvpkg]')?.value;
                recvPkg = (rawPkg === '' || rawPkg == null) ? apBoxes : Number(rawPkg);
                if (!Number.isFinite(recvPkg) || recvPkg < 0 || recvPkg > apBoxes) {
                    failMsg = 'تحقق من كميات الاستلام؛ لا تتجاوز الكمية المعتمدة';
                    break;
                }
            }
            receivedItems.push({
                itemName: item.itemName || item.name,
                receivedQty: received,
                ...(isCw ? { receivedPackagingQty: recvPkg } : {}),
                notes: '',
            });
        }
        if (failMsg) {panelMsg(failMsg); return;}
        const sig = readSig(SIG_IDS.receive);
        if (sig == null) {return;}
        const notes = panelEl.querySelector('[data-f=notes]')?.value.trim() || '';
        busy = true;
        try {
            await receiveDispatch(raw.id, { items: receivedItems, notes, signatureData: sig, signerName });
            closePanel();
            notify('تم تسجيل استلام المطبخ بالتوقيع');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر تسجيل استلام المطبخ');
        } finally {
            busy = false;
        }
    }

    function submitPanel() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (panelKind === 'create') {submitCreate(); return;}
        if (panelKind === 'edit') {submitEdit(); return;}
        if (panelKind === 'chef-approve') {submitChefApprove(); return;}
        if (panelKind === 'chef-reject') {submitChefReject(); return;}
        if (panelKind === 'approve') {submitApprove(); return;}
        if (panelKind === 'reject') {submitReject(); return;}
        if (panelKind === 'receive') {submitReceive();}
    }

    /* ── ورقة الطباعة A4 — منسوخة من printDispatchNote (kitchen.js:1233-1253) ── */

    function absoluteLogo(settings) {
        const b64 = settings && settings.logoB64 ? settings.logoB64 : '';
        if (/^data:image\//i.test(b64)) {return b64;}
        return `${window.location.origin}/app/assets/karim-logo.ico`;
    }

    async function printNote(raw) {
        // العارض داخلي فلا نافذة منبثقة تُحجب، ويُعرض «جارٍ التجهيز» فورًا.
        const w = openInAppReport(`إذن صرف #${raw.id}`);
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>إذن صرف #${esc(raw.id)}</title></head><body style="font-family:'Cairo',Tahoma,Arial,sans-serif;padding:24px">جارٍ تجهيز إذن الصرف…</body></html>`);
        let d = raw;
        try {
            const full = await fetchDispatchFull(raw.id);
            if (full) {d = full;}
        } catch (_) { /* fallback للصف المحلي — نفس سلوك القديم */ }
        const settings = await ensureSettings();
        const sigBlock = (label, dataUrl, who, at) => `<div style="text-align:center;min-width:170px;flex:1">${dataUrl ? `<img src="${dataUrl}" style="height:54px;object-fit:contain;margin-bottom:2px" alt="${esc(label)}">` : '<div style="height:54px"></div>'}<div style="border:1px solid #e5e7eb;border-top:3px solid #0f172a;border-radius:0 0 10px 10px;padding:8px 6px;font-size:12px;color:#444;background:#f8fafc"><b style="color:#0f172a">${esc(label)}</b>${who ? `<br><b style="color:#111">${esc(who)}</b>` : ''}${at ? `<br><small>${esc(at)}</small>` : ''}</div></div>`;
        const pItems = (d.approvedItems && d.approvedItems.length ? d.approvedItems : d.items) || [];
        const cur = currencyOf();
        const pMoney = (v) => { const m = formatMoney(v, cur); return `${m.amount}${m.hasUnit ? ` ${esc(m.unit)}` : ''}`; };
        const pTotal = pItems.reduce((s, i) => s + Number(i.approvedValue || 0), 0);
        const pStatusAr = { pending: 'بانتظار الاعتماد', chef_approved: 'معتمد من الشيف — بانتظار المخازن', approved: 'معتمد من المخازن', partially_received: 'مستلم جزئيًا', received: 'مستلم', rejected: 'مرفوض' }[d.status] || d.status || '—';
        const pRow = (item, idx) => {
            const cw = item.catchWeightEnabled || item.actualWeight;
            const qty = item.approvedQty ?? item.qty ?? 0;
            const qtyCell = cw && item.packagingQty
                ? `${formatQty(qty)} ${esc(item.catchWeightUom || item.unit || 'كجم')}<br><small>(${formatQty(item.packagingQty)} ${esc(item.packagingUom || 'كرتون')})</small>`
                : `${formatQty(qty)} ${esc(item.unit || '')}`;
            const price = Number(item.avgCost) || 0;
            return `<tr><td>${idx + 1}</td><td style="text-align:right">${esc(item.name || item.itemName)}${cw ? ' <small>⚖ وزن متغير</small>' : ''}</td><td>${qtyCell}</td><td>${price ? pMoney(price) : '—'}</td><td class="c-gold fw-bold">${item.approvedValue ? pMoney(item.approvedValue) : '—'}</td></tr>`;
        };
        const pChain = [
            d.createdBy ? ['الطلب', d.createdBy, d.date || d.requestedAt] : null,
            d.chefApprovedBy ? ['اعتماد الشيف', d.chefApprovedBy, d.chefApprovedAt] : null,
            d.warehouseApprovedBy ? ['اعتماد المخزن', d.warehouseApprovedBy, d.warehouseApprovedAt || d.approvedDate] : null,
            d.kitchenReceivedBy ? ['الاستلام', d.kitchenReceivedBy, d.kitchenReceivedAt] : null,
        ].filter(Boolean);
        const doc = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>إذن صرف #${esc(d.id)}</title><style>*{box-sizing:border-box}body{font-family:'Cairo',Tahoma,Arial,sans-serif;color:#1a1a1a;background:#eef2f7;margin:0;padding:32px 36px;direction:rtl}.sheet{max-width:800px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 8px 28px rgba(15,23,42,.10);padding:22px 24px 20px}.head{display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);border-bottom:4px solid #c9a227;border-radius:12px 12px 0 0;padding:18px 24px;margin:-22px -24px 16px}.doc-logo{width:74px;height:74px;object-fit:contain;background:#fff;border:2px solid #c9a227;border-radius:14px;padding:5px;box-shadow:0 2px 10px rgba(0,0,0,.35)}.head h1{margin:0;color:#f5d76e;font-size:24px}.head p{margin:2px 0;color:#cbd5e1;font-size:13px}.doc-title{text-align:center;margin:14px 0 4px}.doc-title h2{margin:0;font-size:22px;letter-spacing:.5px;color:#0f172a}.doc-title .st{display:inline-block;margin-top:8px;padding:4px 20px;border:0;border-radius:20px;font-size:12px;font-weight:800;color:#f5d76e;background:#0f172a;letter-spacing:.3px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.meta div{border:1px solid #e5e7eb;border-right:4px solid #c9a227;border-radius:10px;padding:8px 12px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.05)}.meta b{display:block;color:#8a6d1b;font-size:11px;margin-bottom:2px}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13.5px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#0f172a;color:#f5d76e;font-size:12px;letter-spacing:.3px}td small{color:#555}tbody tr:nth-child(even) td{background:#f8fafc}tfoot td{font-weight:800;background:#0f172a;color:#f5d76e;font-size:14px}.chain{display:flex;gap:8px;margin-top:14px}.chain div{flex:1;border:1px solid #e5e7eb;border-top:3px solid #c9a227;border-radius:10px;padding:8px 6px;font-size:11px;text-align:center;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.05)}.chain b{display:block;color:#0f172a;margin-bottom:2px}.notes{margin-top:12px;border:1px solid #e5e7eb;border-right:4px solid #c9a227;border-radius:10px;padding:10px 14px;font-size:13px;min-height:44px;background:#fffbeb}.sigs{display:flex;gap:14px;margin-top:34px}.foot{margin-top:18px;text-align:center;font-size:11px;color:#888;border-top:2px solid #c9a227;padding-top:8px}.controls{text-align:center;margin-bottom:18px}.controls button{border:0;border-radius:7px;padding:10px 26px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff;font-weight:700}.controls button.secondary{background:#555}@media print{body{padding:0;background:#fff}.sheet{box-shadow:none;border:0;border-radius:0}.head,.head h1,th,tfoot td,.doc-title .st{print-color-adjust:exact;-webkit-print-color-adjust:exact}.controls{display:none!important}@page{size:A4;margin:11mm}}</style></head><body><div class="controls"><button type="button" data-v2-print>🖨 طباعة</button><button type="button" class="secondary" data-v2-close>إغلاق</button></div><main class="sheet"><header class="head"><img class="doc-logo" src="${esc(absoluteLogo(settings))}" alt="الشعار"><div><h1>${esc(settings.name || 'مطاعم الشرفه العالمي')}</h1><p>نظام إدارة المخازن والمطاعم</p></div></header><div class="doc-title"><h2>إذن صرف مخزن</h2><span class="st">${esc(pStatusAr)}</span></div><section class="meta"><div><b>رقم الإذن</b>#${esc(String(d.id))}</div><div><b>القسم الطالب</b>${esc(d.deptName || '—')}</div><div><b>تاريخ الطلب</b>${esc(fD(d.date))}</div><div><b>تاريخ الاعتماد</b>${esc(d.warehouseApprovedAt || d.approvedDate ? fD(d.warehouseApprovedAt || d.approvedDate) : '—')}</div></section><table><thead><tr><th style="width:36px">#</th><th>الصنف</th><th>الكمية المعتمدة</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${pItems.map(pRow).join('') || '<tr><td colspan="5">لا أصناف</td></tr>'}</tbody><tfoot><tr><td colspan="4">الإجمالي (${formatInt(pItems.length)} صنف)</td><td>${pMoney(pTotal)}</td></tr></tfoot></table>${pChain.length ? `<section class="chain">${pChain.map((c) => `<div><b>${esc(c[0])}</b>${esc(c[1])}<br><small>${esc(c[2] ? fDT(c[2]) : '')}</small></div>`).join('')}</section>` : ''}<div class="notes"><b>ملاحظات الطلب:</b> ${esc(d.notes || '—')}${d.approveNotes ? `<br><b>ملاحظات الاعتماد:</b> ${esc(d.approveNotes)}` : ''}${d.receiptNotes ? `<br><b>ملاحظات الاستلام:</b> ${esc(d.receiptNotes)}` : ''}</div><div class="sigs">${sigBlock('توقيع الطالب', null, d.createdBy, d.date)}${sigBlock('توقيع أمين المخزن', d.warehouseApprovalSignatureData, d.warehouseApprovedBy, d.warehouseApprovedAt || d.approvedDate)}${sigBlock('توقيع المستلم', d.kitchenReceiptSignatureData, d.kitchenReceivedBy, d.kitchenReceivedAt)}</div><div class="foot">مستند مخزني معتمد إلكترونيًا — ${esc(settings.name || '')} — طُبع بتاريخ ${esc(fDT(new Date().toISOString()))}</div></main></body></html>`;
        w.document.open();
        w.document.write(doc);
        w.document.close();
        w.document.querySelector('[data-v2-print]')?.addEventListener('click', () => w.print());
        w.document.querySelector('[data-v2-close]')?.addEventListener('click', () => w.close());
        w.focus();
        w.print();
    }

    /* ── طباعة الكشف المفلتر — مرآة dispPrintList (kitchen.js:298-303) ──
     *  القديم يطبع الصفوف المفلترة بالتاريخ (جدول: #/القسم/الأصناف/التاريخ/
     *  الحالة) عبر ysPrintReport. زر V2 كان يطبع الشاشة كلها بـ window.print()
     *  — الآن يبني نفس الكشف من الصفوف المعروضة فعلًا (inRange) في نافذة
     *  تُفتح داخل إيماءة النقر حتى لا يحجبها المتصفح. */

    async function printList() {
        const w = openInAppReport('كشف أذونات الصرف');
        w.document.write('<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>كشف أذونات الصرف</title></head><body style="font-family:\'Cairo\',Tahoma,Arial,sans-serif;padding:24px">جارٍ تجهيز الكشف…</body></html>');
        const view = rawRows.map((r) => ({ ...dispatchToRow(r), _raw: r }));
        const { rows } = inRange(view);
        const from = q('#v2dsp-from').value;
        const to = q('#v2dsp-to').value;
        const settings = await ensureSettings();
        const brand = (settings && settings.name) || 'Karim ERP';
        const period = (from || to) ? `من ${from || 'البداية'} إلى ${to || 'اليوم'}` : 'كل الفترة';
        const body = rows.map((row, i) => {
            const raw = row._raw || {};
            let statusLabel = raw.status || '—';
            try {
                const st = resolveStatus('dispatch', raw.status);
                if (st && st.label) {statusLabel = st.label;}
            } catch { /* keep raw status */ }
            /* desc: rows[0] = الأحدث فيأخذ الترقيم 1 صاعدًا معه. */
            return `<tr><td>${i + 1}</td><td>${esc(row.dept || raw.deptName || '—')}</td>`
                + `<td style="text-align:right">${esc(row.itemsText || '—')}</td>`
                + `<td>${esc(row.date ? fD(row.date) : '—')}</td><td>${esc(statusLabel)}</td></tr>`;
        }).join('');
        const dateStr = new Date().toLocaleString('ar-EG');
        w.document.open();
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>كشف أذونات الصرف</title>`
            + '<style>body{font-family:\'Cairo\',Tahoma,Arial,sans-serif;color:#111;background:#fff;margin:0;padding:28px;direction:rtl}'
            + '.sheet{max-width:900px;margin:auto}.head{text-align:center;border-bottom:3px solid #b45309;padding-bottom:16px;margin-bottom:18px}'
            + '.head h1{margin:0 0 6px;color:#b45309;font-size:24px}.head p{margin:3px 0;color:#555;font-size:13px}'
            + '.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}'
            + '.summary div{border:1px solid #ddd;border-radius:8px;padding:10px;text-align:center}'
            + '.summary b{display:block;font-size:17px;color:#7c3500;margin-top:4px}.summary span{font-size:12px;color:#555}'
            + 'table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px;text-align:right;font-size:12px}'
            + 'th{background:#f7ead8;color:#7c3500}'
            + '.controls{text-align:center;margin-bottom:20px}.controls button{border:0;border-radius:7px;padding:10px 24px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff}'
            + '.controls button.secondary{background:#555}'
            + '@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:12mm}}</style></head><body>'
            + '<div class="controls"><button type="button" data-pl-print>طباعة</button><button type="button" class="secondary" data-pl-close>إغلاق</button></div>'
            + `<main class="sheet"><header class="head"><h1>${esc(brand)}</h1>`
            + '<p style="font-size:16px;font-weight:700;color:#111">كشف أذونات الصرف</p>'
            + `<p>${esc(period)}</p><p>تاريخ التقرير: ${esc(dateStr)}</p></header>`
            + `<section class="summary"><div><span>عدد الأذون</span><b>${formatInt(rows.length)}</b></div></section>`
            + '<table><thead><tr><th>#</th><th>القسم</th><th>الأصناف</th><th>التاريخ</th><th>الحالة</th></tr></thead>'
            + `<tbody>${body || '<tr><td colspan="5">لا بيانات في الفترة المحددة</td></tr>'}</tbody></table></main></body></html>`);
        w.document.close();
        const btnPrint = w.document.querySelector('[data-pl-print]');
        if (btnPrint) {btnPrint.addEventListener('click', () => w.print());}
        const btnClose = w.document.querySelector('[data-pl-close]');
        if (btnClose) {btnClose.addEventListener('click', () => w.close());}
        w.focus();
    }

    /* ── القراءة والرسم ────────────────────────────────────────────────── */

    function inRange(rows) {
        const from = q('#v2dsp-from').value;
        const to = q('#v2dsp-to').value;
        return {
            rows: rows.filter((r) => {
                const day = r.date ? String(r.date).slice(0, 10) : '';
                if (from && day < from) {return false;}
                if (to && day > to) {return false;}
                return true;
            }),
            filtered: !!(from || to),
        };
    }

    function paint() {
        const view = rawRows.map((r) => ({ ...dispatchToRow(r), _raw: r }));
        const { rows, filtered } = inRange(view);
        const c = summarizeDispatches(rows);
        const states = Object.entries(c).map(([k, v]) => {
            let label = k || 'بلا حالة';
            try {
                const s = resolveStatus('dispatch', k);
                if (s && s.label) {label = s.label;}
            } catch { /* adapter stays total — raw key above */ }
            return `${label} ${v}`;
        }).join(' · ');
        summaryEl.textContent = `${formatInt(rows.length)} إذنًا${states ? ` · ${states}` : ''}${filtered ? '' : ' · كل الفترات'}`;
        countEl.textContent = rows.length ? `(${formatInt(rows.length)})` : '';
        clearBtn.hidden = !filtered;
        table.setRows(rows);
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        const seq = ++readSeq;
        if (!rawRows.length) {table.setLoading(true);}
        try {
            const list = await fetchDispatches();
            if (!el.isConnected || seq !== readSeq) {return;}   // destroyed / newer read wins
            rawRows = list;
            rawById = new Map(list.map((r) => [String(r.id), r]));
            paint();
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
                    ? 'لا صلاحية لعرض أذون الصرف بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل الأذون: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
        }
    }

    /* ── التفويض: نقرة واحدة تخدم كل اللوحات (CSP: لا معالج سطري) ──────── */

    el.addEventListener('click', (event) => {
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            const raw = rawById.get(String(actBtn.dataset.id));
            if (!raw) {notify('تعذر العثور على الإذن — حدّث القائمة'); return;}
            const act = actBtn.dataset.v2Act;
            if (act === 'print') {printNote(raw); return;}
            if (act === 'delete') {confirmDelete(raw); return;}
            openPanel(act, raw);
            return;
        }
        if (event.target.closest('[data-v2-panel-close]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-submit]')) {submitPanel(); return;}
        if (event.target.closest('[data-v2-retry-panel]')) {
            if (retryState) {openPanel(retryState.kind, retryState.raw);}
            return;
        }
        const removeBtn = event.target.closest('[data-v2-remove-item]');
        if (removeBtn) {
            removeBtn.closest('[data-di]')?.remove();
            updateFormSummary();
            return;
        }
        if (event.target.closest('[data-v2-new]')) {openPanel('create', null); return;}
        if (event.target.closest('[data-v2-clear]')) {
            q('#v2dsp-from').value = '';
            q('#v2dsp-to').value = '';
            paint();
            return;
        }
        if (event.target.closest('[data-v2-print]')) {printList(); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    // الاختيار من الاقتراحات على mousedown — يسبق blur فيصل النقر قبل اختفاء القائمة
    el.addEventListener('mousedown', (event) => {
        const sug = event.target.closest('[data-v2-sug]');
        if (sug) {
            event.preventDefault();
            addSuggestion(Number(sug.dataset.v2Sug));
        }
    });

    el.addEventListener('input', (event) => {
        if (event.target.matches('[data-v2-item-search]')) {updateSuggestions(); return;}
        if (event.target.closest('[data-di]')) {updateFormSummary(); return;}
        if (event.target.closest('[data-ap-row]') && event.target.matches('[data-ap]')) {
            if (panelKind === 'approve') {updateApproveTotal();}
        }
    });

    el.addEventListener('change', (event) => {
        if (event.target.matches('#v2dsp-from, #v2dsp-to')) {paint();}
    });

    el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.matches('#v2dsp-from, #v2dsp-to')) {paint();}
    });

    reload();

    return {
        el,
        reload,
        getRows: () => inRange(rawRows.map((r) => ({ ...dispatchToRow(r), _raw: r }))).rows,
        destroy() {
            panelSeq += 1;
            disposeSignaturePads(ALL_SIG_IDS);
            table.destroy();
            el.remove();
        },
    };
}
