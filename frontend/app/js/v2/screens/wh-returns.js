/**
 * V2 — Wh-returns screen: مرتجعات المطبخ — الدورة كاملة (W1-5)
 * ═══════════════════════════════════════════════════════════════════════
 * LEGACY (features/kitchen.js): renderKitchenReturnsSection :646-680 ·
 * showKitchenReturnModal :1255-1308 (إذن معتمد إن وُجد وإلا إرجاع مباشر) ·
 * refreshReturnItems/addReturnItemField/addDirectReturnItemField :1309-1346 ·
 * submitDirectReturn :1347-1368 · submitKitchenReturn :1369-1394 ·
 * deleteKitchenReturn :682-692.
 *
 * قواعد لم تُخترع:
 *   • الباب الواحد للشبكة: js/v2/data/warehouse-repo.js — لا fetch/ apiFetch هنا.
 *   • نصوص اللوحات والحمولات منسوخة حرفًا: قايمة الأسباب :1270-1274، بنر
 *     الإرجاع المباشر :1266، تحقق 'اختر طلب صرف'/'اختر القسم المُرجِع'/
 *     'أضف صنفًا واحدًا على الأقل' :1351/:1358/:1374/:1383، نجاح
 *     :1366/:1391، حذف :683/:689، فشل 'تعذر تنفيذ الإرجاع'/'تعذر الحذف'.
 *   • وضع اللوحة كما عند القديم: لا إذونات approved ⇒ إرجاع مباشر
 *     (قسم + أصناف المخزون)، وإلا ⇒ مرتبط بإذن صرف معتمد :1256-1257.
 *   • الفلتر النقي لأقسام الإرجاع المباشر :1259 في البوابة.
 *   • انحرافات معلنة: (أ) dept_head متعدد الأقسام يختار من قايمة أقسامه بدل
 *     الحقل الخام 'CAF,SERVICE' الذي يرفضه الخادم 422 حتمًا (سابقة إصلاح
 *     :702-706)؛ (ب) رسائل النجاح/الحذف من رد الخادم مع سقوط نص القديم؛
 *     (ج) window.confirm ممنوع (CSP + عقد V2) — الحذف يمر بـ confirmFn،
 *     وترميز المعرّف في البوابة.
 *   • قارئ عمود «حذف» كما :657 — يظهر لحامله فقط ووظيفته عكس الأثر كاملًا.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.187';
import {
    fetchKitchenReturns, kitchenReturnToRow,
    returnCreateVisible, returnDeleteVisible,
    fetchReturnDispatches, fetchReturnDepartments, fetchReturnInventory,
    directReturnDepartments, deptLabelOf, returnDeptCodesOf,
    returnCreatePayload, createKitchenReturn, deleteKitchenReturn,
} from '../data/warehouse-repo.js?v=4.9.187';
import { fetchCurrency, formatMoney, formatInt, formatQty } from '../data/reports-repo.js?v=4.9.187';

const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money = (v, c) => { const m = formatMoney(v, c); return `<span class="erp-num" dir="ltr">${m.amount}</span>` + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : ''); };

/** أسباب الإرجاع — قايمة القديم :1270-1274 حرفًا. */
const RETURN_REASONS = ['فائض إنتاج', 'تغيير قائمة', 'انتهاء الوردية', 'خطأ في الصرف', 'أخرى'];

