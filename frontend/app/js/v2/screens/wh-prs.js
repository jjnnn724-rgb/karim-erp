/**
 * V2 — Purchase-requests screen · شاشة 21 في سجل الترحيل (دورة الطلب كاملة)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * W1-3 (2026-10-15): كانت قراءةً فقط؛ صارت تنفّذ دورة الطلب كاملة بنفس
 * عقد الشاشات 13 (dispatch) و09 (kitchen):
 *   إنشاء (نواقص مختارة + صفوف يدوية + قسم طالب + توقيع الشيف للمطبخ) ·
 *   توقيع/رفض الشيف · اعتماد/رفض المدير العام · إلغاء · حذف نهائي (الإدارة)
 *   · تفاصيل بالسلسلة · طباعة A4 بأربع خانات توقيع.
 *
 * قواعد لم تُخترع:
 *   • الباب الواحد للشبكة: js/v2/data/pr-repo.js — لا fetch/ apiFetch هنا.
 *   • نصوص اللوحات والحمولات منسوخة من features/kitchen.js:490-645 حرفًا
 *     بحرف (البنرات، التحقق، التأكيدات، رسائل النجاح، أعمدة التفاصيل).
 *   • الاستلام أُلغي بقرار المالك (2026-10-01): لا زر له ولا باب — الرسالة
 *     الخادمية 410 PR_RECEIVE_RETIRED لو نودي المسار من خارج الواجهة.
 *   • التواقيع عبر js/v2/signature.js المقفلة على اسم الحساب، ويحسمها
 *     الخادم (requireSignature). بلا اسم حساب لا تُفتح لوحة موقّعة.
 *   • انحراف معلن واحد عن أزرار القديم: «حذف نهائي» يختفي على الحالات
 *     الثلاث المحمية بخادمها (approved/partially_fulfilled/fulfilled)
 *     بدل عرض زر يرفضه الخادم حتمًا (:3674) — والبوابة موثّقة في pr-repo.
 *   • الأخطاء تُطبع من ردّ الخادم (e.message) لا من نصوص مخترعة.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.153';
import { openInAppReport } from '../report-viewer.js?v=4.9.153';
import { statusBadge, resolveStatus } from '../status.js?v=4.9.153';
import { formatInt, formatQty } from '../data/reports-repo.js?v=4.9.153';
import {
    PR_CREATE_ROLES,
    fetchPurchaseRequests, fetchShortages, fetchPRDepartments, fetchPRInventoryNames,
    fetchPRSettings, purchaseRequestToRow, summarizePR, filterPRDeptOptions,
    isChefCreator, chefActionsVisible, gmActionsVisible, cancelVisible, deleteVisible, printVisible,
    collectPRItems, prCreateError, prReasonError,
    prCreatePayload, prNotesPayload, prRejectPayload,
    createPR, chefApprovePR, chefRejectPR, gmApprovePR, gmRejectPR, cancelPR, deletePR,
} from '../data/pr-repo.js?v=4.9.153';
import {
    normalizeSignerName, signaturePadMarkup, initSignaturePad, readSignaturePad,
    disposeSignaturePads,
} from '../signature.js?v=4.9.153';

const SIG_IDS = {
    prCreate: 'v2pr-create-sig',
    chefApprove: 'v2pr-chef-approve-sig',
    chefReject: 'v2pr-chef-reject-sig',
    gmApprove: 'v2pr-gm-approve-sig',
    gmReject: 'v2pr-gm-reject-sig',
};
const ALL_SIG_IDS = Object.values(SIG_IDS);
const SIGN_KINDS = new Set(['chef-approve', 'chef-reject', 'gm-approve', 'gm-reject']);

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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

const STATUS_FILTERS = ['all', 'pending', 'chef_approved', 'approved', 'partially_fulfilled', 'fulfilled', 'rejected', 'cancelled'];
const STATUS_AR = {
    all: 'الكل', pending: 'معلق', chef_approved: 'موقّع شيف',
    approved: 'معتمد', partially_fulfilled: 'مستلم جزئياً',
    fulfilled: 'مستلم', rejected: 'مرفوض', cancelled: 'ملغي',
};

/** سقف السجل عند الخادم (:3215) — النافذة تُعلن حين تمتلئ. */
const PR_LIST_CAP = 200;

/** تسمية حالة من السجل المشترك — وبلا مخترع إن غابت. */
function statusLabelOf(s) {
    try {
        const st = resolveStatus('purchase_request', s);
        if (st && st.label) {return st.label;}
    } catch (_) { /* السجل شامل — النص الخام أدناه */ }
    return s || '—';
}

