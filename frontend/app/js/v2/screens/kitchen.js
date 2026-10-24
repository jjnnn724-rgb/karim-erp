/**
 * V2 — Kitchen screen · شاشة 09 في سجل الترحيل (W1-2: نظرة + دورة المطبخ)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * W1-2 (2026-10-15): الشاشة كانت قراءةً فقط؛ صارت تنفّذ دورة المطبخ كاملة
 * بنفس عقد الشاشات 01–12 وسجل 13 (W1-1):
 *   أمر إنتاج وتوزيع (ثلاث خطوات) · استلام مواد (تحويل استثنائي رئيسي→مطبخ) ·
 *   جرد ذكي (إنشاء · عدّ · إرسال بتوقيع · اعتماد بتوقيع) —
 *   فوق النظرة التشغيلية التي كانت عليها (أوامر/استثناءات/سياسات/توزيعات).
 *
 * قواعد لم تُخترع:
 *   • الباب الواحد للشبكة: js/v2/data/kitchen-repo.js — لا fetch/ apiFetch
 *     في هذا الملف (الاختبارات تفرضه نصيًا).
 *   • النصوص والحمولات منسوخة من features/kitchen.js (التحقق :69-76،
 *     التوزيع :74، العدّ :93-94) — بما فيها انحرافان معلنان:
 *     ١) إرسال الجرد يقرأ التوقيع أولًا ثم يحفظ العدّ (القديم :94 يحفظ ثم
 *        يقرأ) — لا معنى لحفظ عدٍّ لا يُرسل.
 *     ٢) استلام المواد يقلّص الكمية المخزَّنة عند تغيير الصنف (القديم :120
 *        كان يقلّص الخانة وحدها ويترك الحالة القديمة تُرسل).
 *   • `reference` غائب عمدًا من حمولة الاستلام ليعمل حارس التكرار الخادمي
 *     (kitchen-production-routes.js:156) — القديم كان يعطّله (kitchen.js:124).
 *   • التواقيع عبر js/v2/signature.js المقفلة على اسم الحساب، ويحسمها
 *     الخادم (requireSignature). بلا اسم حساب لا يكتمل قرار موقّع.
 *   • أزرار الكتابة تظهر حسب الدور (WRITE الخادمية :12) والخادم يعيد
 *     الفحص دائمًا — الواجهة تعرض، والقرار للخادم.
 *
 * THE WINDOW IS DISCLOSED, NOT HIDDEN
 *   نظرة التشغيل: أحدث 100 أمر، 100 استثناء، 300 توزيع (kitchen-production-
 *   routes.js:147-150)؛ سجل الجرد LIMIT 50 (:328) والمستندات LIMIT 100
 *   (:327). كل رقم على الصفحة محسوب على نافذته، وcapNote() تقولها حين تمتلئ.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.151';
import { statusBadge, resolveStatus } from '../status.js?v=4.9.151';
import { formatInt, formatQty, formatMoney } from '../data/reports-repo.js?v=4.9.151';
import { openInAppReport } from '../report-viewer.js?v=4.9.151';
import {
    fetchKitchenOverview, batchToRow, exceptionToRow, policyToRow, distributionToRow,
    summarizeKitchen, buildKitchenKpis, topDistributions,
    capNote, KITCHEN_WINDOW,
    KITCHEN_WRITE_ROLES, KITCHEN_APPROVE_ROLES, GOVERNANCE_LIMITS,
    fetchKitchenStock, fetchProductionMaterials, fetchProductionDestinations, fetchProductionProducts,
    fetchKitchenAudits, fetchKitchenDocuments, fetchKitchenCostCards,
    createProduction, receiveKitchenTransfer, createKitchenAudit,
    countKitchenAudit, submitKitchenAudit, approveKitchenAudit,
    legacyQty, productionPayload, validateProductionForm, transferPayload,
    validateAuditPeriod, auditPayload, countPayload, distributionsInRange,
    auditToRow, documentToRow,
} from '../data/kitchen-repo.js?v=4.9.151';
import {
    normalizeSignerName, signaturePadMarkup, initSignaturePad, readSignaturePad,
    disposeSignaturePads,
} from '../signature.js?v=4.9.151';

const SIGN_KINDS = new Set(['audit-approve']);
const SIG_IDS = {
    auditSend: 'v2kit-audit-send-sig',
    auditApprove: 'v2kit-audit-approve-sig',
};
const ALL_SIG_IDS = Object.values(SIG_IDS);

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const TOP_PORTLET = 6;

/** كلمات قائمة الدورية في نموذج الإنشاء — features/kitchen.js:82 حرفيًا
 *  («فترة مخصصة» هنا، و«مخصص» في عنوان بطاقة العدّ :87 — كلتاهما محفوظة). */