function template(canCreate) {
    return `
      <section class="erp-card erp-v2-wh-returns">
        <div class="erp-card__head">
          <h3 class="erp-card__title">مرتجعات المطبخ
            <span class="erp-eyebrow" dir="ltr" lang="en">Kitchen Returns</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <span class="erp-v2-wh-returns__tools">
            ${canCreate ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-new><i class="ji" data-i="undo" aria-hidden="true"></i><span>إرجاع جديد</span></button>` : ''}
            <button type="button" class="erp-btn erp-btn--sm" data-v2-print><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span></button>
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button>
          </span>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
          <p class="erp-text-sm erp-text-muted">
            الدورة كاملة من هنا: إرجاع جديد من إذن صرف معتمد أو إرجاع مباشر من قسم
            (كلاهما يعكس مصروف القسم ويعيد الكميات للمخزن)، وحذف السجل بعكس أثره المخزني.
            الصلاحية محكومة بالأدوار (الإنشاء للمطبخ والمخزن والإدارة، والحذف
            للمخزن والإدارة). كل مرتجع يُسجَّل معتمدًا من لحظة الإنشاء.
          </p>
          <div data-v2-table></div>
          <div data-v2-panel hidden></div>
        </div>
      </section>`;
}

export function mountWhReturnsScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 wh-returns]', m);
    const confirmFn = typeof ctx.confirmFn === 'function'
        ? ctx.confirmFn
        : (message) => Promise.resolve(window.confirm(message));
    const role = ctx.role ? String(ctx.role) : '';
    const deptCode = String(ctx.deptCode || '');
    let rawRows = [], currency = '', loading = false, readSeq = 0;
    let busy = false, panelSeq = 0, panelKind = null, panelData = null, retryState = null;
    host.insertAdjacentHTML('beforeend', template(returnCreateVisible(role)));
    const el = host.lastElementChild; const q = (s) => el.querySelector(s);
    const countEl = q('[data-v2-count]'); const summaryEl = q('[data-v2-summary]');
    const panelEl = q('[data-v2-panel]');

    const moneyPlain = (v) => {
        const m = formatMoney(v, currency);
        return m.hasUnit ? `${m.amount} ${m.unit}` : m.amount;
    };

    const columns = [
        { key: 'id', header: 'الإرجاع', type: 'number', sortable: true, width: '80px', align: 'end', className: 'erp-mono', render: (r) => `<span class="erp-num" dir="ltr">#${r.id ?? '؟'}</span>` },
        { key: 'deptName', header: 'القسم', sortable: true, filterable: true, width: '150px' },
        {
            key: 'dispatchId', header: 'طلب الصرف', width: '110px', align: 'center',
            render: (r) => (r.dispatchId ? `<span class="erp-num" dir="ltr">#${esc(r.dispatchId)}</span>` : `<span class="erp-text-muted">—</span>`),
        },
        {
            key: 'itemsSummary', header: 'الأصناف (كمية)',
            render: (r) => (r.itemsSummary ? esc(r.itemsSummary) : `<span class="erp-text-muted">—</span>`),
        },
        {
            key: 'reason', header: 'السبب/ملاحظات',
            render: (r) => (r.reason ? esc(r.reason) : `<span class="erp-text-muted">—</span>`),
        },
        {
            key: 'date', header: 'التاريخ', sortable: true, width: '120px', align: 'center', className: 'erp-tnum',
            render: (r) => (r.date ? `<span class="erp-num" dir="ltr">${esc(r.date)}</span>` : `<span class="erp-text-muted">—</span>`),
        },
        { key: 'totalValue', header: 'القيمة', type: 'number', sortable: true, width: '120px', align: 'end', value: (r) => r.totalValue, render: (r) => money(r.totalValue, currency) },
        {
            key: 'itemsCount', header: 'أصناف', type: 'number', width: '90px', align: 'end', value: (r) => r.itemsCount,
            render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.itemsCount)}</span>`,
        },
    ];
    /* عمود الحذف كما :657 — لحامله فقط، والحذف يعكس الأثر عند الخادم. */
    if (returnDeleteVisible(role)) {
        columns.push({
            key: 'actions', header: 'حذف', width: '110px', className: 'erp-v2-wh-returns-actions',
            render: (r) => `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-act="del" data-id="${esc(String(r.id))}" title="حذف المرتجع"><i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span></button>`,
        });
    }
    const table = createDataTable({
        caption: 'مرتجعات المطبخ — بيانات حية', mode: 'client', pageSize: 50, stickyHeader: true,
        emptyMessage: 'لا توجد مرتجعات مسجلة', rowKey: (r) => r.id,
        columns,
    });
    q('[data-v2-table]').appendChild(table.el);

    /* ── اللوحة: غلاف ومكوّنات مشتركة ───────────────────────────────────── */

    function panelShell(title, icon, bodyHtml) {
        return `<div class="erp-returns-panel">
          <div class="erp-returns-panel__head">
            <h3><i class="ji" data-i="${esc(icon)}" aria-hidden="true"></i> ${title}</h3>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close>
              <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
            </button>
          </div>
          <div class="erp-returns-panel__body erp-stack">${bodyHtml}</div>
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
          <div class="erp-returns-panel__actions">
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
        panelData = null;
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

    /* ── لوحة الإنشاء: إذن معتمد إن وُجد وإلا إرجاع مباشر (:1256) ───────── */

    const reasonFieldHtml = () => `
      <label class="erp-field"><span class="erp-label">سبب الإرجاع</span>
        <select class="erp-input" data-v2-reason>
          ${RETURN_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
        </select></label>`;

    const notesFieldHtml = () => `
      <label class="erp-field"><span class="erp-label">ملاحظات</span>
        <input class="erp-input" type="text" data-v2-notes placeholder="ملاحظات"></label>`;

    /** حقل القسم — انحراف معلن: dept_head متعدد الأقسام يختار من أقسامه فقط. */
    function deptFieldHtml() {
        const myCodes = returnDeptCodesOf(deptCode);
        if (role === 'dept_head' && myCodes.length > 1) {
            const depts = (panelData && panelData.depts) || [];
            return `<label class="erp-field"><span class="erp-label">القسم المُرجِع</span>
              <select class="erp-input" data-v2-dept>
                ${myCodes.map((c) => `<option value="${esc(c)}">${esc(deptLabelOf(depts, c))}</option>`).join('')}
              </select></label>`;
        }
        if (role === 'dept_head') {
            return `<label class="erp-field"><span class="erp-label">القسم المُرجِع</span>
              <span class="erp-addr" dir="ltr">${esc(myCodes[0] || '—')}</span>
              <input type="hidden" data-v2-dept value="${esc(myCodes[0] || '')}"></label>`;
        }
        const depts = (panelData && panelData.depts) || [];
        return `<label class="erp-field"><span class="erp-label">القسم المُرجِع</span>
          <select class="erp-input" data-v2-dept>
            ${depts.map((d) => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('')}
          </select></label>`;
    }

    const directOptionsHtml = () => ((panelData && panelData.inv) || [])
        .map((i) => `<option value="${esc(i.name)}">${esc(i.name)} (رصيد ${esc(formatQty(i.qty))} ${esc(i.unit)})</option>`)
        .join('') || '<option value="">لا أصناف بالمخزن</option>';

    const dispatchOptionsHtml = (d) => (d ? d.items.map((it) => `<option value="${esc(it.name)}" data-unit="${esc(it.unit)}" data-v2-max="${esc(String(it.qty))}">${esc(it.name)} (${esc(formatQty(it.qty))} ${esc(it.unit)})</option>`).join('') : '');

    function rowHtmlFromOptions(optionsHtml) {
        return `<div class="erp-returns-row" data-v2-row>
          <select class="erp-input" data-v2-item aria-label="الصنف">${optionsHtml}</select>
          <input class="erp-input" type="number" min="0.01" step="0.01" placeholder="الكمية" data-v2-qty aria-label="الكمية">
          <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-remove-row aria-label="حذف الصف"><i class="ji" data-i="x" aria-hidden="true"></i></button>
        </div>`;
    }

    function directCreateHtml() {
        return panelShell('إرجاع مباشر للمخزن', 'undo',
            `<div class="erp-flow-note" data-tone="warning">لا توجد طلبات صرف معتمدة — سيُسجَّل إرجاعًا مباشرًا من القسم إلى المخزن الرئيسي مع عكس مصروف القسم.</div>
             ${deptFieldHtml()}
             ${reasonFieldHtml()}
             <div class="erp-stack" data-v2-rows>${rowHtmlFromOptions(directOptionsHtml())}</div>
             <div><button type="button" class="erp-btn erp-btn--sm" data-v2-add-row>
               <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة صنف</span></button></div>
             ${notesFieldHtml()}
             ${panelActions('تأكيد الإرجاع', 'undo')}`);
    }

    function dispatchCreateHtml() {
        const dispatches = panelData.dispatches;
        return panelShell('إرجاع من المطبخ للمخزن', 'undo',
            `<label class="erp-field"><span class="erp-label">طلب الصرف</span>
               <select class="erp-input" data-v2-dispatch>
                 ${dispatches.map((d) => `<option value="${esc(String(d.id))}">#${esc(String(d.id))} - ${esc(d.deptName)} - ${esc(d.date)}</option>`).join('')}
               </select></label>
             ${reasonFieldHtml()}
             <div class="erp-stack" data-v2-rows>${rowHtmlFromOptions(dispatchOptionsHtml(dispatches[0]))}</div>
             <div><button type="button" class="erp-btn erp-btn--sm" data-v2-add-row>
               <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة صنف</span></button></div>
             ${notesFieldHtml()}
             ${panelActions('تأكيد الإرجاع', 'undo')}`);
    }

    const selectedDispatch = () => {
        if (!panelData || panelData.mode !== 'dispatch') {return null;}
        const id = panelEl.querySelector('[data-v2-dispatch]')?.value;
        return panelData.dispatches.find((d) => String(d.id) === String(id)) || null;
    };

    /* ── فتح اللوحة — بوابة واحدة ──────────────────────────────────────── */

    function openPanel(kind) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (kind !== 'create') {return;}
        if (!returnCreateVisible(role)) {notify('إنشاء المرتجعات للمطبخ والمخزن والإدارة فقط'); return;}
        const seq = ++panelSeq;
        panelKind = kind;
        panelData = null;
        retryState = null;
        openCreatePanel(seq);
    }

    async function openCreatePanel(seq) {
        setPanel(panelLoading('إرجاع جديد', 'undo'));
        try {
            const dispatches = await fetchReturnDispatches();
            if (!panelAlive(seq)) {return;}
            if (dispatches.length) {
                panelData = { mode: 'dispatch', dispatches };
                setPanel(dispatchCreateHtml());
                return;
            }
            const [deptRows, inv] = await Promise.all([fetchReturnDepartments(), fetchReturnInventory()]);
            if (!panelAlive(seq)) {return;}
            panelData = { mode: 'direct', depts: directReturnDepartments(deptRows), inv };
            setPanel(directCreateHtml());
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            retryState = { kind: 'create' };
            setPanel(panelRetry('إرجاع جديد', 'undo', `تعذر تجهيز اللوحة: ${(e && e.message) || 'خطأ في القراءة'}`));
        }
    }

    /* ── التنفيذ: الإرسال من البوابة، والأخطاء تصعد كما ترد ────────────── */

    async function submitPanel() {
        if (panelKind === 'create') {await submitCreate();}
    }

    async function submitCreate() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        busy = true;
        try {
            const mode = panelData ? panelData.mode : '';
            const reason = panelEl.querySelector('[data-v2-reason]')?.value || '';
            const notes = panelEl.querySelector('[data-v2-notes]')?.value || '';
            let target = {};
            if (mode === 'dispatch') {
                const dispatchId = panelEl.querySelector('[data-v2-dispatch]')?.value || '';
                if (!dispatchId) {notify('اختر طلب صرف'); return;}
                target = { dispatchId };
            } else {
                const dept = panelEl.querySelector('[data-v2-dept]')?.value || '';
                if (!dept) {notify('اختر القسم المُرجِع'); return;}
                target = { deptCode: dept };
            }
            const items = [...panelEl.querySelectorAll('[data-v2-row]')].map((row) => ({
                name: row.querySelector('[data-v2-item]')?.value || '',
                qty: Number(row.querySelector('[data-v2-qty]')?.value),
            })).filter((r) => r.name && Number.isFinite(r.qty) && r.qty > 0);
            if (!items.length) {notify('أضف صنفًا واحدًا على الأقل'); return;}
            const res = await createKitchenReturn(returnCreatePayload({ ...target, reason, notes, items }));
            closePanel();
            notify(mode === 'dispatch'
                ? `تم الإرجاع وإعادة ${moneyPlain((res && res.totalValue) || 0)} للمخزن وعكس مصروف القسم`
                : `تم الإرجاع المباشر وإعادة ${moneyPlain((res && res.totalValue) || 0)} للمخزن`);
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر تنفيذ الإرجاع');
        } finally {
            busy = false;
        }
    }

    async function deleteRow(id) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        busy = true;
        try {
            const ok = await confirmFn('تأكيد حذف سجل المرتجع؟ لا يمكن التراجع.');
            if (!ok) {return;}
            const res = await deleteKitchenReturn(id);
            notify((res && res.message) || 'تم حذف سجل المرتجع');
            await reload();
        } catch (e) {
            notify((e && e.message) || 'تعذر الحذف');
        } finally {
            busy = false;
        }
    }

    /* ── القراءة والرسم ────────────────────────────────────────────────── */

    function viewRows() { return rawRows; }
    function paint() {
        const total = rawRows.reduce((s, r) => s + (r.totalValue || 0), 0);
        const m = formatMoney(total, currency);
        summaryEl.textContent = `${formatInt(rawRows.length)} مرتجعًا · إجمالي ${m.amount}${currency ? ` ${currency}` : ''} (أصل 8,000 الأحدث)`;
        countEl.textContent = rawRows.length ? `(${formatInt(rawRows.length)})` : '';
        table.setRows(rawRows);
    }
    async function reload() {
        if (loading) {return;}
        loading = true;
        const seq = ++readSeq;
        if (!rawRows.length) {table.setLoading(true);}
        try {
            const [rets, cur] = await Promise.all([fetchKitchenReturns(), fetchCurrency().catch(() => '')]);
            if (!el.isConnected || seq !== readSeq) {return;}
            currency = String(cur ?? '');
            rawRows = rets.map(kitchenReturnToRow);
            paint();
        } catch (e) {
            if (!el.isConnected || seq !== readSeq) {return;}
            rawRows = []; table.setRows([]);
            summaryEl.textContent = ''; countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN' ? 'لا صلاحية لعرض المرتجعات بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل المرتجعات: ${(e && e.message) || 'خطأ'}`));
        } finally { loading = false; }
    }

    /* ── التفويض: نقرة/تغيير واحدة تخدم الكل (CSP: لا معالج سطري) ──────── */

    const currentRowHtml = () => rowHtmlFromOptions(panelData && panelData.mode === 'dispatch'
        ? dispatchOptionsHtml(selectedDispatch())
        : directOptionsHtml());

    el.addEventListener('click', (event) => {
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {deleteRow(actBtn.getAttribute('data-id')); return;}
        if (event.target.closest('[data-v2-new]')) {openPanel('create'); return;}
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-v2-reload]') || event.target.closest('[data-erp-retry]')) {reload(); return;}
        if (event.target.closest('[data-v2-panel-close]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-submit]')) {submitPanel(); return;}
        if (event.target.closest('[data-v2-retry-panel]')) {
            if (retryState) {openPanel(retryState.kind);}
            return;
        }
        if (event.target.closest('[data-v2-add-row]')) {
            const box = panelEl.querySelector('[data-v2-rows]');
            if (box) {box.insertAdjacentHTML('beforeend', currentRowHtml());}
            return;
        }
        const removeRow = event.target.closest('[data-v2-remove-row]');
        if (removeRow) {removeRow.closest('[data-v2-row]')?.remove();}
    });

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-dispatch]')) {
            const box = panelEl.querySelector('[data-v2-rows]');
            if (box) {box.innerHTML = currentRowHtml();}
        }
    });

    reload();
    return { el, reload, getRows: () => viewRows(), destroy() { panelSeq += 1; table.destroy(); el.remove(); } };
}