function template(canCreate) {
    return `
      <section class="erp-card erp-v2-wh-prs">
        <div class="erp-card__head">
          <h3 class="erp-card__title">طلبات شراء النواقص
            <span class="erp-eyebrow" dir="ltr" lang="en">Purchase Requests</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <span class="erp-v2-wh-prs__tools">
            ${canCreate ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-new>
              <i class="ji" data-i="shopping-cart" aria-hidden="true"></i><span>طلب شراء جديد</span>
            </button>` : ''}
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
          <div data-v2-seg></div>
          <p class="erp-text-sm erp-text-muted">
            دورة الطلب كاملة من هنا: إنشاء (وتوقيع المطبخ <strong>نهائيٌّ يوصله المخزن مباشرة</strong>) ·
            توقيع/رفض الشيف · اعتماد/رفض المدير العام · إلغاء · تفاصيل · طباعة.
            الاستلام أُلغي بقرار المالك — البضاعة تدخل بفواتير المشتريات.
            الصلاحية قررها الخادم (admin|manager|warehouse|kitchen|sous_chef|accountant).
          </p>
          <p class="erp-text-sm erp-text-muted" data-v2-cap-note hidden></p>
          <div data-v2-table></div>
          <section class="erp-card erp-card--inset" data-v2-shortage>
            <div class="erp-card__head"><h4 class="erp-card__title">النواقص الحالية (استشاري)</h4></div>
            <div class="erp-card__body" data-v2-shortage-body>جارٍ التحميل…</div>
          </section>
          <div data-v2-panel hidden></div>
        </div>
      </section>`;
}

export function mountWhPrsScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 wh-prs]', m);
    const confirmFn = typeof ctx.confirmFn === 'function'
        ? ctx.confirmFn
        : (message) => Promise.resolve(window.confirm(message));
    const role = ctx.role ? String(ctx.role) : '';
    const signerName = normalizeSignerName(ctx.userName || '');

    let rawRows = [];                       // آخر قراءة خام من الخادم
    let rawById = new Map();
    let shortages = [];
    let loading = false;
    let readSeq = 0;                        // أحدث قراءة تفوق
    let busy = false;                       // قرار واحد في المرة
    let panelSeq = 0;                       // إغلاق اللوحة يُلغي أي تجهيز جارٍ
    let panelKind = null;
    let panelRaw = null;
    let retryState = null;                  // {kind, raw} لإعادة محاولة لوحة فشل تجهيزها
    let settingsState = null;               // {name, logoB64} — مرة واحدة

    host.insertAdjacentHTML('beforeend', template(PR_CREATE_ROLES.includes(role)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const panelEl = q('[data-v2-panel]');
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');
    const capNoteEl = q('[data-v2-cap-note]');
    const segHost = q('[data-v2-seg]');
    const shortageBody = q('[data-v2-shortage-body]');
    let status = 'all';

    /* ── الاسم والشعار — من صف الإعدادات الواحد ─────────────────────────── */

    async function ensureSettings() {
        if (settingsState) {return settingsState;}
        try {settingsState = await fetchPRSettings();}
        catch (_) {settingsState = {name: '', logoB64: ''};}
        return settingsState;
    }

    /* ── الجدول ─────────────────────────────────────────────────────────── */

    const table = createDataTable({
        caption: 'طلبات شراء النواقص — بيانات حية',
        mode: 'client', pageSize: 50, stickyHeader: true,
        emptyMessage: 'لا توجد طلبات بهذه الحالة', emptyHint: 'غيّر الفلتر.', rowKey: (r) => r.id,
        columns: [
            { key: 'number', header: 'الطلب', sortable: true, filterable: true, width: '110px', className: 'erp-mono' },
            { key: 'itemsText', header: 'الأصناف والكميات', filterable: true, render: (r) => esc(r.itemsText) },
            {
                key: 'status', header: 'الحالة', sortable: true, filterable: true, width: '150px',
                value: (r) => r.status,
                render: (r) => r.status ? statusBadge('purchase_request', r.status) : `<span class="erp-text-muted">—</span>`,
            },
            { key: 'by', header: 'أنشأها', sortable: true, filterable: true, width: '140px' },
            {
                key: 'created', header: 'التاريخ', sortable: true, width: '120px', align: 'center', className: 'erp-tnum',
                render: (r) => (r.created ? `<span class="erp-num" dir="ltr">${esc(r.created)}</span>` : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'chefSigned', header: 'توقيع الشيف', width: '140px',
                render: (r) => (r.chefSigned ? esc(r.chefSigned) : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'gmSigned', header: 'اعتماد المدير', width: '140px',
                render: (r) => (r.gmSigned ? esc(r.gmSigned) : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'whReceived', header: 'استلام المخزن', width: '140px',
                render: (r) => (r.whReceived ? esc(r.whReceived) : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'actions', header: 'إجراءات', width: '340px', className: 'erp-v2-wh-prs-actions',
                render: (r) => rowActionsHtml(r._raw || {}),
            },
        ],
    });
    q('[data-v2-table]').appendChild(table.el);

    function btn(act, id, icon, label, extraClass = '') {
        return `<button type="button" class="erp-btn erp-btn--sm ${extraClass}" data-v2-act="${act}" data-id="${esc(String(id))}">
          <i class="ji" data-i="${icon}" aria-hidden="true"></i><span>${esc(label)}</span></button>`;
    }

    /** أزرار الصف — نفس ترتيب القديم :495 وبنفس شروطه (والكلمة للخادم). */
    function rowActionsHtml(raw) {
        if (!raw || raw.id === undefined) {return '—';}
        const id = raw.id;
        const out = [btn('view', id, 'eye', 'عرض')];
        if (chefActionsVisible(role, raw.status)) {
            out.push(btn('chef-approve', id, 'chef-hat', 'توقيع الشيف', 'erp-btn--primary'));
            out.push(btn('chef-reject', id, 'circle-x', 'رفض', 'erp-btn--danger'));
        }
        if (gmActionsVisible(role, raw.status)) {
            out.push(btn('gm-approve', id, 'circle-check', 'اعتماد المدير العام', 'erp-btn--primary'));
            out.push(btn('gm-reject', id, 'circle-x', 'رفض', 'erp-btn--danger'));
        }
        if (cancelVisible(role, raw.status)) {out.push(btn('cancel', id, 'circle-x', 'إلغاء', 'erp-btn--danger'));}
        if (deleteVisible(role, raw.status)) {out.push(btn('delete', id, 'trash', 'حذف نهائي', 'erp-btn--danger'));}
        if (printVisible(raw.status)) {out.push(btn('print', id, 'printer', 'طباعة'));}
        return out.join('');
    }

    /* ── اللوحة: غلاف ومكوّنات مشتركة ───────────────────────────────────── */

    function panelShell(title, icon, bodyHtml) {
        return `<div class="erp-wh-prs-panel">
          <div class="erp-wh-prs-panel__head">
            <h3><i class="ji" data-i="${esc(icon)}" aria-hidden="true"></i> ${title}</h3>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close>
              <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
            </button>
          </div>
          <div class="erp-wh-prs-panel__body erp-stack">${bodyHtml}</div>
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
          <div class="erp-wh-prs-panel__actions">
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

    /* ── لوحة الإنشاء: نواقص مختارة + صفوف يدوية + قسم + توقيع ──────────── */

    function manualRowHtml() {
        return `<div class="erp-manual-row" data-v2-manual>
          <label class="erp-field erp-manual-row__name"><span class="erp-label">الصنف</span>
            <input class="erp-input" type="text" data-m="name" list="v2pr-inv-names" placeholder="اسم الصنف"></label>
          <label class="erp-field"><span class="erp-label">الوحدة</span>
            <input class="erp-input" type="text" data-m="unit" value="وحدة"></label>
          <label class="erp-field"><span class="erp-label">الكمية المطلوبة</span>
            <input class="erp-input" type="number" data-m="qty" min="0" step="0.001" value="0"></label>
          <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-remove-manual title="حذف الصف" aria-label="حذف الصف">
            <i class="ji" data-i="trash" aria-hidden="true"></i></button>
        </div>`;
    }

    function createHtml(shorts, depts, invNames) {
        const chef = isChefCreator(role);
        const shortageRows = shorts.map((s, idx) => `<tr data-pr-shortage data-item-id="${esc(String(s.itemId ?? ''))}"
            data-item-name="${esc(String(s.itemName || ''))}" data-unit="${esc(String(s.unit || 'وحدة'))}">
            <td><input type="checkbox" data-pr-sel data-idx="${idx}" checked aria-label="اختيار ${esc(String(s.itemName || ''))}"></td>
            <td class="fw-bold">${esc(String(s.itemName || '—'))}</td>
            <td>${esc(String(s.unit || ''))}</td>
            <td class="erp-text-danger">${formatQty(s.currentQty)}</td>
            <td class="erp-tnum">${formatQty(s.minQty)}</td>
            <td><input class="erp-input" type="number" data-pr-qty min="0" step="0.001" value="${Number(s.suggestedQty || 0)}"
              aria-label="الكمية المطلوبة من ${esc(String(s.itemName || ''))}"></td>
          </tr>`).join('') || `<tr><td colspan="6" class="erp-text-muted">لا توجد نواقص حاليًا (كل الأصناف فوق الحد الأدنى) — أضف يدويًا بالأسفل</td></tr>`;
        const deptOptions = filterPRDeptOptions(depts).map((d, i) => `<option value="${esc(d.code)}"${i === 0 ? ' selected' : ''}>${esc(d.name || d.code)}</option>`).join('');
        const banner = chef
            ? 'توقيعك على الطلب يجعله <strong>نهائيًا</strong> ويوصله <strong>للمخزن مباشرة</strong> — أمين المخزن يطبعه وينفذه فورًا (بدون مرحلة المدير العام).'
            : 'علّم على أصناف النواقص وعدّل الكمية المطلوبة، أو أضف أصنافًا يدويًا (خضار وغيرها) — بعد الإنشاء يوقّع <strong>الشيف</strong> ثم يعتمد <strong>المدير العام</strong> نهائيًا (مغلق — البضاعة تدخل بفواتير المشتريات).';
        return panelShell('طلب شراء نواقص جديد', 'shopping-cart',
            `<div class="erp-flow-note" data-tone="info">${banner}</div>
             <div class="erp-v2-wh-prs__scroll">
               <table class="erp-table">
                 <caption class="erp-text-sm erp-text-muted" style="text-align:start">نواقص المخزن (${formatInt(shorts.length)})</caption>
                 <thead><tr>
                   <th><input type="checkbox" data-v2-sel-all checked aria-label="تحديد الكل"></th>
                   <th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>الحد الأدنى</th><th>المطلوب شراؤه</th>
                 </tr></thead>
                 <tbody>${shortageRows}</tbody>
               </table>
             </div>
             <div class="erp-v2-wh-prs__scroll">
               <div class="erp-wh-prs-panel__subhead">
                 <span>إضافة يدوية</span>
                 <button type="button" class="erp-btn erp-btn--sm" data-v2-add-manual>
                   <i class="ji" data-i="plus" aria-hidden="true"></i><span>صف جديد</span></button>
               </div>
               <div class="erp-stack" data-v2-manual-box></div>
               <datalist id="v2pr-inv-names">${invNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
             </div>
             <label class="erp-field"><span class="erp-label">القسم الطالب (تُحسب عليه التكلفة عند التسليم المباشر)</span>
               <select class="erp-input" data-f="dept">${deptOptions}</select></label>
             <label class="erp-field"><span class="erp-label">ملاحظات الطلب (اختياري)</span>
               <textarea class="erp-input" data-f="notes" rows="2" placeholder="مثال: أولوية للسلطات قبل نهاية الأسبوع"></textarea></label>
             ${chef ? signaturePadMarkup(SIG_IDS.prCreate, 'توقيع الشيف على الطلب', signerName) : ''}
             ${panelActions(chef ? 'توقيع وإرسال للمخزن' : 'إنشاء الطلب', 'shopping-cart')}`);
    }

    async function openCreatePanel(seq) {
        const title = 'طلب شراء نواقص جديد';
        setPanel(panelLoading(title, 'shopping-cart'));
        try {
            const [shorts, depts, invNames] = await Promise.all([
                fetchShortages(), fetchPRDepartments(), fetchPRInventoryNames(),
            ]);
            if (!panelAlive(seq)) {return;}
            setPanel(createHtml(shorts, depts, invNames));
            if (isChefCreator(role)) {initSignaturePad(panelEl, SIG_IDS.prCreate, signerName);}
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            retryState = { kind: 'create', raw: null };
            setPanel(panelRetry(title, 'shopping-cart', `تعذر تجهيز اللوحة: ${(e && e.message) || 'خطأ في القراءة'}`));
        }
    }

    /* ── لوحات القرار ───────────────────────────────────────────────────── */

    function itemLineHtml(i, withBalance) {
        const name = esc(String(i.itemName || i.name || '—'));
        const qty = i.requestedQty ?? i.qty ?? 0;
        const unit = esc(String(i.unit || ''));
        return `<div class="erp-pr-line">
          <div class="erp-pr-line__row">
            <strong>${name}</strong>
            <span class="erp-badge" data-tone="info">${formatQty(qty)} ${unit}</span>
          </div>
          ${withBalance && i.currentQty != null
                ? `<small class="erp-text-sm erp-text-muted">الرصيد: ${formatQty(i.currentQty)} — الحد الأدنى: ${i.minQty != null ? formatQty(i.minQty) : '—'}</small>`
                : ''}
        </div>`;
    }

    function chefApproveHtml(raw) {
        const items = Array.isArray(raw.items) ? raw.items : [];
        return panelShell(`توقيع الشيف — ${esc(raw.request_number || ('#' + raw.id))}`, 'chef-hat',
            `<div class="erp-flow-note" data-tone="info">توقيعك يحيل الطلب إلى <strong>المدير العام</strong> للاعتماد النهائي — لا يحرك أي مخزون.</div>
             <div class="erp-stack">${items.map((i) => itemLineHtml(i, true)).join('')}</div>
             <label class="erp-field"><span class="erp-label">ملاحظات الشيف (اختياري)</span>
               <textarea class="erp-input" data-f="notes" rows="2"></textarea></label>
             ${signaturePadMarkup(SIG_IDS.chefApprove, 'توقيع الشيف العمومي', signerName)}
             ${panelActions('توقيع وإحالة للمدير العام', 'circle-check')}`);
    }

    function chefRejectHtml(raw) {
        return panelShell(`رفض الشيف — ${esc(raw.request_number || ('#' + raw.id))}`, 'circle-x',
            `<label class="erp-field"><span class="erp-label">سبب الرفض</span>
               <textarea class="erp-input" data-f="reason" rows="3"
                 placeholder="مثال: الكمية مبالغ فيها / الصنف متوفر ببديل"></textarea></label>
             ${signaturePadMarkup(SIG_IDS.chefReject, 'توقيع الشيف على الرفض', signerName)}
             ${panelActions('تأكيد الرفض', 'circle-x')}`);
    }

    function gmApproveHtml(raw) {
        const items = Array.isArray(raw.items) ? raw.items : [];
        return panelShell(`اعتماد المدير العام — ${esc(raw.request_number || ('#' + raw.id))}`, 'crown',
            `<div class="erp-flow-note" data-tone="brand">وقّع الشيف <strong>${esc(raw.chef_approved_name || '—')}</strong>
               بتاريخ ${esc(fDT(raw.chef_approved_at))} — اعتمادك نهائي ويُغلق الطلب (طلب فقط بلا حركة مخزون).</div>
             <div class="erp-stack">${items.map((i) => itemLineHtml(i, false)).join('')}</div>
             <label class="erp-field"><span class="erp-label">ملاحظات المدير العام (اختياري)</span>
               <textarea class="erp-input" data-f="notes" rows="2"></textarea></label>
             ${signaturePadMarkup(SIG_IDS.gmApprove, 'توقيع المدير العام', signerName)}
             ${panelActions('اعتماد نهائي', 'circle-check')}`);
    }

    function gmRejectHtml(raw) {
        return panelShell(`رفض المدير العام — ${esc(raw.request_number || ('#' + raw.id))}`, 'circle-x',
            `<label class="erp-field"><span class="erp-label">سبب الرفض</span>
               <textarea class="erp-input" data-f="reason" rows="3"></textarea></label>
             ${signaturePadMarkup(SIG_IDS.gmReject, 'توقيع المدير العام على الرفض', signerName)}
             ${panelActions('تأكيد الرفض', 'circle-x')}`);
    }

    /* ── التفاصيل: السلسلة كاملة + الأصناف (القديم :629-637) ────────────── */

    function detailsHtml(raw) {
        const items = Array.isArray(raw.items) ? raw.items : [];
        const modeBadge = raw.deliver_mode === 'direct'
            ? '<span class="erp-badge" data-tone="brand">تسليم مباشر (مصروف فوري)</span>'
            : (raw.deliver_mode === 'mixed'
                ? '<span class="erp-badge" data-tone="info">تسليم مختلط</span>'
                : (raw.deliver_mode ? '<span class="erp-badge" data-tone="info">دخول مخزن</span>' : ''));
        const chain = [
            `<div class="erp-flow-note" data-tone="info"><i class="ji" data-i="user" aria-hidden="true"></i>
               أنشأ <strong>${esc(raw.creator_name || '—')}</strong> الطلب بتاريخ ${esc(fDT(raw.created_at))}.</div>`,
            raw.chef_approved_name
                ? `<div class="erp-flow-note" data-tone="brand"><i class="ji" data-i="chef-hat" aria-hidden="true"></i>
                    وقّع الشيف <strong>${esc(raw.chef_approved_name)}</strong> بتاريخ ${esc(fDT(raw.chef_approved_at))}${raw.chef_notes ? ` — ${esc(raw.chef_notes)}` : ''}.</div>`
                : `<div class="erp-flow-note" data-tone="warning"><i class="ji" data-i="hourglass" aria-hidden="true"></i> بانتظار توقيع الشيف.</div>`,
            raw.gm_approved_name
                ? `<div class="erp-flow-note" data-tone="success"><i class="ji" data-i="crown" aria-hidden="true"></i>
                    اعتمد المدير العام <strong>${esc(raw.gm_approved_name)}</strong> بتاريخ ${esc(fDT(raw.gm_approved_at))} اعتمادًا نهائيًا${raw.gm_notes ? ` — ${esc(raw.gm_notes)}` : ''}.</div>`
                : (raw.status === 'chef_approved'
                    ? `<div class="erp-flow-note" data-tone="warning"><i class="ji" data-i="hourglass" aria-hidden="true"></i> بانتظار اعتماد المدير العام.</div>`
                    : ''),
            raw.wh_received_name
                ? `<div class="erp-flow-note" data-tone="info"><i class="ji" data-i="inbox" aria-hidden="true"></i>
                    استلم المخزن <strong>${esc(raw.wh_received_name)}</strong> بتاريخ ${esc(fDT(raw.wh_received_at))} — دخلت البضاعة المخزون.</div>`
                : '',
            raw.status === 'rejected'
                ? `<div class="erp-flow-note" data-tone="danger"><i class="ji" data-i="circle-x" aria-hidden="true"></i>
                    مرفوض بواسطة <strong>${esc(raw.rejected_name || '—')}</strong>: ${esc(raw.rejection_reason || '—')}</div>`
                : '',
        ].join('');
        const itemRows = items.map((i) => `<tr>
            <td class="fw-bold">${esc(String(i.itemName || i.name || '—'))}</td>
            <td>${esc(String(i.unit || '—'))}</td>
            <td class="erp-tnum">${formatQty(i.requestedQty ?? i.qty)}</td>
            <td class="erp-tnum">${i.currentQty != null ? formatQty(i.currentQty) : '—'}</td>
          </tr>`).join('') || `<tr><td colspan="4" class="erp-text-muted">لا أصناف</td></tr>`;
        return panelShell(`طلب الشراء ${esc(raw.request_number || ('#' + raw.id))} — ${statusBadge('purchase_request', raw.status)}`, 'shopping-cart',
            `<div class="erp-pr-line__row">
               <span class="erp-badge" data-tone="neutral">القسم الطالب: ${esc(raw.dept_name || raw.dept_code || '—')}</span>
               ${modeBadge}
             </div>
             <div class="erp-v2-wh-prs__scroll">
               <table class="erp-table">
                 <caption class="erp-text-sm erp-text-muted" style="text-align:start">الأصناف (${formatInt(items.length)})</caption>
                 <thead><tr><th>الصنف</th><th>الوحدة</th><th>المطلوب</th><th>الرصيد وقت الإنشاء</th></tr></thead>
                 <tbody>${itemRows}</tbody>
               </table>
             </div>
             ${raw.notes ? `<div class="erp-flow-note" data-tone="neutral"><strong>ملاحظات الطلب:</strong> ${esc(raw.notes)}</div>` : ''}
             ${chain}
             <div class="erp-wh-prs-panel__actions">
               ${btn('print', raw.id, 'printer', 'طباعة')}
               <span class="erp-grow"></span>
               <button type="button" class="erp-btn erp-btn--primary" data-v2-panel-close>إغلاق</button>
             </div>`);
    }

    /* ── فتح اللوحة وتوجيه الأزرار ──────────────────────────────────────── */

    function requiresSignature(kind) {
        return SIGN_KINDS.has(kind) || (kind === 'create' && isChefCreator(role));
    }

    async function openPanel(kind, raw) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (requiresSignature(kind) && !signerName) {
            notify('اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع');
            return;
        }
        if (kind === 'create' && !PR_CREATE_ROLES.includes(role)) {
            notify('إنشاء طلبات الشراء للمطبخ (الشيف) والمخزن والإدارة فقط');
            return;
        }
        if ((kind === 'chef-approve' || kind === 'chef-reject') && !chefActionsVisible(role, raw && raw.status)) {
            notify('توقيع الشيف للطلبات المعلقة ولمن يملك الدور');
            return;
        }
        if ((kind === 'gm-approve' || kind === 'gm-reject') && !gmActionsVisible(role, raw && raw.status)) {
            notify('اعتماد المدير العام للطلبات الموقّعة من الشيف ولمن يملك الدور');
            return;
        }
        closePanel();
        const seq = panelSeq;
        panelKind = kind;
        panelRaw = raw;
        panelEl.hidden = false;

        if (kind === 'create') {await openCreatePanel(seq); return;}
        if (kind === 'view') {setPanel(detailsHtml(raw)); return;}
        if (kind === 'chef-approve') {setPanel(chefApproveHtml(raw)); initSignaturePad(panelEl, SIG_IDS.chefApprove, signerName); return;}
        if (kind === 'chef-reject') {setPanel(chefRejectHtml(raw)); initSignaturePad(panelEl, SIG_IDS.chefReject, signerName); return;}
        if (kind === 'gm-approve') {setPanel(gmApproveHtml(raw)); initSignaturePad(panelEl, SIG_IDS.gmApprove, signerName); return;}
        if (kind === 'gm-reject') {setPanel(gmRejectHtml(raw)); initSignaturePad(panelEl, SIG_IDS.gmReject, signerName);}
    }

    /* ── إلغاء وحذف ─────────────────────────────────────────────────────── */

    async function confirmCancel(raw) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const ok = await confirmFn('إلغاء طلب الشراء المعلّق؟');
        if (!ok) {return;}
        busy = true;
        try {
            await cancelPR(raw.id);
            closePanel();
            notify('أُلغي طلب الشراء');
            await reload();
        } catch (e) {
            notify((e && e.message) || 'تعذر إلغاء الطلب');
        } finally {
            busy = false;
        }
    }

    async function confirmDelete(raw) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const ok = await confirmFn('حذف نهائي لهذا الطلب؟ لا يمكن التراجع.');
        if (!ok) {return;}
        busy = true;
        try {
            await deletePR(raw.id);
            closePanel();
            notify('حُذف الطلب نهائيًا');
            await reload();
        } catch (e) {
            notify((e && e.message) || 'تعذر حذف الطلب');
        } finally {
            busy = false;
        }
    }

    /* ── إرسال لوحات القرار ─────────────────────────────────────────────── */

    async function submitCreate() {
        const shortageRows = [...panelEl.querySelectorAll('[data-pr-shortage]')]
            .filter((r) => r.querySelector('[data-pr-sel]')?.checked)
            .map((r) => ({
                itemId: r.dataset.itemId,
                itemName: r.dataset.itemName,
                unit: r.dataset.unit,
                qty: r.querySelector('[data-pr-qty]')?.value,
            }));
        const manualRows = [...panelEl.querySelectorAll('[data-v2-manual]')].map((r) => ({
            name: r.querySelector('[data-m=name]')?.value || '',
            unit: r.querySelector('[data-m=unit]')?.value || '',
            qty: r.querySelector('[data-m=qty]')?.value,
        }));
        const items = collectPRItems(shortageRows, manualRows);
        const err = prCreateError(items);
        if (err) {panelMsg(err); return;}
        const chef = isChefCreator(role);
        let sig = null;
        if (chef) {
            sig = readSig(SIG_IDS.prCreate);
            if (sig == null) {return;}
        }
        const notes = panelEl.querySelector('[data-f=notes]')?.value || '';
        const deptCode = panelEl.querySelector('[data-f=dept]')?.value || '';
        busy = true;
        try {
            const saved = await createPR(prCreatePayload({
                items, notes, deptCode,
                signatureData: chef ? sig : null,
                signerName: chef ? signerName : null,
            }));
            closePanel();
            notify(chef
                ? `أُنشئ طلب الشراء ${saved.request_number} موقّعًا منك — نهائي ولدى المخزن مباشرة`
                : `أُنشئ طلب الشراء ${saved.request_number} — بانتظار توقيع الشيف`);
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر إنشاء طلب الشراء');
        } finally {
            busy = false;
        }
    }

    async function submitChefApprove() {
        const raw = panelRaw;
        const sig = readSig(SIG_IDS.chefApprove);
        if (sig == null) {return;}
        const notes = panelEl.querySelector('[data-f=notes]')?.value || '';
        busy = true;
        try {
            await chefApprovePR(raw.id, prNotesPayload(notes, sig, signerName));
            closePanel();
            notify('وقّع الشيف — الطلب الآن بانتظار المدير العام');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر توقيع الشيف');
        } finally {
            busy = false;
        }
    }

    async function submitChefReject() {
        const raw = panelRaw;
        const reason = panelEl.querySelector('[data-f=reason]')?.value || '';
        const reasonErr = prReasonError(reason);
        if (reasonErr) {panelMsg(reasonErr); return;}
        const sig = readSig(SIG_IDS.chefReject);
        if (sig == null) {return;}
        busy = true;
        try {
            await chefRejectPR(raw.id, prRejectPayload(reason, sig, signerName));
            closePanel();
            notify('رفض الشيف الطلب');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر رفض الطلب');
        } finally {
            busy = false;
        }
    }

    async function submitGmApprove() {
        const raw = panelRaw;
        const sig = readSig(SIG_IDS.gmApprove);
        if (sig == null) {return;}
        const notes = panelEl.querySelector('[data-f=notes]')?.value || '';
        busy = true;
        try {
            await gmApprovePR(raw.id, prNotesPayload(notes, sig, signerName));
            closePanel();
            notify('اعتمد المدير العام الطلب نهائيًا');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر اعتماد المدير العام');
        } finally {
            busy = false;
        }
    }

    async function submitGmReject() {
        const raw = panelRaw;
        const reason = panelEl.querySelector('[data-f=reason]')?.value || '';
        const reasonErr = prReasonError(reason);
        if (reasonErr) {panelMsg(reasonErr); return;}
        const sig = readSig(SIG_IDS.gmReject);
        if (sig == null) {return;}
        busy = true;
        try {
            await gmRejectPR(raw.id, prRejectPayload(reason, sig, signerName));
            closePanel();
            notify('رفض المدير العام الطلب');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر رفض الطلب');
        } finally {
            busy = false;
        }
    }

    function submitPanel() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (panelKind === 'create') {submitCreate(); return;}
        if (panelKind === 'chef-approve') {submitChefApprove(); return;}
        if (panelKind === 'chef-reject') {submitChefReject(); return;}
        if (panelKind === 'gm-approve') {submitGmApprove(); return;}
        if (panelKind === 'gm-reject') {submitGmReject();}
    }

    /* ── ورقة الطباعة A4 — منسوخة الحقول من printPR (kitchen.js:638-645) ── */

    function absoluteLogo(settings) {
        const b64 = settings && settings.logoB64 ? settings.logoB64 : '';
        if (/^data:image\//i.test(b64)) {return b64;}
        return `${window.location.origin}/app/assets/karim-logo.ico`;
    }

    async function printNote(raw) {
        const w = openInAppReport(`طلب شراء ${raw.request_number || ('#' + raw.id)}`);
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>طلب شراء ${esc(raw.request_number || '')}</title></head><body style="font-family:'Cairo',Tahoma,Arial,sans-serif;padding:24px">جارٍ تجهيز طلب الشراء…</body></html>`);
        const settings = await ensureSettings();
        const items = Array.isArray(raw.items) ? raw.items : [];
        const sigBlock = (label, who, at) => `<div style="text-align:center;min-width:160px;flex:1"><div style="height:44px"></div><div style="border-top:1px solid #333;padding-top:5px;font-size:12px;color:#444">${esc(label)}${who ? `<br><b style="color:#222">${esc(who)}</b>${at ? `<br><small>${esc(fDT(at))}</small>` : ''}` : '<br>........'}</div></div>`;
        const pRow = (i, ix) => `<tr><td>${ix + 1}</td><td style="text-align:right">${esc(String(i.itemName || i.name || '—'))}</td><td>${esc(String(i.unit || ''))}</td><td class="c-gold fw-bold">${formatQty(i.requestedQty ?? i.qty)}</td></tr>`;
        const doc = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>طلب شراء ${esc(raw.request_number || ('#' + raw.id))}</title><style>*{box-sizing:border-box}body{font-family:'Cairo',Tahoma,Arial,sans-serif;color:#1a1a1a;background:#eef2f7;margin:0;padding:32px 36px;direction:rtl}.sheet{max-width:800px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 8px 28px rgba(15,23,42,.10);padding:22px 24px 20px}.head{display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);border-bottom:4px solid #c9a227;border-radius:12px 12px 0 0;padding:18px 24px;margin:-22px -24px 16px}.doc-logo{width:74px;height:74px;object-fit:contain;background:#fff;border:2px solid #c9a227;border-radius:14px;padding:5px;box-shadow:0 2px 10px rgba(0,0,0,.35)}.head h1{margin:0;color:#f5d76e;font-size:24px}.head p{margin:2px 0;color:#cbd5e1;font-size:13px}.doc-title{text-align:center;margin:14px 0 4px}.doc-title h2{margin:0;font-size:22px;letter-spacing:.5px;color:#0f172a}.doc-title .st{display:inline-block;margin-top:8px;padding:4px 20px;border:0;border-radius:20px;font-size:12px;font-weight:800;color:#f5d76e;background:#0f172a;letter-spacing:.3px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.meta div{border:1px solid #e5e7eb;border-right:4px solid #c9a227;border-radius:10px;padding:8px 12px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.05)}.meta b{display:block;color:#8a6d1b;font-size:11px;margin-bottom:2px}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13.5px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#0f172a;color:#f5d76e;font-size:12px;letter-spacing:.3px}tbody tr:nth-child(even) td{background:#f8fafc}.notes{margin-top:12px;border:1px solid #e5e7eb;border-right:4px solid #c9a227;border-radius:10px;padding:10px 14px;font-size:13px;min-height:44px;background:#fffbeb}.sigs{display:flex;gap:14px;margin-top:34px}.foot{margin-top:18px;text-align:center;font-size:11px;color:#888;border-top:2px solid #c9a227;padding-top:8px}.controls{text-align:center;margin-bottom:18px}.controls button{border:0;border-radius:7px;padding:10px 26px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff;font-weight:700}.controls button.secondary{background:#555}@media print{body{padding:0;background:#fff}.sheet{box-shadow:none;border:0;border-radius:0}.head,.head h1,th,.doc-title .st{print-color-adjust:exact;-webkit-print-color-adjust:exact}.controls{display:none!important}@page{size:A4;margin:11mm}}</style></head><body><div class="controls"><button onclick="window.print()">🖨 طباعة</button><button class="secondary" onclick="window.close()">إغلاق</button></div><main class="sheet"><header class="head"><img class="doc-logo" src="${esc(absoluteLogo(settings))}" alt="الشعار"><div><h1>${esc(settings.name || 'مطاعم الشرفه العالمي')}</h1><p>نظام إدارة المخازن والمطاعم</p></div></header><div class="doc-title"><h2>طلب شراء نواقص — ${esc(raw.request_number || ('#' + raw.id))}</h2><span class="st">${esc(statusLabelOf(raw.status))}</span></div><section class="meta"><div><b>التاريخ</b>${esc(fD(raw.created_at))}</div><div><b>القسم الطالب</b>${esc(raw.dept_name || raw.dept_code || '—')}</div><div><b>المنشئ</b>${esc(raw.creator_name || '—')}</div><div><b>عدد الأصناف</b>${formatInt(items.length)}</div></section><table><thead><tr><th style="width:36px">#</th><th>الصنف</th><th>الوحدة</th><th>الكمية المطلوبة</th></tr></thead><tbody>${items.map(pRow).join('') || '<tr><td colspan="4">لا أصناف</td></tr>'}</tbody></table><div class="notes"><b>ملاحظات:</b> ${esc(raw.notes || 'لا توجد')}${raw.rejection_reason ? `<br><b>سبب الرفض:</b> ${esc(raw.rejection_reason)} (${esc(raw.rejected_name || '—')})` : ''}</div><div class="sigs">${sigBlock('توقيع أمين المخزن', raw.creator_name, raw.created_at)}${sigBlock('توقيع الشيف', raw.chef_approved_name, raw.chef_approved_at)}${sigBlock('اعتماد المدير العام', raw.gm_approved_name, raw.gm_approved_at)}${sigBlock('استلام المخزن', raw.wh_received_name, raw.wh_received_at)}</div><div class="foot">مستند شراء إلكتروني — ${esc(settings.name || '')} — طُبع بتاريخ ${esc(fDT(new Date().toISOString()))}</div></main></body></html>`;
        w.document.open();
        w.document.write(doc);
        w.document.close();
        w.focus();
        w.print();
    }

    /* ── القراءة والرسم ────────────────────────────────────────────────── */

    function paintSeg() {
        const counts = STATUS_FILTERS.reduce((a, s) => ({ ...a, [s]: s === 'all' ? rawRows.length : rawRows.filter((r) => r.status === s).length }), {});
        segHost.innerHTML = `<div class="erp-seg" role="group" aria-label="حالة الطلب">`
            + STATUS_FILTERS.map((s) => `<button type="button" data-v2-status="${s}"`
                + `${s === status ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>`
                + `${esc(STATUS_AR[s])} (${counts[s]})</button>`).join('')
            + `</div>`;
    }

    function paintShortage() {
        if (!shortages.length) {
            shortageBody.innerHTML = '<span class="erp-text-muted">لا توجد نواقص حاليًا (كل الأصناف فوق الحد الأدنى).</span>';
            return;
        }
        shortageBody.innerHTML = `<div class="erp-v2-wh-prs__scroll"><table class="erp-table"><thead><tr><th>الصنف</th><th>الرصيد</th><th>الحد</th><th>عجز مقترح</th></tr></thead><tbody>` +
            shortages.map((s) => `<tr><td>${esc(s.itemName || '—')}</td><td class="erp-tnum">${formatQty(s.currentQty)}</td><td class="erp-tnum">${formatQty(s.minQty)}</td><td class="erp-tnum">${formatQty(s.suggestedQty)}</td></tr>`).join('') +
            `</tbody></table></div>`;
    }

    function paint() {
        const view = rawRows.map((r) => ({ ...purchaseRequestToRow(r), _raw: r }));
        const shown = status === 'all' ? view : view.filter((r) => r.status === status);
        table.setRows(shown);
        const c = summarizePR(rawRows);
        summaryEl.textContent = `${formatInt(shown.length)} طلبًا (من ${formatInt(rawRows.length)}) · معلقة ${formatInt(c.pending)} · موقّعة ${formatInt(c.chefApproved)} · معتمدة ${formatInt(c.approved)}`;
        countEl.textContent = shown.length ? `(${formatInt(shown.length)})` : '';
        capNoteEl.hidden = !(rawRows.length >= PR_LIST_CAP);
        if (!capNoteEl.hidden) {
            capNoteEl.textContent = `السجل يسقف عند أحدث ${formatInt(PR_LIST_CAP)} طلبًا (warehouse-routes.js:3215) — ما قبلها خارج هذه النافذة.`;
        }
        paintSeg();
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        const seq = ++readSeq;
        if (!rawRows.length) {table.setLoading(true);}
        try {
            const [prs, sh] = await Promise.all([fetchPurchaseRequests(), fetchShortages()]);
            if (!el.isConnected || seq !== readSeq) {return;}   // destroyed / newer read wins
            rawRows = prs;
            rawById = new Map(prs.map((r) => [String(r.id), r]));
            shortages = sh;
            paint();
            paintShortage();
        } catch (e) {
            if (!el.isConnected || seq !== readSeq) {return;}
            rawRows = [];
            rawById = new Map();
            shortages = [];
            table.setRows([]);
            summaryEl.textContent = '';
            countEl.textContent = '';
            capNoteEl.hidden = true;
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN' ? 'لا صلاحية لعرض طلبات النواقص بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل الطلبات: ${(e && e.message) || 'خطأ'}`));
            paintSeg();
            paintShortage();
        } finally {
            loading = false;
        }
    }

    /* ── التفويض: نقرة واحدة تخدم كل اللوحات (CSP: لا معالج سطري) ──────── */

    el.addEventListener('click', (event) => {
        const seg = event.target.closest('[data-v2-status]');
        if (seg) {
            status = seg.getAttribute('data-v2-status');
            const view = rawRows.map((r) => ({ ...purchaseRequestToRow(r), _raw: r }));
            const shown = status === 'all' ? view : view.filter((r) => r.status === status);
            table.setRows(shown);
            countEl.textContent = shown.length ? `(${formatInt(shown.length)})` : '';
            paintSeg();
            return;
        }
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            const raw = rawById.get(String(actBtn.dataset.id));
            if (!raw) {notify('تعذر العثور على الطلب — حدّث القائمة'); return;}
            const act = actBtn.dataset.v2Act;
            if (act === 'print') {printNote(raw); return;}
            if (act === 'cancel') {confirmCancel(raw); return;}
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
        if (event.target.closest('[data-v2-add-manual]')) {
            const box = panelEl.querySelector('[data-v2-manual-box]');
            if (box) {box.insertAdjacentHTML('beforeend', manualRowHtml());}
            return;
        }
        const removeManual = event.target.closest('[data-v2-remove-manual]');
        if (removeManual) {
            removeManual.closest('[data-v2-manual]')?.remove();
            return;
        }
        if (event.target.closest('[data-v2-new]')) {openPanel('create', null); return;}
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-v2-reload]') || event.target.closest('[data-erp-retry]')) {reload();}
    });

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-sel-all]')) {
            const on = event.target.checked;
            for (const cb of panelEl.querySelectorAll('[data-pr-sel]')) {cb.checked = on;}
        }
    });

    reload();

    return {
        el,
        reload,
        getRows: () => (status === 'all' ? rawRows : rawRows.filter((r) => r.status === status)),
        destroy() {
            panelSeq += 1;
            disposeSignaturePads(ALL_SIG_IDS);
            table.destroy();
            el.remove();
        },
    };
}