const PERIOD_SELECT_LABELS = { daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري', custom: 'فترة مخصصة', annual: 'سنوي' };

/** The three states this door can return (:147 filters draft/open/closed).
 *  «ملغى» is NOT offered: a filter that can never match is a dead control,
 *  and the badge still prints the stored word if the door ever widens.
 *  Words are not written here — they come from the shared status registry,
 *  so a chip and its badge can never disagree. */
const STATES = [
    { key: 'all', label: 'الكل' },
    { key: 'open' },
    { key: 'closed' },
];

const stateWord = (key) => (key === 'all' ? 'الكل' : resolveStatus('production_batch', key).label);

/** Local HH:MM — an operator reading a board needs to know its age. */
function clockNow() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Local YYYY-MM-DD (device calendar — same basis as the legacy today()). */
function isoDay(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function signatureErrorText(err) {
    return ({
        SIGNER_NAME_MISSING: 'اسم الموقّع غير متاح في الجلسة — أعد تسجيل الدخول ثم حاول مجددًا',
        SIGNER_MISMATCH: 'التوقيع باسم حسابك فقط — لا يمكن توقيع اسم آخر',
        NO_INK: 'تعذر رسم التوقيع — راجع خانة التوقيع',
        NO_PAD: 'تعذر تهيئة لوحة التوقيع — أعد فتح اللوحة',
    })[err] || 'تعذر قراءة التوقيع';
}

function qtyCell(v, unit) {
    const n = `<span class="erp-num" dir="ltr">${esc(Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 3 }))}</span>`;
    return unit ? `${n} <span class="erp-text-sm erp-text-muted">${esc(unit)}</span>` : n;
}

/** Registry presentation for the stored state. Unregistered → the stored
 *  word itself, so a new enum value is visible, never re-labelled. */
function stateOf(row) {
    const s = resolveStatus('production_batch', row.stateKey);
    return s.known ? s : { label: row.status || '—', tone: 'neutral', known: false };
}

/** Badge from the shared registry; an unregistered state shows the stored
 *  word alone rather than wearing someone else's label. A draft reads
 *  «مفتوح» because that is the legacy page's own rule (:168) — and the
 *  tooltip says the merge instead of hiding it. */
function batchStateCell(row) {
    if (stateOf(row).known) {
        return statusBadge('production_batch', row.stateKey, {
            title: row.status === 'draft' ? 'مسودة مخزّنة — تُعرض «مفتوح» بقاعدة صفحة المطبخ' : '',
        });
    }
    return `<span class="erp-text-muted" title="حالة مخزنة غير متوقعة — تُعرض خامًا">${esc(row.status || '—')}</span>`;
}

/** حالة جرد من السجل المشترك kitchen_audit (status.js:125-129)؛ المجهولة خامًا. */
function auditStateCell(row) {
    const s = resolveStatus('kitchen_audit', row.status);
    if (s.known) {return statusBadge('kitchen_audit', row.status);}
    return `<span class="erp-text-muted" title="حالة مخزنة غير متوقعة — تُعرض خامًا">${esc(row.status || '—')}</span>`;
}

/** NetSuite's rule: six in the portlet, the rest stay in the register. */
function topPortlet(rows, max) {
    if (!rows.length) {
        return `<div class="erp-state" role="status">
          <span class="erp-state__title">لا توزيعات في النافذة</span>
          <span>باب الخادم لم يُرجع أي توزيع في أحدث ${esc(KITCHEN_WINDOW.distributions)} سجلًا — لا رقم مخترع لصف غائب.</span>
        </div>`;
    }
    const aria = `أكبر الكميات الموزّعة في نافذة الخادم، ترتيبٌ محسوب هنا لا ترتيب زمني`;
    return `<ul class="erp-tops" role="list" aria-label="${esc(aria)}">`
        + rows.map((d) => {
            const title = `${d.dest}: ${d.qty.toLocaleString('en-US', { maximumFractionDigits: 3 })}${d.unit ? ` ${d.unit}` : ''} — ${d.product}`;
            return `
        <li class="erp-top__row">
          <span class="erp-top__name${d.productResolved ? '' : ' erp-text-muted'}" title="${esc(title)}">${esc(d.dest)}</span>
          <span class="erp-top__track"><span class="erp-top__fill" style="inline-size:${max > 0 ? Math.round((d.qty / max) * 100) : 0}%"></span></span>
          <span class="erp-top__val">${qtyCell(d.qty, d.unit)}</span>
        </li>`;
        }).join('')
        + `</ul>`;
}

function stateSeg(active, counts) {
    return `<div class="erp-seg" role="group" aria-label="حالة أمر الإنتاج">`
        + `<span class="erp-seg__label">الحالة</span>`
        + STATES.map((s) => `<button type="button" data-v2-state="${esc(s.key)}"${s.key === active ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(stateWord(s.key))} <span class="erp-num" dir="ltr">${esc(counts[s.key])}</span></button>`).join('')
        + `</div>`;
}

/** زر كتابة في رأس بطاقة — الاسم في aria-label على 640px حيث تُخفى <span>. */
function writeBtn(attr, icon, label) {
    return `<button type="button" class="erp-btn erp-btn--sm erp-btn--primary erp-no-print" ${attr} aria-label="${esc(label)}">
              <i class="ji" data-i="${esc(icon)}" aria-hidden="true"></i><span>${esc(label)}</span>
            </button>`;
}

/** أول الشهر → اليوم (تقويم الجهاز) — نفس أساس صفحة المطبخ القديمة. */
function costDefaultRange() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const ym = `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
    return { from: `${ym}-01`, to: `${ym}-${p(d.getDate())}` };
}

/** عتبات صفحة المطبخ القديمة: >85 أحمر (خسارة)، >75 برتقالي، وإلا أخضر. */
function costTone(pct) {
    if (pct == null) {return 'erp-text-muted';}
    if (pct > 85) {return 'erp-text-danger';}
    if (pct > 75) {return 'erp-text-warning';}
    return 'erp-text-success';
}

function costMoney(v) {
    const m = formatMoney(v);
    return `<span class="erp-num" dir="ltr">${m.amount}</span>`;
}

function template(canWrite, costFrom, costTo) {
    return `
      <div class="erp-v2-kitchen">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">المطبخ
              <span class="erp-eyebrow" dir="ltr" lang="en">Kitchen</span>
            </h2>
            <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <span data-v2-stateseg>${stateSeg('all', { all: '—', open: '—', closed: '—' })}</span>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-print aria-label="طباعة النظرة">
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--primary erp-no-print" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>

        <div data-v2-kpis></div>
        <p class="erp-text-sm erp-text-muted" data-v2-window-note role="status" aria-live="polite"></p>

        <div data-v2-panel hidden></div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">أوامر الإنتاج
              <span class="erp-eyebrow" dir="ltr" lang="en">Production Orders</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
            <span class="erp-grow"></span>
            ${canWrite ? writeBtn('data-v2-new-production', 'cooking-pot', 'أمر إنتاج') : ''}
            <span class="erp-text-sm erp-text-muted" data-v2-orders-note></span>
          </div>
          <div class="erp-card__body">
            <div data-v2-batches></div>
          </div>
        </section>

        <section class="erp-card erp-v2-cost" data-v2-costcards>
          <div class="erp-card__head">
            <div class="erp-v2-cost__heading">
              <h3 class="erp-card__title">بطاقات التكلفة
                <span class="erp-eyebrow" dir="ltr" lang="en">Cost Cards</span>
              </h3>
              <p>الصرف الفعلي (أذون الصرف − المرتجعات + مكوّنات أوامر الإنتاج) مقابل الإيراد الفعلي من الكاشير.</p>
            </div>
            <div class="erp-v2-cost__filters" role="group" aria-label="فترة بطاقات التكلفة">
              <label class="erp-v2-cost__date" for="v2kit-cost-from">
                <span>من تاريخ</span>
                <input class="erp-input erp-input--ltr" id="v2kit-cost-from" type="date" value="${esc(costFrom)}" data-v2-cost-from>
              </label>
              <label class="erp-v2-cost__date" for="v2kit-cost-to">
                <span>إلى تاريخ</span>
                <input class="erp-input erp-input--ltr" id="v2kit-cost-to" type="date" value="${esc(costTo)}" data-v2-cost-to>
              </label>
              <div class="erp-v2-cost__actions">
                <button type="button" class="erp-btn erp-btn--sm erp-btn--primary erp-no-print" data-v2-cost-reload>
                  <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
                </button>
              </div>
            </div>
          </div>
          <div class="erp-card__body erp-stack">
            <div data-v2-costcards-board aria-live="polite"></div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">أكبر الكميات الموزّعة
              <span class="erp-eyebrow" dir="ltr" lang="en">Top Distributions</span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted" data-v2-dist-note></span>
          </div>
          <div class="erp-card__body">
            <div data-v2-dist></div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">استثناءات تحتاج مراجعة
              <span class="erp-eyebrow" dir="ltr" lang="en">Open Exceptions</span>
              <span class="erp-text-muted erp-text-sm" data-v2-exccount></span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted">الاستثناءات المفتوحة فقط</span>
          </div>
          <div class="erp-card__body">
            <div data-v2-exceptions></div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">سياسات أقسام المطبخ
              <span class="erp-eyebrow" dir="ltr" lang="en">Department Policies</span>
              <span class="erp-text-muted erp-text-sm" data-v2-polcount></span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted">كلمات الوضع معتمدة من إعداد المطبخ</span>
          </div>
          <div class="erp-card__body">
            <div data-v2-policies></div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">الجرد الذكي
              <span class="erp-eyebrow" dir="ltr" lang="en">Stock Audits</span>
              <span class="erp-text-muted erp-text-sm" data-v2-auditcount></span>
            </h3>
            <span class="erp-grow"></span>
            ${canWrite ? writeBtn('data-v2-new-audit', 'plus', 'جرد جديد') : ''}
          </div>
          <div class="erp-card__body">
            <div data-v2-audits></div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">مستندات حركة المطبخ
              <span class="erp-eyebrow" dir="ltr" lang="en">Kitchen Documents</span>
              <span class="erp-text-muted erp-text-sm" data-v2-doccount></span>
            </h3>
            <span class="erp-grow"></span>
            ${canWrite ? writeBtn('data-v2-new-transfer', 'inbox', 'استلام مواد') : ''}
          </div>
          <div class="erp-card__body">
            <div data-v2-docs></div>
          </div>
        </section>

        <p class="erp-text-sm erp-text-muted" data-v2-gov-note role="status" aria-live="polite"></p>
        <p class="erp-print-note" data-v2-print-note></p>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, userName?: string|null,
 *          notify?: (message:string, kind?:string)=>void,
 *          confirmFn?: (message:string)=>boolean|Promise<boolean>}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountKitchenScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 kitchen]', m);
    const confirmFn = typeof ctx.confirmFn === 'function'
        ? ctx.confirmFn
        : (message) => Promise.resolve(window.confirm(message));
    const role = ctx.role ? String(ctx.role) : '';
    const signerName = normalizeSignerName(ctx.userName || '');
    const canWrite = KITCHEN_WRITE_ROLES.includes(role);
    const canApprove = KITCHEN_APPROVE_ROLES.includes(role);

    let batches = [];
    let exceptions = [];
    let distributions = [];
    let policies = [];
    let locations = [];
    let audits = [];
    let documents = [];
    let readAt = '';
    let stateFilter = 'all';
    let loading = false;
    let queued = false;          // a refresh asked for while one was running
    let govLoading = false;
    let govQueued = false;       // same guard, separate read
    let panelSeq = 0;            // one bump cancels every async panel job
    let panelKind = null;
    let panelRaw = null;
    let retryState = null;       // { kind, raw } for إعادة المحاولة
    let busy = false;            // one decision at a time
    let prodState = null;        // نموذج أمر الإنتاج: قوائم الخادم + صفوف الحالة
    let transferState = null;    // نموذج الاستلام: الرصيد + الصفوف
    const costInit = costDefaultRange();
    let costFrom = costInit.from;
    let costTo = costInit.to;
    let costCards = [];
    let costLoading = false;
    let costError = '';

    host.insertAdjacentHTML('beforeend', template(canWrite, costFrom, costTo));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const kpisEl = q('[data-v2-kpis]');
    const scopeEl = q('[data-v2-scope-line]');
    const windowNoteEl = q('[data-v2-window-note]');
    const countEl = q('[data-v2-count]');
    const ordersNoteEl = q('[data-v2-orders-note]');
    const excCountEl = q('[data-v2-exccount]');
    const polCountEl = q('[data-v2-polcount]');
    const distNoteEl = q('[data-v2-dist-note]');
    const segHolder = q('[data-v2-stateseg]');
    const printNote = q('[data-v2-print-note]');
    const panelEl = q('[data-v2-panel]');
    const auditCountEl = q('[data-v2-auditcount]');
    const docCountEl = q('[data-v2-doccount]');
    const govNoteEl = q('[data-v2-gov-note]');
    const costBoardEl = q('[data-v2-costcards-board]');

    const table = createDataTable({
        caption: 'أوامر الإنتاج — أحدث ما أرسله الخادم',
        mode: 'client',
        pageSize: 15,
        stickyHeader: true,
        emptyMessage: 'لا أوامر إنتاج في هذه الحالة',
        emptyHint: 'المسودة والمفتوحة والمغلقة تصل من الباب؛ غيّر شريط الحالة أو حدّث.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'product', header: 'المنتج', sortable: true, filterable: true,
                render: (row) => (row.productResolved ? esc(row.product)
                    : `<span class="erp-text-muted" title="لا اسم مخزّن — يُعرض رقم السجل">${esc(row.product)}</span>`),
            },
            {
                key: 'location', header: 'الموقع', sortable: true, filterable: true, width: '140px',
                render: (row) => (row.locationResolved ? esc(row.location)
                    : `<span class="erp-text-muted">${esc(row.location)}</span>`),
            },
            {
                key: 'planned', header: 'المخطط', sortable: true, type: 'number',
                width: '110px', align: 'end', value: (row) => row.planned,
                render: (row) => qtyCell(row.planned, row.unit),
            },
            {
                key: 'produced', header: 'المنتَج', sortable: true, type: 'number',
                width: '110px', align: 'end', value: (row) => row.produced,
                render: (row) => qtyCell(row.produced, row.unit),
            },
            {
                key: 'remaining', header: 'المتبقي', sortable: true, type: 'number',
                width: '110px', align: 'end', value: (row) => row.remaining,
                render: (row) => (row.remaining > 0
                    ? qtyCell(row.remaining, row.unit)
                    : `<span class="erp-text-muted" title="متبقٍ صفر">${qtyCell(0, row.unit)}</span>`),
            },
            {
                key: 'stateKey', header: 'الحالة', sortable: true, filterable: true, width: '150px',
                value: (row) => stateOf(row).label,
                render: (row) => batchStateCell(row),
            },
            {
                key: 'created', header: 'تاريخ الأمر', sortable: true, filterable: true,
                width: '120px', align: 'center', className: 'erp-tnum',
            },
        ],
    });

    const excTable = createDataTable({
        caption: 'الاستثناءات المفتوحة — بيانات حية',
        mode: 'client',
        pageSize: 10,
        stickyHeader: true,
        emptyMessage: 'لا استثناءات مفتوحة',
        emptyHint: 'الباب يرسل status=open فقط — لا استثناء مغلق يظهر هنا.',
        rowKey: (row) => row.id,
        columns: [
            { key: 'product', header: 'الصنف', sortable: true, filterable: true },
            {
                key: 'qty', header: 'الكمية', sortable: true, type: 'number',
                width: '110px', align: 'end', value: (row) => row.qty,
                render: (row) => qtyCell(row.qty, ''),
            },
            { key: 'order', header: 'الأمر', width: '150px', className: 'erp-mono' },
            {
                key: 'policy', header: 'السياسة', sortable: true, filterable: true, width: '120px',
                value: (row) => row.policyAr,
                render: (row) => (row.policy === row.policyAr
                    ? `<span class="erp-text-muted" title="وضع مخزن غير معروف — يُعرض خامًا">${esc(row.policyAr)}</span>`
                    : esc(row.policyAr)),
            },
            { key: 'reason', header: 'السبب', filterable: true },
            { key: 'dept', header: 'القسم', sortable: true, filterable: true, width: '130px' },
            {
                key: 'created', header: 'التاريخ', sortable: true,
                width: '110px', align: 'center', className: 'erp-tnum',
            },
        ],
    });

    const polTable = createDataTable({
        caption: 'سياسات التشغيل لكل قسم — بيانات حية',
        mode: 'client',
        pageSize: 10,
        stickyHeader: true,
        emptyMessage: 'لا سياسات مخزنة',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'dept', header: 'القسم', sortable: true, filterable: true,
                render: (row) => (row.deptResolved ? esc(row.dept)
                    : `<span class="erp-text-muted" title="لا اسم قسم مخزن — يُعرض رقم السجل">${esc(row.dept)}</span>`),
            },
            {
                key: 'mode', header: 'الوضع', sortable: true, filterable: true, width: '120px',
                value: (row) => row.modeAr,
                render: (row) => (row.modeKnown ? esc(row.modeAr)
                    : `<span class="erp-text-muted" title="وضع مخزن غير معروف — يُعرض خامًا">${esc(row.modeAr || '—')}</span>`),
            },
            {
                key: 'fallback', header: 'السماح بالتجاوز', sortable: true, type: 'number',
                width: '140px', align: 'center', value: (row) => (row.fallback ? 1 : 0),
                render: (row) => (row.fallback
                    ? `<span class="erp-row-wrap"><span class="erp-dot erp-dot--success" aria-hidden="true"></span><span>مسموح</span></span>`
                    : `<span class="erp-row-wrap"><span class="erp-dot erp-dot--danger" aria-hidden="true"></span><span>ممنوع</span></span>`),
            },
            {
                key: 'requireReason', header: 'السبب إلزامي', sortable: true, type: 'number',
                width: '130px', align: 'center', value: (row) => (row.requireReason ? 1 : 0),
                render: (row) => `<span>${row.requireReason ? 'نعم' : 'لا'}</span>`,
            },
            { key: 'location', header: 'موقع المطبخ', sortable: true, filterable: true, width: '150px' },
        ],
    });

    function auditActionsHtml(row) {
        const view = `<button type="button" class="erp-btn erp-btn--sm" data-v2-act="audit-count" data-id="${esc(String(row.id))}">عرض/عد</button>`;
        const approve = canApprove && row.status === 'submitted'
            ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-act="audit-approve" data-id="${esc(String(row.id))}">اعتماد</button>`
            : '';
        return `<span class="erp-row-wrap">${view}${approve}</span>`;
    }

    const auditTable = createDataTable({
        caption: 'جلسات جرد المطبخ — أحدث ما أرسله الخادم',
        mode: 'client',
        pageSize: 10,
        stickyHeader: true,
        emptyMessage: 'لا توجد جلسات جرد بعد',
        emptyHint: 'زر «جرد جديد» يلتقط رصيد مخزن المطبخ كرصيد نظامي ثم تُدخل الكميات الفعلية.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'number', header: 'الرقم', sortable: true, filterable: true, width: '160px', className: 'erp-mono',
                render: (row) => `<span class="fw-bold">${esc(row.number)}</span>`,
            },
            {
                key: 'period', header: 'الدورية والفترة', sortable: true, filterable: true,
                value: (row) => row.periodAr,
                render: (row) => (row.periodKnown ? esc(row.periodAr)
                    : `<span class="erp-text-muted" title="دورية مخزنة غير متوقعة — تُعرض خامًا">${esc(row.periodAr)}</span>`)
                    + (row.range ? ` <small class="erp-text-muted">${esc(row.range)}</small>` : ''),
            },
            {
                key: 'totalItems', header: 'الأصناف', sortable: true, type: 'number',
                width: '110px', align: 'end', value: (row) => row.totalItems,
                render: (row) => `<span class="erp-num" dir="ltr">${esc(formatInt(row.totalItems))}</span>`,
            },
            {
                key: 'status', header: 'الحالة', sortable: true, filterable: true, width: '160px',
                value: (row) => resolveStatus('kitchen_audit', row.status).label,
                render: (row) => auditStateCell(row),
            },
            {
                key: 'actions', header: 'الإجراء', width: '200px', className: 'erp-v2-kitchen-actions',
                render: (row) => auditActionsHtml(row),
            },
        ],
    });

    const docTable = createDataTable({
        caption: 'مستندات حركة المطبخ (أذون صرف وصلت المطبخ أو تحويلات) — أحدث ما أرسله الخادم',
        mode: 'client',
        pageSize: 10,
        stickyHeader: true,
        emptyMessage: 'لا توجد تحويلات مسجلة للمطبخ',
        emptyHint: 'الباب يقرأ حركات موقع المطبخ من جدول التحويلات — سقفه 100 مستند.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'id', header: 'المستند', width: '110px', className: 'erp-mono',
                render: (row) => `<span class="fw-bold">#${esc(String(row.id))}</span>`,
            },
            { key: 'from', header: 'من', sortable: true, filterable: true },
            { key: 'to', header: 'إلى', sortable: true, filterable: true },
            {
                key: 'date', header: 'التاريخ', sortable: true,
                width: '120px', align: 'center', className: 'erp-tnum',
            },
            {
                key: 'itemsText', header: 'الأصناف', filterable: true,
                render: (row) => `<span class="erp-row-wrap">${esc(row.itemsText)}</span>`,
            },
        ],
    });

    q('[data-v2-batches]').appendChild(table.el);
    q('[data-v2-exceptions]').appendChild(excTable.el);
    q('[data-v2-policies]').appendChild(polTable.el);
    q('[data-v2-audits]').appendChild(auditTable.el);
    q('[data-v2-docs]').appendChild(docTable.el);

    const counts = () => ({
        all: batches.length,
        open: batches.filter((b) => b.stateKey === 'open').length,
        closed: batches.filter((b) => b.stateKey === 'closed').length,
    });

    /** One read paints everything; the state filter is a client slice of the
     *  loaded window, so changing it never costs a request. */
    function paint() {
        const c = counts();
        segHolder.innerHTML = stateSeg(stateFilter, c);
        const shown = stateFilter === 'all' ? batches
            : batches.filter((b) => b.stateKey === stateFilter);
        table.setRows(shown);
        excTable.setRows(exceptions);
        polTable.setRows(policies);
        const s = summarizeKitchen(batches, exceptions, locations, policies, distributions);
        kpisEl.innerHTML = `<ul class="erp-kpis" aria-label="مؤشرات المطبخ — كل رقم معدود على نافذة الخادم لا على السجل كلّه">`
            + buildKitchenKpis(s).map((k) => `
          <li class="erp-kpi">
            <div class="erp-kpi__top">
              <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon)}"></i></span>
              <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
            </div>
            <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value)}</span>${k.unit ? ` <span class="erp-kpi__unit">${esc(k.unit)}</span>` : ''}</div>
            <div class="erp-kpi__foot"><span class="erp-kpi__hint">${esc(k.hint)}</span></div>
          </li>`).join('')
            + `</ul>`;
        countEl.textContent = shown.length ? `(${shown.length})` : '';
        ordersNoteEl.textContent = stateFilter === 'all'
            ? `من أحدث ${KITCHEN_WINDOW.batches} أمرًا`
            : `${shown.length} من ${c.all} في هذه الحالة`;
        excCountEl.textContent = exceptions.length ? `(${exceptions.length})` : '';
        polCountEl.textContent = policies.length ? `(${policies.length})` : '';

        const top = topDistributions(distributions, TOP_PORTLET);
        const max = top.length ? top[0].qty : 0;
        q('[data-v2-dist]').innerHTML = topPortlet(top, max);
        distNoteEl.textContent = distributions.length > TOP_PORTLET
            ? `أكبر ${TOP_PORTLET} من ${distributions.length} — ترتيبٌ هنا على أحدث ${KITCHEN_WINDOW.distributions} توزيعًا`
            : `كل النافذة (${distributions.length})`;

        const caps = [
            capNote(batches.length, KITCHEN_WINDOW.batches, 'الأوامر'),
            capNote(exceptions.length, KITCHEN_WINDOW.exceptions, 'الاستثناءات'),
            capNote(distributions.length, KITCHEN_WINDOW.distributions, 'التوزيعات'),
        ].filter(Boolean);
        windowNoteEl.textContent = caps.join(' · ');

        scopeEl.textContent = batches.length || exceptions.length
            ? `نافذة الخادم: أحدث ${KITCHEN_WINDOW.batches} أمرًا و${KITCHEN_WINDOW.exceptions} استثناءً و${KITCHEN_WINDOW.distributions} توزيعًا · ${c.all} أمرًا محمّل (${c.open} مفتوح، ${c.closed} مغلق) · ${locations.length} موقعًا نشطًا · آخر قراءة ${readAt}`
            : `لا شيء في نافذة الخادم عند آخر قراءة (${readAt})`;
        printNote.textContent = `المطبخ — ${c.all} أمرًا (${c.open} مفتوح، ${c.closed} مغلق) · ${exceptions.length} استثناءً مفتوحًا · ${policies.length} سياسة · ${locations.length} موقعًا نشطًا · جرد: ${audits.length} جلسة · مستندات: ${documents.length} · نافذة الخادم أحدث ${KITCHEN_WINDOW.batches}/${KITCHEN_WINDOW.exceptions}/${KITCHEN_WINDOW.distributions} · آخر قراءة ${readAt}. المطبوعة تعرض الصفحة الحالية من كل جدول، لا السجل كاملًا.`;
    }

    function paintError(message) {
        batches = [];
        exceptions = [];
        distributions = [];
        policies = [];
        locations = [];
        kpisEl.innerHTML = '';
        segHolder.innerHTML = stateSeg(stateFilter, { all: '—', open: '—', closed: '—' });
        windowNoteEl.textContent = '';
        scopeEl.textContent = '';
        countEl.textContent = '';
        ordersNoteEl.textContent = '';
        excCountEl.textContent = '';
        polCountEl.textContent = '';
        distNoteEl.textContent = '';
        q('[data-v2-dist]').innerHTML = '';
        printNote.textContent = `المطبخ — ${message}`;
        table.setError(message);
        excTable.setError(message);
        polTable.setError(message);
    }

    /** نفس سلّم الأخطاء المسمّاة في كل شاشات V2 — رسالة الخادم لا تُخفى. */
    function readErrorMessage(e, what) {
        if (e && e.message === 'UNAUTHORIZED') {return 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.';}
        if (e && e.code === 'FORBIDDEN') {return 'لا صلاحية لعرض المطبخ بهذا الحساب — القرار للخادم وحده.';}
        return `تعذّر تحميل ${what}: ${(e && e.message) || 'خطأ'}`;
    }

    async function reload() {
        if (loading) {queued = true; return;}
        loading = true;
        table.setLoading(true);
        excTable.setLoading(true);
        polTable.setLoading(true);
        try {
            const ov = await fetchKitchenOverview();
            if (!el.isConnected) {return;}          // destroyed while in flight
            batches = ov.batches.map(batchToRow);
            exceptions = ov.exceptions.map(exceptionToRow);
            distributions = ov.distributions.map(distributionToRow);
            policies = ov.policies.map(policyToRow);
            locations = ov.locations;
            readAt = clockNow();
            paint();
            if (!batches.length && !exceptions.length && !policies.length) {
                notify('لا أوامر ولا استثناءات ولا سياسات في نافذة الخادم — لا رقم يُختلق لصف غائب.');
            }
        } catch (e) {
            if (!el.isConnected) {return;}
            paintError(readErrorMessage(e, 'نظرة المطبخ'));
        } finally {
            loading = false;
            if (queued && el.isConnected) {
                queued = false;
                reload();                            // the newest read wins
            }
        }
    }

    /** قراءة الحوكمة (الجرد + المستندات) منفصلة عن النظرة: فشلُ إحداهما
     *  لا يمحو الأخرى — لكل قراءة جدولاها ورسالتها. */
    function paintGovernance() {
        auditTable.setRows(audits);
        docTable.setRows(documents);
        auditCountEl.textContent = audits.length ? `(${audits.length})` : '';
        docCountEl.textContent = documents.length ? `(${documents.length})` : '';
        const caps = [
            capNote(audits.length, GOVERNANCE_LIMITS.audits, 'جلسات الجرد'),
            capNote(documents.length, GOVERNANCE_LIMITS.documents, 'مستندات الحركة'),
        ].filter(Boolean);
        govNoteEl.textContent = caps.join(' · ');
    }

    function paintGovernanceError(message) {
        audits = [];
        documents = [];
        auditCountEl.textContent = '';
        docCountEl.textContent = '';
        govNoteEl.textContent = '';
        auditTable.setError(message);
        docTable.setError(message);
    }

    async function readGovernance() {
        if (govLoading) {govQueued = true; return;}
        govLoading = true;
        auditTable.setLoading(true);
        docTable.setLoading(true);
        try {
            const [auditRows, docRows] = await Promise.all([fetchKitchenAudits(), fetchKitchenDocuments()]);
            if (!el.isConnected) {return;}
            audits = auditRows.map(auditToRow);
            documents = docRows.map(documentToRow);
            paintGovernance();
        } catch (e) {
            if (!el.isConnected) {return;}
            paintGovernanceError(readErrorMessage(e, 'سجل الجرد والمستندات'));
        } finally {
            govLoading = false;
            if (govQueued && el.isConnected) {
                govQueued = false;
                readGovernance();
            }
        }
    }

    /* ── بطاقات التكلفة (قراءة فقط): الصرف الفعلي مقابل الإيراد ─────────── */

    function costQty(v) {
        const n = Number(v);
        return Number.isFinite(n) ? formatQty(n) : '—';
    }

    function costMoneyText(v) {
        return formatMoney(v).amount;
    }

    function costKpi(label, body, icon, hint) {
        return `<li class="erp-kpi">
          <div class="erp-kpi__top">
            <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(icon)}"></i></span>
            <span class="erp-kpi__label">${esc(label)}</span>
          </div>
          <div class="erp-kpi__value">${body}</div>
          <div class="erp-kpi__foot"><span class="erp-kpi__hint">${esc(hint)}</span></div>
        </li>`;
    }

    function costCardHtml(c) {
        const cons = c.consumption || {};
        const prod = c.production || {};
        const items = Array.isArray(cons.items) ? cons.items : [];
        const lines = Array.isArray(prod.lines) ? prod.lines : [];
        const ratio = c.costRatio == null ? null : Number(c.costRatio);
        const ratioText = ratio == null ? '<span class="erp-text-muted">—</span>'
            : `<span class="erp-num ${costTone(ratio)}" dir="ltr">${Math.round(ratio * 10) / 10}%</span>`;

        const linesHtml = lines.length ? `
            <div class="erp-table__scroll" tabindex="0" style="max-height:320px;overflow:auto">
              <table class="erp-table__grid">
                <thead><tr><th>أمر إنتاج</th><th>التوزيع (موزّع / مخطط)</th><th>تكلفة الدفعة</th><th>نصيب الجهة</th><th>التاريخ</th></tr></thead>
                <tbody>${lines.map((p) => `<tr>
                  <td>${esc(p.product_name || `دفعة #${p.batch_id}`)}</td>
                  <td class="erp-tnum" dir="ltr">${costQty(p.allocated_qty)} / ${costQty(p.planned_qty)}</td>
                  <td class="erp-tnum" dir="ltr">${costMoney(p.batch_cost)}</td>
                  <td class="erp-tnum" dir="ltr">${costMoney(p.cost)}</td>
                  <td class="erp-tnum" dir="ltr">${esc(String(p.prod_date || '').slice(0, 10))}</td>
                </tr>`).join('')}</tbody>
              </table>
            </div>` : '';

        const itemsHtml = items.length ? `
            <div class="erp-table__scroll" tabindex="0" style="max-height:360px;overflow:auto">
              <table class="erp-table__grid">
                <thead><tr><th>الصنف المصروف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>التاريخ</th><th>الإذن</th></tr></thead>
                <tbody>${items.slice(0, 25).map((x) => `<tr>
                  <td>${esc(x.name)}</td>
                  <td class="erp-tnum" dir="ltr">${costQty(x.qty)} ${esc(x.unit || '')}</td>
                  <td class="erp-tnum" dir="ltr">${costMoney(x.cost)}</td>
                  <td class="erp-tnum" dir="ltr">${costMoney(x.value)}</td>
                  <td class="erp-tnum" dir="ltr">${esc(String(x.date || '').slice(0, 10))}</td>
                  <td class="erp-tnum" dir="ltr">#${esc(String(x.dispatch_no || ''))}</td>
                </tr>`).join('')}</tbody>
              </table>
            </div>` : '<p class="erp-text-sm erp-text-muted">لا صرف مسجل في هذه الفترة.</p>';

        const meta = `أصناف الصرف: ${formatInt(items.length)} · أوامر الإنتاج الموزعة: ${formatInt(lines.length)}`
            + (Number(cons.returned) ? ` · مرتجعات مخصومة: ${costMoney(cons.returned)}` : '');

        return `<article class="erp-card erp-card--subtle" style="border-block-start:4px solid ${esc(c.color || '#c9a227')}">
          <div class="erp-card__head">
            <div class="erp-v2-cost__heading">
              <h4 class="erp-card__title">${esc(c.icon || '')} ${esc(c.name || c.code)}
                <span class="erp-text-sm erp-text-muted">(${esc(c.from || costFrom)} — ${esc(c.to || costTo)})</span>
              </h4>
              <p>${esc(meta)}</p>
            </div>
            <span class="erp-grow"></span>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-cost-print="${esc(c.code)}">
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة البطاقة</span>
            </button>
          </div>
          <div class="erp-card__body erp-stack">
            <ul class="erp-kpis">
              ${costKpi('الصرف الفعلي (بعد المرتجعات)', costMoney(cons.gross), 'package', 'أذون الصرف − مرتجعات المطبخ')}
              ${costKpi('تكلفة أوامر الإنتاج', costMoney(prod.cost), 'cooking-pot', 'تكلفة الدفتر × نسبة التوزيع')}
              ${costKpi('الإيراد الفعلي', costMoney(c.revenue), 'banknote', 'إيرادات الكاشير المرتبطة بالقسم')}
              ${costKpi('نسبة التكلفة / الصافي', ratioText, 'chart', `صافي ${costMoneyText(c.net)}`)}
            </ul>
            ${linesHtml}
            ${itemsHtml}
          </div>
        </article>`;
    }

    function paintCostCards() {
        if (!costBoardEl) {return;}
        if (costError) {
            costBoardEl.innerHTML = `<div class="erp-state" role="alert">
              <span class="erp-state__title">تعذّر تحميل بطاقات التكلفة</span>
              <span>${esc(costError)}</span>
              <button type="button" class="erp-btn erp-btn--sm" data-v2-cost-reload>إعادة المحاولة</button>
            </div>`;
            return;
        }
        if (costLoading && !costCards.length) {
            costBoardEl.innerHTML = '<p class="erp-text-sm erp-text-muted" role="status">جارٍ تحميل بطاقات التكلفة…</p>';
            return;
        }
        if (!costCards.length) {
            costBoardEl.innerHTML = `<div class="erp-state" role="status">
              <span class="erp-state__title">لا بطاقات في هذه الفترة</span>
              <span>الخادم لم يُرجع بطاقة — لا رقم مخترع لصف غائب.</span>
            </div>`;
            return;
        }
        costBoardEl.innerHTML = costCards.map(costCardHtml).join('');
    }

    async function readCostCards() {
        if (costLoading) {return;}
        const fromEl = q('[data-v2-cost-from]');
        const toEl = q('[data-v2-cost-to]');
        if (fromEl && fromEl.value) {costFrom = fromEl.value;}
        if (toEl && toEl.value) {costTo = toEl.value;}
        if (costFrom && costTo && costFrom > costTo) {
            costError = 'تاريخ البداية بعد النهاية — صحّح الفترة.';
            paintCostCards();
            return;
        }
        costLoading = true;
        costError = '';
        paintCostCards();
        try {
            const res = await fetchKitchenCostCards({ from: costFrom, to: costTo });
            if (!el.isConnected) {return;}
            costCards = res.cards;
            if (res.from) {costFrom = res.from;}
            if (res.to) {costTo = res.to;}
            paintCostCards();
        } catch (e) {
            if (!el.isConnected) {return;}
            costCards = [];
            costError = readErrorMessage(e, 'بطاقات التكلفة');
            paintCostCards();
        } finally {
            costLoading = false;
        }
    }

    function printCostCard(code) {
        const c = costCards.find((x) => String(x.code) === String(code));
        if (!c) {notify('حمّل البطاقات أولًا ثم أعد الطباعة'); return;}
        const cons = c.consumption || {};
        const prod = c.production || {};
        const items = Array.isArray(cons.items) ? cons.items : [];
        const lines = Array.isArray(prod.lines) ? prod.lines : [];
        const ratio = c.costRatio == null ? '—' : `${Math.round(Number(c.costRatio) * 10) / 10}%`;
        const prodRows = lines.map((p) => `<tr>
            <td>${esc(p.product_name || `دفعة #${p.batch_id}`)}</td>
            <td>${costQty(p.allocated_qty)} / ${costQty(p.planned_qty)}</td>
            <td>${costMoneyText(p.batch_cost)}</td>
            <td>${costMoneyText(p.cost)}</td>
            <td>${esc(String(p.prod_date || '').slice(0, 10))}</td>
          </tr>`).join('');
        const itemRows = items.map((x) => `<tr>
            <td>${esc(x.name)}</td>
            <td>${costQty(x.qty)} ${esc(x.unit || '')}</td>
            <td>${costMoneyText(x.cost)}</td>
            <td>${costMoneyText(x.value)}</td>
            <td>${esc(String(x.date || '').slice(0, 10))}</td>
            <td>#${esc(String(x.dispatch_no || ''))}</td>
          </tr>`).join('') || '<tr><td colspan="6">لا صرف</td></tr>';

        const w = openInAppReport(`بطاقة تكلفة — ${c.name || c.code}`);
        if (!w) {notify('اسمح بالنوافذ المنبثقة لطباعة البطاقة'); return;}
        w.document.open();
        w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>بطاقة تكلفة — ${esc(c.name || c.code)}</title><style>
body{font-family:'Cairo','Segoe UI',Tahoma,sans-serif;margin:0;color:#1a1a2e}
.header{background:#0f172a;color:#fff;padding:18px 26px}
.header h1{margin:0;font-size:19px;color:#f5d76e}
.header p{margin:4px 0 0;color:#cbd5e1;font-size:12px}
.container{padding:18px 26px}
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}
.summary .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px;text-align:center}
.summary small{display:block;color:#64748b;font-size:11px}
.summary b{display:block;font-size:16px;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:10px}
th{background:#0f172a;color:#f5d76e;padding:7px;font-size:11px}
td{padding:6px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:12px}
h3{margin:14px 0 0;font-size:13px}
p.foot{margin-top:14px;text-align:center;color:#94a3b8;font-size:11px}
@media print{.header{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body>
<div class="header"><h1>بطاقة تكلفة — ${esc(c.name || c.code)}</h1>
<p>الفترة ${esc(c.from || costFrom)} — ${esc(c.to || costTo)}</p></div>
<div class="container">
<div class="summary">
  <div class="card"><small>الصرف الفعلي (بعد المرتجعات)</small><b style="color:#c0392b">${costMoneyText(cons.gross)}</b></div>
  <div class="card"><small>تكلفة أوامر الإنتاج</small><b style="color:#8B5CF6">${costMoneyText(prod.cost)}</b></div>
  <div class="card"><small>الإيراد الفعلي</small><b style="color:#9a7417">${costMoneyText(c.revenue)}</b></div>
  <div class="card"><small>نسبة التكلفة</small><b>${esc(ratio)}</b><small>الصافي ${costMoneyText(c.net)}</small></div>
</div>
${prodRows ? `<h3>أوامر الإنتاج الموزعة على الجهة</h3><table><thead><tr><th>أمر إنتاج</th><th>التوزيع</th><th>تكلفة الدفعة</th><th>نصيب الجهة</th><th>التاريخ</th></tr></thead><tbody>${prodRows}</tbody></table>` : ''}
<h3>الصرف المفصل من أذون الصرف</h3>
<table><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>التاريخ</th><th>الإذن</th></tr></thead><tbody>${itemRows}</tbody></table>
<p class="foot">المرتجعات المسجلة: ${costMoneyText(cons.returned)} (مخصومة) · تم التوليد: ${esc(new Date().toLocaleString('ar-EG'))}</p>
</div></body></html>`);
        w.document.close();
        w.print();
    }

    /* ── اللوحة: غلاف ومكوّنات مشتركة (نفس نمط شاشة 13) ────────────────── */

    function panelShell(title, icon, bodyHtml) {
        return `<div class="erp-kitchen-panel">
          <div class="erp-kitchen-panel__head">
            <h3><i class="ji" data-i="${esc(icon)}" aria-hidden="true"></i> ${title}</h3>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close>
              <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
            </button>
          </div>
          <div class="erp-kitchen-panel__body erp-stack">${bodyHtml}</div>
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

    function panelActions(submitLabel, submitIcon, extra = '', submitDisabled = false, submitKind = '') {
        return `
          <div data-v2-panel-msg role="alert" class="erp-text-sm"></div>
          <div class="erp-kitchen-panel__actions">
            ${extra}
            <span class="erp-grow"></span>
            <button type="button" class="erp-btn" data-v2-panel-close>إلغاء</button>
            <button type="button" class="erp-btn erp-btn--primary" data-v2-submit${submitKind ? ` data-v2-submit-kind="${esc(submitKind)}"` : ''}${submitDisabled ? ' disabled' : ''}>
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
        prodState = null;
        transferState = null;
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

    /** تنبيه سياقي داخل اللوحة — نفس أصوات شاشة 13 الخمسة (CSS). */
    function flowNote(tone, icon, html) {
        return `<div class="erp-flow-note" data-tone="${esc(tone)}" role="status">
          <i class="ji" data-i="${esc(icon)}" aria-hidden="true"></i> ${html}
        </div>`;
    }

    const fieldVal = (name) => {
        const n = panelEl.querySelector(`[data-f="${name}"]`);
        return n ? n.value : '';
    };

    /* ── أمر الإنتاج: ثلاث خطوات بنصوص features/kitchen.js:34 ─────────── */

    function materialRowHtml(row, i) {
        const opts = (prodState.materials || []).map((m) => {
            const sel = String(m.inventory_id) === String(row.inventory_id) ? ' selected' : '';
            return `<option value="${esc(String(m.inventory_id))}"${sel}>${esc(m.name)} — متاح ${esc(legacyQty(m.available))} ${esc(m.unit || 'وحدة')}</option>`;
        }).join('');
        return `<div class="erp-prod-line" data-m-row="${i}">
          <div class="erp-prod-grid">
            <label class="erp-field"><span class="erp-label">المكون ${i + 1}</span>
              <select class="erp-select" data-f="m-inv" data-i="${i}">
                <option value="">اختر مكونًا من المخزن</option>${opts}
              </select></label>
            <label class="erp-field"><span class="erp-label">الكمية</span>
              <input class="erp-input erp-input--ltr" type="number" min="0.001" step="0.001" data-f="m-qty" data-i="${i}" value="${esc(row.quantity || '')}" placeholder="الكمية"></label>
            <label class="erp-field"><span class="erp-label">الهالك %</span>
              <input class="erp-input erp-input--ltr" type="number" min="0" max="100" step="0.01" data-f="m-waste" data-i="${i}" value="${esc(row.waste_percent || '0')}"></label>
          </div>
          <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-remove-material data-index="${i}"
                  aria-label="إزالة المكون ${i + 1}"><i class="ji" data-i="trash" aria-hidden="true"></i></button>
        </div>`;
    }

    function distRowHtml(row, i) {
        const opts = (prodState.destinations || []).map((d) => {
            const value = `department|${d.id}|${d.name}`;
            const sel = value === row.destination ? ' selected' : '';
            return `<option value="${esc(value)}"${sel}>${esc(`قسم: ${d.name}`)}</option>`;
        }).join('')
            + `<option value="custom|custom|"${row.destination === 'custom|custom|' ? ' selected' : ''}>جهة مخصصة اختيارية</option>`;
        const custom = row.destination === 'custom|custom|'
            ? `<label class="erp-field"><span class="erp-label">اسم الجهة</span>
                 <input class="erp-input" type="text" data-f="d-custom" data-i="${i}" value="${esc(row.customName || '')}" placeholder="اكتب اسم الجهة"></label>`
            : '';
        return `<div class="erp-prod-line" data-d-row="${i}">
          <div class="erp-prod-grid">
            <label class="erp-field"><span class="erp-label">الجهة ${i + 1}</span>
              <select class="erp-select" data-f="d-dest" data-i="${i}">${opts}</select></label>
            ${custom}
            <label class="erp-field"><span class="erp-label">الكمية</span>
              <input class="erp-input erp-input--ltr" type="number" min="0.01" step="0.01" data-f="d-qty" data-i="${i}" value="${esc(row.quantity || '')}"></label>
          </div>
          <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-remove-dist data-index="${i}"
                  aria-label="إزالة الجهة ${i + 1}"><i class="ji" data-i="trash" aria-hidden="true"></i></button>
        </div>`;
    }

    function renderProdMaterials() {
        const box = panelEl.querySelector('[data-v2-prod-materials]');
        if (!box || !prodState) {return;}
        box.innerHTML = prodState.matRows.map(materialRowHtml).join('');
    }

    function renderProdDists() {
        const box = panelEl.querySelector('[data-v2-prod-dists]');
        if (!box || !prodState) {return;}
        box.innerHTML = prodState.distRows.map(distRowHtml).join('');
        updateProdSummary();
    }

    /** شريط الموزّع/المتبقي — نص features/kitchen.js:66 نفسه بشارات السجل. */
    function updateProdSummary() {
        if (!prodState || panelKind !== 'production') {return;}
        const sumEl = panelEl.querySelector('[data-v2-prod-summary]');
        if (!sumEl) {return;}
        const total = Number(fieldVal('qty') || 0);
        const allocated = prodState.distRows.reduce((s, r) => s + Number(r.quantity || 0), 0);
        const diff = Number((total - allocated).toFixed(4));
        sumEl.innerHTML = `الموزع: <strong class="erp-num" dir="ltr">${esc(legacyQty(allocated))}</strong> من <strong class="erp-num" dir="ltr">${esc(legacyQty(total))}</strong> `
            + (diff === 0
                ? `<span class="erp-badge" data-tone="success" data-unknown="false"><i class="ji" data-i="circle-check" aria-hidden="true"></i><span class="erp-badge-label">مكتمل</span></span>`
                : `<span class="erp-badge" data-tone="warning" data-unknown="false"><i class="ji" data-i="hourglass" aria-hidden="true"></i><span class="erp-badge-label">المتبقي: ${esc(legacyQty(diff))}</span></span>`);
    }

    /** اختيار منتج مسجل يملأ الاسم (إن كان فارغًا) والوحدة — نفس قاعدة
     *  syncKitchenProduct في features/kitchen.js:38-46 حرفيًا. */
    function syncProdProduct() {
        const sel = panelEl.querySelector('[data-f="product"]');
        const opt = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
        if (!opt || !opt.value) {return;}
        const nm = panelEl.querySelector('[data-f="name"]');
        const un = panelEl.querySelector('[data-f="unit"]');
        if (nm && !nm.value.trim() && opt.dataset.name) {nm.value = opt.dataset.name;}
        if (un && opt.dataset.unit) {un.value = opt.dataset.unit;}
    }

    function productionHtml(warns) {
        const products = (prodState.products || []).map((p) => {
            const nm = p.name_ar || p.name_en || 'منتج';
            const un = p.unit || 'وحدة';
            return `<option value="${esc(String(p.id))}" data-name="${esc(nm)}" data-unit="${esc(un)}">${esc(nm)} — ${esc(un)}</option>`;
        }).join('');
        const emptyCallout = (prodState.materials || []).length ? '' : `
          <div class="erp-flow-note" data-tone="warning" role="status">
            <strong><i class="ji" data-i="alert-triangle" aria-hidden="true"></i> مخزن المطبخ فارغ — لا توجد أصناف متاحة</strong>
            <div class="erp-text-sm">استلم المواد أولًا (من إذن صرف معتمد أو تحويل استثنائي) ثم عُد لإكمال الأمر.</div>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-goto-transfer>
              <i class="ji" data-i="inbox" aria-hidden="true"></i><span>استلام مواد الآن</span>
            </button>
          </div>`;
        return panelShell('أمر إنتاج وتوزيع المطبخ', 'cooking-pot', `
          <p class="erp-text-sm erp-text-muted">ثلاث خطوات بالترتيب: المنتج ← المكونات ← التوزيع.</p>
          ${warns.length ? `<div class="erp-flow-note" data-tone="danger" role="alert">${warns.map(esc).join('<br>')}</div>` : ''}
          <div class="erp-prod-step"><span class="erp-prod-step__num" aria-hidden="true">1</span>
            <div><strong>المنتج النهائي</strong>
              <small class="erp-text-muted">اكتب الاسم يدويًا، أو اختر منتجًا مسجلًا فيملأ الاسم والوحدة تلقائيًا (مستقل عن الوصفة وكتالوج البيع)</small></div>
          </div>
          <label class="erp-field"><span class="erp-label">اسم المنتج النهائي</span>
            <input class="erp-input" type="text" data-f="name" placeholder="مثال: دجاج مطهي أو صينية لحم"></label>
          <div class="erp-prod-grid">
            <label class="erp-field"><span class="erp-label">منتج مسجل اختياري</span>
              <select class="erp-select" data-f="product">
                <option value="">بدون ربط بمنتج مسجل</option>${products}
              </select></label>
            <label class="erp-field"><span class="erp-label">الوحدة</span>
              <input class="erp-input" type="text" data-f="unit" value="وحدة" placeholder="حبة، كجم، صينية..."></label>
          </div>
          <label class="erp-field"><span class="erp-label">إجمالي الكمية المنتجة</span>
            <input class="erp-input erp-input--ltr" type="number" data-f="qty" min="0.01" step="0.01" placeholder="مثال: 50 حبة"></label>
          <div class="erp-prod-step"><span class="erp-prod-step__num" aria-hidden="true">2</span>
            <div><strong>المكونات من مخزن المطبخ</strong>
              <small class="erp-text-muted">مثال: أرز 40 كجم، لحم 20 كجم، هالك 5%.</small></div>
          </div>
          ${emptyCallout}
          <div data-v2-prod-materials class="erp-stack"></div>
          <div><button type="button" class="erp-btn erp-btn--sm" data-v2-add-material>
            <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة مكون</span>
          </button></div>
          <div class="erp-prod-step"><span class="erp-prod-step__num" aria-hidden="true">3</span>
            <div><strong>توزيع المنتج النهائي</strong>
              <small class="erp-text-muted">يجب أن يساوي مجموع التوزيع إجمالي الإنتاج.</small></div>
          </div>
          <div data-v2-prod-dists class="erp-stack"></div>
          <div><button type="button" class="erp-btn erp-btn--sm" data-v2-add-dist>
            <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة جهة</span>
          </button></div>
          <div data-v2-prod-summary class="erp-text-sm erp-text-muted" role="status" aria-live="polite"></div>
          <label class="erp-field"><span class="erp-label">ملاحظات الأمر</span>
            <textarea class="erp-input" data-f="notes" rows="2" placeholder="وردية الصباح، دفعة الغداء، رقم المناسبة..."></textarea></label>
          ${panelActions('حفظ أمر الإنتاج والتوزيع', 'save', '', !(prodState.materials || []).length, 'production')}
        `);
    }

    async function openProductionPanel(seq) {
        setPanel(panelLoading('أمر إنتاج وتوزيع المطبخ', 'cooking-pot'));
        const [pRes, mRes, dRes] = await Promise.allSettled([
            fetchProductionProducts(), fetchProductionMaterials(), fetchProductionDestinations(),
        ]);
        if (!panelAlive(seq)) {return;}
        const warns = [];
        const products = pRes.status === 'fulfilled' ? pRes.value : [];
        const materials = mRes.status === 'fulfilled' ? mRes.value : [];
        const destinations = dRes.status === 'fulfilled' ? dRes.value : [];
        if (pRes.status === 'rejected') {warns.push(`تعذر تحميل المنتجات النهائية: ${(pRes.reason && pRes.reason.message) || 'خطأ'}`);}
        if (mRes.status === 'rejected') {warns.push(`تعذر تحميل رصيد مخزن المطبخ: ${(mRes.reason && mRes.reason.message) || 'خطأ'}`);}
        if (dRes.status === 'rejected') {warns.push(`تعذر تحميل أقسام التوزيع: ${(dRes.reason && dRes.reason.message) || 'خطأ'}`);}
        prodState = {
            products: products.filter((p) => p && p.is_active !== false),
            materials,
            destinations,
            matRows: [{ inventory_id: '', quantity: '', waste_percent: '0' }],
            distRows: [],
        };
        // أول جهتين إداريتين افتراضيًا، وإلا جهة مخصصة — قاعدة features/kitchen.js:31-32
        prodState.distRows = destinations.slice(0, 2).map((d) => ({ destination: `department|${d.id}|${d.name}`, customName: '', quantity: '' }));
        if (!prodState.distRows.length) {prodState.distRows = [{ destination: 'custom|custom|', customName: '', quantity: '' }];}
        setPanel(productionHtml(warns));
        renderProdMaterials();
        renderProdDists();
    }

    /* ── استلام المواد (تحويل استثنائي) — نصوص features/kitchen.js:101-125 ── */

    function transferRowHtml(row, i) {
        const items = (transferState.stock.items || []);
        const opts = items.map((m) => {
            const sel = String(m.inventory_id) === String(row.inventory_id) ? ' selected' : '';
            return `<option value="${esc(String(m.inventory_id))}" data-max="${esc(String(m.available))}"${sel}>${esc(m.name)} — متاح ${esc(legacyQty(m.available))} ${esc(m.unit || 'وحدة')}</option>`;
        }).join('');
        return `<div class="erp-prod-line" data-t-row="${i}">
          <div class="erp-prod-grid">
            <label class="erp-field"><span class="erp-label">الصنف</span>
              <select class="erp-select" data-f="t-inv" data-i="${i}">
                <option value="">اختر صنفًا من المخزن الرئيسي</option>${opts}
              </select></label>
            <label class="erp-field"><span class="erp-label">الكمية</span>
              <input class="erp-input erp-input--ltr" type="number" min="0.001" step="0.001" data-f="t-qty" data-i="${i}" value="${esc(row.qty || '')}" placeholder="الكمية"></label>
          </div>
          <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-remove-transfer data-index="${i}"
                  aria-label="حذف السطر ${i + 1}"><i class="ji" data-i="x" aria-hidden="true"></i></button>
        </div>`;
    }

    function transferHtml() {
        const s = transferState.stock;
        return panelShell('استلام مواد في مخزن المطبخ', 'inbox', `
          ${flowNote('info', 'info', 'هذا المسار الإداري مخصص للتحويلات الاستثنائية فقط. المواد المعتادة للمطبخ تدخل من خلال إذن الصرف المعتمد واستلامه بالتوقيع.')}
          <p class="erp-text-sm">من: <strong>${esc((s.source && s.source.name_ar) || 'المخزن الرئيسي')}</strong> ← إلى: <strong>${esc((s.destination && s.destination.name_ar) || 'مخزن المطبخ')}</strong></p>
          <div data-v2-transfer-rows class="erp-stack"></div>
          <div><button type="button" class="erp-btn erp-btn--sm" data-v2-add-transfer>
            <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة صنف</span>
          </button></div>
          <label class="erp-field"><span class="erp-label">ملاحظات التحويل</span>
            <textarea class="erp-input" data-f="t-notes" rows="2" placeholder="مثال: تجهيز وردية الغداء"></textarea></label>
          ${panelActions('استلام المواد', 'inbox', '', false, 'transfer')}
        `);
    }

    function renderTransferRows() {
        const box = panelEl.querySelector('[data-v2-transfer-rows]');
        if (!box || !transferState) {return;}
        box.innerHTML = transferState.rows.map(transferRowHtml).join('');
    }

    function syncTransferMax(i, select) {
        if (!transferState || !transferState.rows[i]) {return;}
        const row = transferState.rows[i];
        row.inventory_id = select.value;
        const opt = select.selectedOptions && select.selectedOptions[0];
        const max = Number((opt && opt.dataset && opt.dataset.max) || 0);
        const qtyInput = panelEl.querySelector(`[data-f="t-qty"][data-i="${i}"]`);
        if (!qtyInput) {return;}
        qtyInput.max = max || '';
        if (Number(row.qty) > max) {
            // إصلاح معلن: القديم لوهدَة :120 كان يقلّص الخانة فقط ثم يرسل الحالة
            // القديمة أكبر من المتاح — الحالة المخزَّنة نفسها تُقصّ هنا.
            row.qty = max;
            qtyInput.value = String(max);
        }
    }

    async function openTransferPanel(seq) {
        setPanel(panelLoading('استلام مواد في مخزن المطبخ', 'inbox'));
        let stock;
        try {
            stock = await fetchKitchenStock();
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            retryState = { kind: 'transfer', raw: null };
            setPanel(panelRetry('استلام مواد في مخزن المطبخ', 'inbox', `تعذر قراءة أرصدة المخزن الرئيسي: ${(e && e.message) || 'خطأ'}`));
            return;
        }
        if (!panelAlive(seq)) {return;}
        if (!stock.source || !stock.destination) {
            setPanel(panelShell('استلام مواد في مخزن المطبخ', 'inbox', `
              <div class="erp-state" role="alert">
                <span class="erp-state__title">موقع المخزن الرئيسي أو مخزن المطبخ غير مهيأ</span>
                <span>لا يُفتح نموذج الاستلام قبل ضبط الموقعين في إعدادات المخزون.</span>
                <button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-panel-close>إغلاق</button>
              </div>`));
            return;
        }
        transferState = { stock, rows: [{ inventory_id: '', qty: '' }] };
        setPanel(transferHtml());
        renderTransferRows();
    }

    /* ── الجرد: إنشاء · عدّ · إرسال · اعتماد ──────────────────────────── */

    function auditNewHtml() {
        const opts = Object.entries(PERIOD_SELECT_LABELS).map(([value, label]) =>
            `<option value="${esc(value)}"${value === 'daily' ? ' selected' : ''}>${esc(label)}</option>`).join('');
        return panelShell('إنشاء جرد ذكي للمطبخ', 'clipboard-list', `
          <p class="erp-text-sm erp-text-muted">سيتم التقاط رصيد مخزن المطبخ الحالي كرصيد نظامي، ثم تدخل الكميات الفعلية قبل الإرسال للاعتماد.</p>
          ${flowNote('info', 'info', 'إذا ظهر «لا توجد أرصدة في مخزن المطبخ»، افتح سجل أذونات الصرف واستلم إذنًا معتمدًا ووقّعه من المطبخ أولًا.')}
          <label class="erp-field"><span class="erp-label">دورية الجرد</span>
            <select class="erp-select" data-f="a-period">${opts}</select></label>
          <div class="erp-prod-grid">
            <label class="erp-field"><span class="erp-label">بداية الفترة</span>
              <input class="erp-input erp-input--ltr" type="date" data-f="a-start" value="${esc(isoDay(0))}"></label>
            <label class="erp-field"><span class="erp-label">نهاية الفترة</span>
              <input class="erp-input erp-input--ltr" type="date" data-f="a-end" value="${esc(isoDay(0))}"></label>
          </div>
          <label class="erp-field"><span class="erp-label">ملاحظات</span>
            <textarea class="erp-input" data-f="a-notes" rows="3" placeholder="وردية، سبب الجرد، أسماء فريق العد..."></textarea></label>
          ${panelActions('إنشاء جلسة الجرد', 'plus', '', false, 'audit-create')}
        `);
    }

    const varianceText = (v) => Number(v).toFixed(3);

    function auditCountHtml(a) {
        const items = a.items || [];
        const editable = a.status === 'draft' && canWrite;
        const moves = distributionsInRange(distributions, a.start, a.end);
        const moveRows = moves.length
            ? moves.map((x) => `
              <tr>
                <td>${esc(x.productResolved ? x.product : '—')}</td>
                <td>${esc(x.dest === '—' && x.code ? x.code : x.dest)}</td>
                <td class="erp-num" dir="ltr">${esc(legacyQty(x.qty))}</td>
              </tr>`).join('')
            : `<tr><td colspan="3">لا توجد حركة إنتاج موزعة في هذه الفترة</td></tr>`;
        const itemRows = items.length
            ? items.map((x) => `
              <tr>
                <td>${x.nameResolved ? esc(x.name) : `<span class="erp-text-muted" title="لا اسم مخزّن — يُعرض رقم السجل">${esc(x.name)}</span>`}<small class="erp-text-muted"> ${esc(x.unit || '')}</small></td>
                <td class="erp-num" dir="ltr">${esc(formatQty(x.system))}</td>
                <td><input class="erp-input erp-input--ltr" type="number" min="0" step="0.001" data-f="audit-count" data-id="${esc(String(x.id))}" value="${esc(String(x.counted))}"${editable ? '' : ' disabled'}></td>
                <td class="erp-num" data-v2-var data-id="${esc(String(x.id))}" dir="ltr">${esc(varianceText(x.variance))}</td>
              </tr>`).join('')
            : `<tr><td colspan="4">لا توجد أرصدة في مخزن المطبخ</td></tr>`;
        const withDiff = items.filter((x) => Math.abs(Number(varianceText(x.variance))) > 0.0005).length;
        const draftActions = editable
            ? signaturePadMarkup(SIG_IDS.auditSend, 'توقيع مسؤول العد والإرسال', signerName)
              + panelActions('إرسال بتوقيع', 'send',
                  `<button type="button" class="erp-btn" data-v2-submit data-v2-submit-kind="audit-save">
                     <i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ العد</span>
                   </button>`, false, 'audit-send')
            : `<div class="erp-kitchen-panel__actions">
                 <span class="erp-grow"></span>
                 <button type="button" class="erp-btn" data-v2-panel-close>إغلاق</button>
               </div>`;
        return panelShell(`جرد ${esc(a.periodAr)} — ${esc(a.number)}`, 'calculator', `
          <p class="erp-text-sm erp-text-muted">الفترة: ${esc(a.start || '—')} إلى ${esc(a.end || '—')}. أدخل الكمية الفعلية لكل صنف.</p>
          ${flowNote('brand', 'cooking-pot', `<strong>حركة الإنتاج والتوزيع خلال الفترة</strong>
            <div class="tbl-wrap"><table class="erp-mini-table">
              <thead><tr><th>المنتج</th><th>الجهة</th><th>الكمية</th></tr></thead>
              <tbody>${moveRows}</tbody>
            </table></div>`)}
          <div class="tbl-wrap"><table class="erp-mini-table">
            <thead><tr><th>الصنف</th><th>الرصيد النظامي</th><th>الفعلي</th><th>الفرق</th></tr></thead>
            <tbody>${itemRows}</tbody>
          </table></div>
          <p class="erp-text-sm erp-text-muted" data-v2-count-note role="status" aria-live="polite">أصناف بفرق: ${esc(formatInt(withDiff))} من ${esc(formatInt(items.length))}</p>
          ${draftActions}
        `);
    }

    function auditApproveHtml(a) {
        const items = a.items || [];
        const withDiff = items.filter((x) => Math.abs(Number(varianceText(x.variance))) > 0.0005).length;
        return panelShell('اعتماد جرد المطبخ', 'pen-tool', `
          ${flowNote('warning', 'alert-triangle', 'سيتم تطبيق الفروقات في دفتر المخزون ولا يمكن اعتماد الجرد مرة أخرى.')}
          <p class="erp-text-sm erp-text-muted">جرد ${esc(a.periodAr)} — ${esc(a.number)} · ${esc(formatInt(items.length))} صنفًا · أصناف بفرق: ${esc(formatInt(withDiff))}</p>
          ${signaturePadMarkup(SIG_IDS.auditApprove, 'توقيع مسؤول اعتماد الجرد', signerName)}
          ${panelActions('اعتماد وتوقيع', 'circle-check', '', false, 'audit-approve')}
        `);
    }

    /** الفروق مباشرة مع الكتابة — القديم يطبع الفرق مرة واحدة عند الفتح. */
    function updateVarianceNote() {
        const raw = panelRaw;
        const noteEl = panelEl.querySelector('[data-v2-count-note]');
        if (!raw || !noteEl || !Array.isArray(raw.items)) {return;}
        let withDiff = 0;
        for (const x of raw.items) {
            const input = panelEl.querySelector(`[data-f="audit-count"][data-id="${String(x.id)}"]`);
            const shown = varianceText(Number((input ? input.value : x.counted) || 0) - x.system);
            const cell = panelEl.querySelector(`[data-v2-var][data-id="${String(x.id)}"]`);
            if (cell) {cell.textContent = shown;}
            if (Math.abs(Number(shown)) > 0.0005) {withDiff += 1;}
        }
        noteEl.textContent = `أصناف بفرق: ${formatInt(withDiff)} من ${formatInt(raw.items.length)}`;
    }

    function collectAuditValues() {
        const values = {};
        panelEl.querySelectorAll('[data-f="audit-count"]').forEach((input) => {
            values[input.dataset.id] = input.value;
        });
        return values;
    }

    /* ── فتح اللوحة وتوجيه الأزرار ─────────────────────────────────────── */

    async function openPanel(kind, raw) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (SIGN_KINDS.has(kind) && !signerName) {
            notify('اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع');
            return;
        }
        if ((kind === 'production' || kind === 'transfer' || kind === 'audit-new') && !canWrite) {
            notify('لا صلاحية لهذا الإجراء بهذا الحساب — دورة المطبخ كتابةٌ لأدوار المخازن والمطبخ');
            return;
        }
        if (kind === 'audit-approve' && !canApprove) {
            notify('اعتماد الجرد لأدوار الاعتماد (أدمن · مدير · مراجع)');
            return;
        }
        closePanel();
        const seq = panelSeq;
        panelKind = kind;
        panelRaw = raw;
        panelEl.hidden = false;

        if (kind === 'production') {await openProductionPanel(seq); return;}
        if (kind === 'transfer') {await openTransferPanel(seq); return;}
        if (kind === 'audit-new') {setPanel(auditNewHtml()); return;}
        if (kind === 'audit-count') {
            setPanel(auditCountHtml(raw));
            if (raw.status === 'draft' && canWrite) {initSignaturePad(panelEl, SIG_IDS.auditSend, signerName);}
            return;
        }
        if (kind === 'audit-approve') {
            setPanel(auditApproveHtml(raw));
            initSignaturePad(panelEl, SIG_IDS.auditApprove, signerName);
        }
    }

    /** تأكيد الاعتماد باسم صاحبه ثم اللوحة الموقّعة — نص :95 حرفيًا. */
    async function requestApprove(raw) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (!canApprove) {notify('اعتماد الجرد لأدوار الاعتماد (أدمن · مدير · مراجع)'); return;}
        if (raw.status !== 'submitted') {notify('الجرد ليس بانتظار الاعتماد — حدّث القائمة'); return;}
        if (!signerName) {notify('اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع'); return;}
        const ok = await confirmFn('سيتم تسجيل فروقات الجرد في دفتر المخزون. هل تريد الاعتماد؟');
        if (!ok) {return;}
        openPanel('audit-approve', raw);
    }

    /* ── إرسال لوحات القرار ────────────────────────────────────────────── */

    async function submitProduction() {
        const form = {
            productId: fieldVal('product'),
            productName: fieldVal('name'),
            productUnit: fieldVal('unit'),
            producedQty: fieldVal('qty'),
            notes: fieldVal('notes'),
            materials: prodState ? prodState.matRows : [],
            distributions: prodState ? prodState.distRows : [],
        };
        const bad = validateProductionForm(form);
        if (bad) {panelMsg(bad); return;}
        const payload = productionPayload(form);
        busy = true;
        try {
            const result = await createProduction(payload);
            const n = (result && result.distributions && result.distributions.length) || payload.distributions.length;
            closePanel();
            notify(`تم تسجيل إنتاج ${legacyQty(payload.produced_qty)} وتوزيعه على ${n} جهات مع خصم المكونات من مخزن المطبخ`);
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر تسجيل الإنتاج والتوزيع');
        } finally {
            busy = false;
        }
    }

    async function submitTransfer() {
        const payload = transferPayload(transferState ? transferState.stock : {}, transferState ? transferState.rows : [], fieldVal('t-notes'));
        if (!payload) {panelMsg('اختر صنفًا وأدخل كمية صحيحة'); return;}
        busy = true;
        try {
            const result = await receiveKitchenTransfer(payload);
            const n = (result && Array.isArray(result.items) && result.items.length) || payload.items.length;
            closePanel();
            notify(`تم استلام ${legacyQty(n)} صنف في مخزن المطبخ`);
            await reload();
            await readGovernance();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر استلام مواد المطبخ؛ تحقق من رصيد المخزن الرئيسي');
        } finally {
            busy = false;
        }
    }

    async function submitAuditCreate() {
        const period = fieldVal('a-period') || 'daily';
        const start = fieldVal('a-start') || isoDay(0);
        const end = fieldVal('a-end') || isoDay(0);
        const bad = validateAuditPeriod(start, end);
        if (bad) {panelMsg(bad); return;}
        busy = true;
        let created = null;
        try {
            created = await createKitchenAudit(auditPayload({ period, periodStart: start, periodEnd: end, notes: fieldVal('a-notes') }));
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر إنشاء الجرد');
            busy = false;
            return;
        }
        // ردّ الإنشاء لا يحمل أصنافًا بمعرّفات (:329 يرسل صفوف الرصيد الخام) —
        // القراءة أصل المعرّفات (:328 json_agg منه 'id',ai.id) — نفس ترتيب القديم :83.
        await readGovernance();
        busy = false;
        const row = audits.find((a) => String(a.id) === String(created && created.id));
        if (row) {
            openPanel('audit-count', row);
        } else {
            closePanel();
            notify('جلسة الجرد غير موجودة');
        }
    }

    async function submitAuditSave() {
        const raw = panelRaw;
        const values = collectAuditValues();
        busy = true;
        try {
            await countKitchenAudit(raw.id, { items: countPayload(raw.items, values) });
            closePanel();
            notify('تم حفظ كميات الجرد');
            await readGovernance();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر حفظ العد');
        } finally {
            busy = false;
        }
    }

    async function submitAuditSend() {
        const raw = panelRaw;
        // إصلاح معلن لوهدَة: التوقيع أولًا ثم العدّ ثم الإرسال — القديم :94 كان
        // يحفظ العدّ ثم يقرأ التوقيع، فيبقى عدٌّ محفوظ بلا إرسال إن فشل القارئ.
        const sig = readSig(SIG_IDS.auditSend);
        if (sig == null) {return;}
        const values = collectAuditValues();
        busy = true;
        try {
            await countKitchenAudit(raw.id, { items: countPayload(raw.items, values) });
            await submitKitchenAudit(raw.id, { signatureData: sig, signerName });
            closePanel();
            notify('تم إرسال الجرد للاعتماد');
            await readGovernance();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر إرسال الجرد');
        } finally {
            busy = false;
        }
    }

    async function submitAuditApprove() {
        const raw = panelRaw;
        const sig = readSig(SIG_IDS.auditApprove);
        if (sig == null) {return;}
        busy = true;
        try {
            await approveKitchenAudit(raw.id, { signatureData: sig, signerName });
            closePanel();
            notify('تم اعتماد الجرد وترحيل الفروقات');
            await readGovernance();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر اعتماد الجرد');
        } finally {
            busy = false;
        }
    }

    function submitPanel(btn) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const kind = btn && btn.dataset ? btn.dataset.v2SubmitKind : '';
        if (panelKind === 'production') {submitProduction(); return;}
        if (panelKind === 'transfer') {submitTransfer(); return;}
        if (panelKind === 'audit-new') {submitAuditCreate(); return;}
        if (panelKind === 'audit-count') {
            if (kind === 'audit-save') {submitAuditSave(); return;}
            submitAuditSend();
            return;
        }
        if (panelKind === 'audit-approve') {submitAuditApprove();}
    }

    /* ── التفويض: نقرة/كتابة واحدة تخدم كل اللوحات (CSP: لا معالج سطري) ── */

    el.addEventListener('click', (event) => {
        const costReload = event.target.closest('[data-v2-cost-reload]');
        if (costReload) {readCostCards(); return;}
        const costPrint = event.target.closest('[data-v2-cost-print]');
        if (costPrint) {printCostCard(costPrint.dataset.v2CostPrint); return;}
        const stateBtn = event.target.closest('[data-v2-state]');
        if (stateBtn) {
            if (stateBtn.dataset.v2State === stateFilter) {return;}
            stateFilter = stateBtn.dataset.v2State;
            paint();
            return;
        }
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            const raw = audits.find((a) => String(a.id) === String(actBtn.dataset.id));
            if (!raw) {notify('تعذر العثور على الجرد — حدّث القائمة'); return;}
            if (actBtn.dataset.v2Act === 'audit-approve') {requestApprove(raw); return;}
            openPanel('audit-count', raw);
            return;
        }
        if (event.target.closest('[data-v2-panel-close]')) {closePanel(); return;}
        const submitBtn = event.target.closest('[data-v2-submit]');
        if (submitBtn) {submitPanel(submitBtn); return;}
        if (event.target.closest('[data-v2-retry-panel]')) {
            if (retryState) {openPanel(retryState.kind, retryState.raw);}
            return;
        }
        if (event.target.closest('[data-v2-new-production]')) {openPanel('production', null); return;}
        if (event.target.closest('[data-v2-new-audit]')) {openPanel('audit-new', null); return;}
        if (event.target.closest('[data-v2-new-transfer]')) {openPanel('transfer', null); return;}
        if (event.target.closest('[data-v2-goto-transfer]')) {openPanel('transfer', null); return;}
        if (event.target.closest('[data-v2-add-material]')) {
            if (prodState) {prodState.matRows.push({ inventory_id: '', quantity: '', waste_percent: '0' }); renderProdMaterials();}
            return;
        }
        if (event.target.closest('[data-v2-add-dist]')) {
            if (prodState) {prodState.distRows.push({ destination: 'custom|custom|', customName: '', quantity: '' }); renderProdDists();}
            return;
        }
        if (event.target.closest('[data-v2-add-transfer]')) {
            if (transferState) {transferState.rows.push({ inventory_id: '', qty: '' }); renderTransferRows();}
            return;
        }
        const rmM = event.target.closest('[data-v2-remove-material]');
        if (rmM) {
            if (prodState && prodState.matRows.length > 1) {
                prodState.matRows.splice(Number(rmM.dataset.index), 1);
                renderProdMaterials();
            }
            return;
        }
        const rmD = event.target.closest('[data-v2-remove-dist]');
        if (rmD) {
            if (prodState && prodState.distRows.length > 1) {
                prodState.distRows.splice(Number(rmD.dataset.index), 1);
                renderProdDists();
            }
            return;
        }
        const rmT = event.target.closest('[data-v2-remove-transfer]');
        if (rmT) {
            if (transferState) {
                if (transferState.rows.length <= 1) {
                    transferState.rows[0] = { inventory_id: '', qty: '' };   // قاعدة :112 — آخر سطر يُفرَّغ لا يُحذف
                } else {
                    transferState.rows.splice(Number(rmT.dataset.index), 1);
                }
                renderTransferRows();
            }
            return;
        }
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); readGovernance(); readCostCards(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload(); readGovernance(); readCostCards();}
    });

    el.addEventListener('input', (event) => {
        const t = event.target;
        if (t.matches('[data-f="qty"]')) {updateProdSummary(); return;}
        if (t.matches('[data-f="m-qty"]')) {
            const i = Number(t.dataset.i);
            if (prodState && prodState.matRows[i]) {prodState.matRows[i].quantity = t.value;}
            return;
        }
        if (t.matches('[data-f="m-waste"]')) {
            const i = Number(t.dataset.i);
            if (prodState && prodState.matRows[i]) {prodState.matRows[i].waste_percent = t.value;}
            return;
        }
        if (t.matches('[data-f="d-qty"]')) {
            const i = Number(t.dataset.i);
            if (prodState && prodState.distRows[i]) {prodState.distRows[i].quantity = t.value;}
            updateProdSummary();
            return;
        }
        if (t.matches('[data-f="d-custom"]')) {
            const i = Number(t.dataset.i);
            if (prodState && prodState.distRows[i]) {prodState.distRows[i].customName = t.value;}
            return;
        }
        if (t.matches('[data-f="t-qty"]')) {
            const i = Number(t.dataset.i);
            if (transferState && transferState.rows[i]) {transferState.rows[i].qty = t.value;}
            return;
        }
        if (t.matches('[data-f="audit-count"]')) {updateVarianceNote();}
    });

    el.addEventListener('change', (event) => {
        const t = event.target;
        if (t.matches('[data-v2-cost-from]') || t.matches('[data-v2-cost-to]')) {readCostCards(); return;}
        if (t.matches('[data-f="product"]')) {syncProdProduct(); return;}
        if (t.matches('[data-f="m-inv"]')) {
            const i = Number(t.dataset.i);
            if (prodState && prodState.matRows[i]) {prodState.matRows[i].inventory_id = t.value;}
            return;
        }
        if (t.matches('[data-f="d-dest"]')) {
            const i = Number(t.dataset.i);
            if (prodState && prodState.distRows[i]) {
                prodState.distRows[i].destination = t.value;
                renderProdDists();                  // خانة الاسم المخصص تظهر/تختفي
            }
            return;
        }
        if (t.matches('[data-f="t-inv"]')) {syncTransferMax(Number(t.dataset.i), t);}
    });

    reload();
    readGovernance();
    readCostCards();

    return {
        el,
        reload,
        getRows: () => batches,
        getState: () => stateFilter,
        destroy() {
            panelSeq += 1;
            disposeSignaturePads(ALL_SIG_IDS);
            table.destroy();
            excTable.destroy();
            polTable.destroy();
            auditTable.destroy();
            docTable.destroy();
            el.remove();
        },
    };
}
