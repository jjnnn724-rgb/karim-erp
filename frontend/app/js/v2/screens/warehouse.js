/**
 * V2 — Warehouse screen · شاشة 03 في سجل الترحيل
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SAME CONTRACT AS SCREENS 01 AND 02, SAME VISUAL LANGUAGE
 *   One network door (v2/data/inventory-repo.js) — and since W1-6 the register
 *   carries the six inventory writes the owner ordered, each through its named
 *   door and each behind the same role gate the server enforces anyway.
 *
 * WRITE SURFACES (W1-6b) — legacy refs, texts verbatim, declared deviations
 *   • وارد سريع (row action): quick stock-in legacy.js:1311-1345 — server
 *     recomputes the weighted cost (:1584-1628). Deviation (د): the legacy
 *     form pre-filled «سعر الشراء» from the stored average cost; this register
 *     drops cost by contract, so the field starts empty and is REQUIRED — a
 *     zero price would silently falsify the weighted average, and legacy never
 *     sent one (parseFloat('0') returning the stored cost). 'أدخل كمية صحيحة'
 *     :1330 and the success sentence :1342 kept as written.
 *   • استيراد المخزون (toolbar): legacy.js:2488-2567 — same 20-item chunking
 *     (BULK_CHUNK), same progress texts, same failure list and the
 *     partial-success banner. Deviation (أ): a hand-typed grid replaces the
 *     Excel file (xlsx is not loaded by v2.html); the row mapping is the
 *     repository's bulkReceiptRows, copied from :2515-2522. The
 *     new/updated split is judged against the LOADED window and says so.
 *   • تعديل مباشر (row action, admin): legacy.js:1445-1464 — validation
 *     texts and the ledger-delta toast verbatim. Deviation (د): the confirm
 *     cannot print the old cost (not on this screen); it prints the new
 *     values and why the old one is missing.
 *   • دمج أصناف مكررة (toolbar, admin): legacy.js:2211-2250 — gate toast,
 *     empty state, group cards, «اختر النسخة التي تبقى», confirm and success
 *     texts. The panel stays open after a merge and rebuilds from fresh
 *     rows, as the legacy modal re-rendered itself.
 *   • حذف (row action): legacy.js:1489-1509 — confirm, the
 *     INVENTORY_HAS_MOVEMENTS retry (:1502-1503), the FK fallback :1507.
 *     Force delete needs the warehouse/admin gate (:2423).
 *   • Deviation (ب): no window.confirm/prompt (CSP + V2 contract) — every
 *     confirm goes through the host confirmFn with the legacy sentence.
 *
 * AUDIT STUDIO (W1-6c) — legacy.js:827-1277, texts verbatim, deviations
 *   Three tabs exactly as the legacy modal: جلسة جديدة / العد والفروقات /
 *   سجل الجرد. The snapshot, differences and approval all run on the chosen
 *   warehouse (Task 20), and no balance moves before approval — the intro
 *   keeps the legacy sentence. Counts and approvals carry the shared
 *   signature pad (signature.js, the same module dispatch already uses);
 *   the server re-checks the signer name on submit and approve.
 *   Deviations: (أ) an explicit per-row save button replaces the 900ms
 *   autosave (precedent W1-2), so step two of the intro says «بضغط زر الحفظ»
 *   rather than claiming an autosave that no longer exists; (ب) the cancel
 *   reason is a field inside the panel, not prompt() — confirms still go
 *   through the host confirmFn with the legacy sentences; (ج) no printing
 *   from the studio: the legacy fetches the sheet HTML with a Bearer header
 *   into an iframe, a door V2 does not own, and window.print is reserved for
 *   the register button alone; (د) the category list for a partial count is
 *   built from the loaded register window, not the legacy global
 *   STATE.inventory, and says so when the window is truncated; (هـ) the
 *   in-studio search matches literally (no global arSearchIncludes — W1-5
 *   precedent); (و) a success sentence follows each saved count, because an
 *   explicit save must visibly do something (the legacy was silent under its
 *   autosave). Money (scope preview, variance values, totals) shows only
 *   through the restaurant currency read from settings — same rule as every
 *   V2 money surface; the register itself still shows none.
 *
 * WHAT THE SCREEN SHOWS
 *   • A scope line that names the register it is reading and the filters the
 *     server applied — because on this screen the filters ARE server-side.
 *   • Chips for the three states the server's own SQL defines, plus the one
 *     case those states hide: a line with no minimum set.
 *   • «تحت الحد»: the six biggest gaps first. This is the question a
 *     warehouse manager opens the screen to ask.
 *   • «الأصناف حسب الفئة»: the frozen `.erp-tops` bars, counted over the
 *     result and keyed by the stored category string.
 *   • The register itself in EnterpriseDataTable.
 *
 * WHY THE FILTERS COST A REQUEST
 *   The legacy search box on this page is not decoration: the server matches
 *   name/barcode/category with an Arabic letter-family fallback («بازنجان»
 *   تجد «باذنجان», warehouse-routes.js:1715-1775) and filters stock states in
 *   SQL over the whole register. A V2 that only filtered locally would quietly
 *   lose both. So typing asks the server — and the screen says which results
 *   came from that tolerance.
 *
 * WHAT IS NOT HERE
 *   Cost is not DISPLAYED. `avgCost` arrives on every row and is dropped in
 *   the repository: a displayed money figure needs the restaurant's currency
 *   code, and that setting is not part of this host. The only places a cost
 *   value appears are the write forms, typed by the user (receipt price,
 *   direct edit cost). See inventory-repo.js.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.146';
import {
    fetchInventory, fetchShelves, shelfMap, inventoryToRow,
    buildInventoryKpis, categoryCounts, shortageRows,
    formatInt, formatQty, STOCK_FILTERS,
    invWriteVisible, invForceVisible, invDirectVisible, invMergeVisible,
    receiptPayload, receiveInventoryItem,
    bulkReceiptRows, bulkReceiveInventory, BULK_CHUNK,
    deleteInventoryItem, forceDeleteInventoryItem, hasMovementsError,
    directEditError, directEditPayload, directEditInventoryItem,
    duplicateGroups, mergeInventoryItems,
    auditReadVisible, auditWriteVisible, auditState,
    AUDIT_PERIOD_TYPES, auditPeriodError, startAuditPayload,
    fetchAuditLocations, fetchAuditPreview, fetchAudits, fetchAuditDetail,
    startAuditSession, saveAuditCount, clearAuditCount,
    submitAuditSession, approveAuditSession, cancelAuditSession,
    auditToRow, auditItemToRow, auditSummaryOf, scopePreviewText,
} from '../data/inventory-repo.js?v=4.9.146';
import { formatMoney, fetchCurrency } from '../data/reports-repo.js?v=4.9.146';
import { hasGovernanceRead } from '../data/warehouse-gov-repo.js?v=4.9.146';
import {
    normalizeSignerName, signaturePadMarkup, initSignaturePad, readSignaturePad,
    disposeSignaturePads,
} from '../signature.js?v=4.9.146';

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

/* لوحة توقيع واحدة للاستوديو — إرسال واعتماد الجلسة يوقّعان بها. */
const SIG_ID = 'v2wh-audit-sig';

/** nصوص عطب التوقيع نفسها في شاشة الصرف (dispatch.js:82-89). */
function signatureErrorText(err) {
    return ({
        SIGNER_NAME_MISSING: 'اسم الموقّع غير متاح في الجلسة — أعد تسجيل الدخول ثم حاول مجددًا',
        SIGNER_MISMATCH: 'التوقيع باسم حسابك فقط — لا يمكن توقيع اسم آخر',
        NO_INK: 'تعذر رسم التوقيع — راجع خانة التوقيع',
        NO_PAD: 'تعذر تهيئة لوحة التوقيع — أعد فتح اللوحة',
    })[err] || 'تعذر قراءة التوقيع';
}

/** تسميات أنواع الفترة — كلمات القديم (warehouse.js:964). */
const PERIOD_LABEL = {
    daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري', custom: 'فترة مخصصة', annual: 'سنوي',
};

/** The server's enum, named in Arabic. Values are the query strings (:1727). */
const STOCK_SEG = {
    all: 'الكل', low: 'تحت الحد', out: 'نفد', ok: 'متوفر',
};

/** Sorted so «نفد» is always the first thing a sort by state surfaces. */
const SEVERITY = { out: 0, low: 1, ok: 2 };

const stateBadge = (state) => `<span class="erp-badge" data-tone="${esc(state.tone)}" data-unknown="false"`
    + ` data-raw="${esc(state.raw)}" aria-label="${esc(state.label)}">`
    + `<i class="ji" data-i="${esc(state.icon)}" aria-hidden="true"></i>`
    + `<span class="erp-badge-label">${esc(state.label)}</span></span>`;

function nameCell(row) {
    const label = row.nameResolved ? esc(row.name)
        : `<span class="erp-text-muted" title="لا اسم مخزّن — يُعرض رقم السجل">${esc(row.name)}</span>`;
    return row.barcode
        ? `${label}<span class="erp-mini__sub erp-mono" dir="ltr">${esc(row.barcode)}</span>`
        : label;
}

function shelfCell(row) {
    if (!row.shelfId) {return `<span class="erp-text-muted">بلا رف مسجّل</span>`;}
    if (!row.shelfResolved) {
        // A shelf id the register does not name is shown as the id it is.
        return `<span class="erp-text-muted" title="رقم الرف كما هو في السجل — لم يُحلّ إلى اسم">${esc(row.shelf)}</span>`;
    }
    return esc(row.shelf || row.shelfName || '—');
}

/** Quantities: the number, its unit, and why a zero may be a clamp. */
function qtyCell(v, unit, opts = {}) {
    const n = `<span class="erp-num" dir="ltr">${formatQty(v)}</span>`;
    const u = unit ? ` <span class="erp-text-sm erp-text-muted">${esc(unit)}</span>` : '';
    return opts.title ? `<span title="${esc(opts.title)}">${n}${u}</span>` : `${n}${u}`;
}

function kpiStrip(kpis, scopeLabel) {
    return `<ul class="erp-kpis" aria-label="مؤشرات ${esc(scopeLabel)} — محسوبة على الأصناف المعروضة">`
        + kpis.map((k) => `
      <li class="erp-kpi">
        <div class="erp-kpi__top">
          <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon)}"></i></span>
          <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
        </div>
        <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value)}</span>${k.unit ? ` <span class="erp-kpi__unit">${esc(k.unit)}</span>` : ''}</div>
        <div class="erp-kpi__foot">
          <span class="erp-delta erp-delta--flat" role="img" aria-label="${esc(k.pill.aria)}">
            <span class="erp-num" dir="ltr">${esc(k.pill.text)}</span>
          </span>
          <span class="erp-kpi__hint">${esc(k.hint)}</span>
        </div>
      </li>`).join('')
        + `</ul>`;
}

/** The six gaps: name, how much is missing, bar against the biggest gap. */
function shortageBlock(items, max) {
    if (!items.length) {
        return `<div class="erp-state" role="status">
          <span class="erp-state__title">لا أصناف تحت الحد</span>
          <span>لا صف في النتيجة الحالية عند qty≤minQty بكمية موجبة، ولا صف نفد.</span>
        </div>`;
    }
    return `<ul class="erp-tops" role="list" aria-label="أصناف تحت الحد أو نفدت، الأكبر نقصًا أولًا">`
        + items.map((r) => {
            const u = r.unit ? ` ${r.unit}` : '';
            const label = `${r.name} · ${r.state.label}`;
            const gap = r.short > 0
                ? qtyCell(r.short, r.unit, { title: `الناقص = الحد ${formatQty(r.minQty)} − الرصيد ${formatQty(r.qty)}${u}` })
                : `<span class="erp-text-muted" title="${esc(r.stateKey === 'out'
                    ? 'نفد بلا حد أدنى مسجّل — لا نقص يُحسب'
                    : 'الرصيد عند الحد بالضبط — لا نقص يُحسب')}">—</span>`;
            const title = r.stateKey === 'out'
                ? `${r.name}: الرصيد ${formatQty(r.qty)}${u}`
                    + (r.minQty > 0 ? ` عند حدّ ${formatQty(r.minQty)}${u}` : ' — لا حد أدنى مسجّل')
                : `${r.name}: المسجّل ${formatQty(r.qty)} من حدّ ${formatQty(r.minQty)}${u}`;
            return `
        <li class="erp-top__row">
          <span class="erp-top__name" title="${esc(title)}">${esc(label)}</span>
          <span class="erp-top__track"><span class="erp-top__fill" style="inline-size:${Math.round((r.short / max) * 100)}%"></span></span>
          <span class="erp-top__val">${gap}</span>
        </li>`;
        }).join('')
        + `</ul>`;
}

/** Register spread over the stored category strings — `.erp-tops` again. */
function topsBlock(cats, total) {
    if (!cats.length) {
        return `<div class="erp-state" role="status">
          <span class="erp-state__title">لا فئات في النتيجة</span>
          <span>لا صنف يحمل فئة مسجّلة، فكل توزيع محسوب على لا شيء.</span>
        </div>`;
    }
    const max = Math.max(...cats.map((c) => c.count), 1);
    const aria = `عدد الأصناف في كل فئة، أكبر فئة ${formatInt(max)} صنفًا من ${formatInt(total)}`;
    return `<ul class="erp-tops" role="list" aria-label="${esc(aria)}">`
        + cats.map((c) => {
            const label = c.value || 'بلا فئة مسجّلة';
            const title = `${label}: ${formatInt(c.count)} من ${formatInt(total)} صنفًا`;
            return `
        <li class="erp-top__row">
          <span class="erp-top__name${c.value ? '' : ' erp-text-muted'}" title="${esc(title)}">${esc(label)}</span>
          <span class="erp-top__track"><span class="erp-top__fill" style="inline-size:${Math.round((c.count / max) * 100)}%"></span></span>
          <span class="erp-top__val"><span class="erp-num" dir="ltr">${formatInt(c.count)}</span></span>
        </li>`;
        }).join('')
        + `</ul>`;
}

/** Only the segment repaints — the search box and the selects are never rebuilt. */
function segBlock(activeStock) {
    return `<div class="erp-seg" role="group" aria-label="حالة المخزون">`
        + `<span class="erp-seg__label">الحالة</span>`
        + STOCK_FILTERS.map((kind) => {
            const on = kind === activeStock;
            return `<button type="button" data-v2-stock="${esc(kind)}"${on ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(STOCK_SEG[kind])}</button>`;
        }).join('')
        + `</div>`;
}

function template(stock, can) {
    return `
      <div class="erp-v2-warehouse" data-v2-warehouse>
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">المخزون
              <span class="erp-eyebrow" dir="ltr" lang="en">Inventory</span>
            </h2>
            <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <span data-v2-stockseg>${segBlock(stock)}</span>
            <span class="erp-filterbar erp-no-print">
              <label class="erp-text-sm erp-text-muted" for="v2wh-q">بحث</label>
              <input class="erp-input" id="v2wh-q" type="search" data-v2-q placeholder="اسم الصنف أو الباركود أو الفئة" autocomplete="off">
              <label class="erp-text-sm erp-text-muted" for="v2wh-cat">الفئة</label>
              <select class="erp-select" id="v2wh-cat" data-v2-cat>
                <option value="all">كل الفئات</option>
              </select>
            </span>
            <button type="button" class="erp-btn erp-btn--ghost erp-btn--sm erp-no-print" data-v2-clear aria-label="مسح الفلاتر" hidden>
              <i class="ji" data-i="x" aria-hidden="true"></i><span>مسح</span>
            </button>
            ${can.gov ? `<button type="button" class="erp-btn erp-btn--ghost erp-btn--sm erp-no-print" data-v2-gov aria-label="حوكمة المخزن — سنوات مالية ورصيد افتتاحي وفحص نظام">
              <i class="ji" data-i="calendar" aria-hidden="true"></i><span>حوكمة المخزن</span>
            </button>` : ''}
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-print aria-label="طباعة">
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
          </div>
        </div>

        <div data-v2-kpis></div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">تحت الحد
              <span class="erp-eyebrow" dir="ltr" lang="en">Below Minimum</span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted" data-v2-shortage-note></span>
          </div>
          <div class="erp-card__body">
            <div data-v2-shortage></div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">الأصناف حسب الفئة
              <span class="erp-eyebrow" dir="ltr" lang="en">By Category</span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted" data-v2-tops-note></span>
          </div>
          <div class="erp-card__body">
            <div data-v2-tops></div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">سجل الأصناف
              <span class="erp-eyebrow" dir="ltr" lang="en">Item Register</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-v2-warehouse__tools">
              ${can.audit ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-new="audit">
                <i class="ji" data-i="clipboard-list" aria-hidden="true"></i><span>جرد المخزون</span></button>` : ''}
              ${can.write ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-new="bulk">
                <i class="ji" data-i="upload" aria-hidden="true"></i><span>استيراد المخزون</span></button>` : ''}
              ${can.merge ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-new="merge">
                <i class="ji" data-i="copy" aria-hidden="true"></i><span>دمج أصناف مكررة</span></button>` : ''}
            </span>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted">
              السجل من وجه الخادم الحالي
              (<span class="erp-addr" dir="ltr">/api/warehouse/inventory/search</span>)،
              والصلاحية قررها الخادم وحده: الوارد والاستيراد والحذف للمخزن والمدير والإدارة،
              والتعديل المباشر والدمج للأدمن، والحذف النهائي مع الحركات للمخزن والإدارة.
              وجرد المخزون استوديو كامل من زر «جرد المخزون»: الجلسة والعدّ والاعتماد
              بتوقيع مقفل باسم الحساب — قراءته للمخزن والمدير والإدارة والمحاسبة،
              وكتاباته للثلاثة الأولى.
              الأرقام كما هي مخزّنة: الرصيد الرئيسي
              من ربط المخزن الرئيسي، وما لدى الأقسام هو الفرق، والإجمالي كما في
              السجل. تكلفة الأصناف وقيمتها ليستا معروضتين في السجل؛
              التكلفة تدخل فقط بما يكتبه المستخدم في نماذج الكتابة
              (سعر شراء «وارد سريع»، وتكلفة «التعديل المباشر»).
              وفي استوديو الجرد وحدها تظهر قيم فروقات الجرد بعملة النظام
              من إعداداتها.
              <span class="erp-text-muted">مربع «بحث» فوق الجدول يسأل الخادم عن الاسم أو
              الباركود أو الفئة ويتسامح مع الحروف المتشابهة؛ ومربع البحث داخل الجدول يضيق
              ما تم تحميله منه وحده.</span>
              <span data-v2-shelf-note hidden>تعذّر تحميل أسماء الرفوف — تُعرض أرقامها.</span>
            </p>
            <p class="erp-text-sm erp-text-muted" data-v2-filter-note hidden></p>
            <p class="erp-print-note" data-v2-print-note></p>
            <div data-v2-table></div>
            <div data-v2-panel hidden></div>
          </div>
        </section>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, userName?: string|null,
 *          notify?: (message:string, kind?:string)=>void,
 *          confirmFn?: (message:string)=>Promise<boolean>|boolean}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountWarehouseScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 warehouse]', m);
    const confirmFn = typeof ctx.confirmFn === 'function'
        ? ctx.confirmFn
        : (message) => Promise.resolve(window.confirm(message));
    const role = ctx.role ? String(ctx.role) : '';
    const signerName = normalizeSignerName(ctx.userName || '');
    const canWrite = invWriteVisible(role);
    const canDirect = invDirectVisible(role);
    const canMerge = invMergeVisible(role);
    const canForce = invForceVisible(role);
    const canAuditRead = auditReadVisible(role);
    const canAuditWrite = auditWriteVisible(role);
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : null;
    const canGov = !!navigate && hasGovernanceRead(role);

    let allRows = [];
    let registerTotal = 0;
    let truncated = false;
    let fuzzy = false;
    let loading = false;
    let queued = false;
    let shelfById = new Map();
    let searchTimer = null;
    let previewTimer = null;
    let busy = false;
    let panelSeq = 0;
    let panelKind = null;
    let panelData = null;
    let studio = null;

    host.insertAdjacentHTML('beforeend', template('all', { write: canWrite, merge: canMerge, audit: canAuditRead, gov: canGov }));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeLine = q('[data-v2-scope-line]');
    const kpisHost = q('[data-v2-kpis]');
    const shortageHost = q('[data-v2-shortage]');
    const shortageNote = q('[data-v2-shortage-note]');
    const topsHost = q('[data-v2-tops]');
    const topsNote = q('[data-v2-tops-note]');
    const countEl = q('[data-v2-count]');
    const filterNote = q('[data-v2-filter-note]');
    const printNote = q('[data-v2-print-note]');
    const shelfNote = q('[data-v2-shelf-note]');
    const clearBtn = q('[data-v2-clear]');
    const qInput = q('[data-v2-q]');
    const panelEl = q('[data-v2-panel]');

    const columns = [
        { key: 'name', header: 'الصنف', sortable: true, filterable: true, render: nameCell },
            {
                key: 'category', header: 'الفئة', sortable: true, filterable: true, width: '140px',
                render: (row) => (row.category ? esc(row.category)
                    : `<span class="erp-text-muted">بلا فئة</span>`),
            },
            {
                key: 'unit', header: 'الوحدة', sortable: true, width: '90px',
                render: (row) => (row.unit ? esc(row.unit) : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'mainQty', header: 'الرصيد الرئيسي', sortable: true, type: 'number', width: '140px',
                align: 'end',
                render: (row) => qtyCell(row.mainQty, row.unit, {
                    title: !row.mainFromJoin
                        ? 'لا رصيد مسجّل للمخزن الرئيسي في الربط — المعروض هو إجمالي السجل'
                        : (row.mainOverTotal
                            ? 'رصيد الرئيسي أكبر من الإجمالي المسجّل — الفرق يُعرض صفرًا عند الأقسام'
                            : 'رصيد المخزن الرئيسي كما هو في جدول الربط'),
                }),
            },
            {
                key: 'deptQty', header: 'لدى الأقسام', sortable: true, type: 'number', width: '130px',
                align: 'end',
                render: (row) => qtyCell(row.deptQty, row.unit, {
                    title: row.mainOverTotal
                        ? 'الإجمالي المسجّل أقل من رصيد الرئيسي — الفرق السالب يُعرض صفرًا'
                        : 'الفرق بين إجمالي السجل ورصيد المخزن الرئيسي',
                }),
            },
            {
                key: 'qty', header: 'الإجمالي المسجّل', sortable: true, type: 'number', width: '140px',
                align: 'end', render: (row) => qtyCell(row.qty, row.unit),
            },
            {
                key: 'minQty', header: 'الحد الأدنى', sortable: true, type: 'number', width: '120px',
                align: 'end',
                render: (row) => (row.minQty === null
                    ? `<span class="erp-text-muted" title="لا حد أدنى مسجّل">—</span>`
                    : qtyCell(row.minQty, row.unit)),
            },
            {
                key: 'weight', header: 'الوزن', sortable: true, type: 'number', width: '110px',
                align: 'end',
                render: (row) => (row.weight === null
                    ? `<span class="erp-text-muted" title="لا وزن مسجّل">—</span>`
                    : qtyCell(row.weight, '', { title: 'الوزن كما هو مخزّن في عمود weight — السجل لا يحمل وحدته' })),
            },
            {
                key: 'shelf', header: 'الرف', sortable: true, filterable: true, width: '110px',
                value: (row) => row.shelf, render: shelfCell,
            },
            {
                key: 'stateKey', header: 'الحالة', sortable: true, width: '150px',
                value: (row) => SEVERITY[row.stateKey] ?? 9,
                render: (row) => stateBadge(row.state),
            },
    ];

    /* عمود الإجراءات — كما في القديم: الوارد والحذف لحاملي الكتابة
       (warehouse.js:199)، والتعديل المباشر للأدمن وحده (:1445). */
    if (canWrite || canDirect) {
        columns.push({
            key: 'actions', header: 'إجراءات', width: '210px', className: 'erp-v2-warehouse-actions',
            render: (row) => (canWrite ? `
                    <button type="button" class="erp-btn erp-btn--sm" data-v2-act="receipt" data-id="${esc(String(row.id))}" title="وارد سريع لهذا الصنف"><i class="ji" data-i="package" aria-hidden="true"></i><span>وارد</span></button>` : '')
                + (canDirect ? `
                    <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-act="direct" data-id="${esc(String(row.id))}" title="تعديل مباشر للكمية والتكلفة (أدمن) — يُقيَّد الفرق في الدفتر"><i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span></button>` : '')
                + (canWrite ? `
                    <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-act="delete" data-id="${esc(String(row.id))}" title="حذف الصنف"><i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span></button>` : ''),
        });
    }

    const table = createDataTable({
        caption: 'سجل الأصناف — بيانات حية',
        mode: 'client',
        pageSize: 20,
        stickyHeader: true,
        emptyMessage: 'لا أصناف تطابق الفلاتر',
        emptyHint: 'وسّع الحالة أو امسح البحث؛ الخادم هو من قرر ماذا يعود.',
        rowKey: (row) => row.id,
        columns,
    });

    q('[data-v2-table]').appendChild(table.el);

    /* ── اللوحات: غلاف ومكوّنات مشتركة (نمط شاشة المرتجعات W1-5) ───────── */

    function panelShell(title, icon, bodyHtml) {
        return `<div class="erp-wh-panel">
          <div class="erp-wh-panel__head">
            <h3><i class="ji" data-i="${esc(icon)}" aria-hidden="true"></i> ${title}</h3>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close>
              <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
            </button>
          </div>
          <div class="erp-wh-panel__body erp-stack">${bodyHtml}</div>
        </div>`;
    }

    function panelActions(submitLabel, submitIcon) {
        return `
          <div data-v2-panel-msg role="alert" class="erp-text-sm"></div>
          <div class="erp-wh-panel__actions">
            <span class="erp-grow"></span>
            <button type="button" class="erp-btn" data-v2-panel-close>إلغاء</button>
            <button type="button" class="erp-btn erp-btn--primary" data-v2-submit>
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
        studio = null;
        disposeSignaturePads(SIG_ID);
        panelEl.innerHTML = '';
        panelEl.hidden = true;
    }

    const panelAlive = (seq) => el.isConnected && seq === panelSeq;

    function panelMsg(text) {
        const box = panelEl.querySelector('[data-v2-panel-msg]');
        if (box) {box.textContent = text || '';}
        if (text) {notify(text);}
    }

    /* ── الباب 1: وارد سريع (صف) — النصوص من :1311-1345 ─────────────────── */

    function receiptHtml(row) {
        return panelShell('وارد سريع', 'package',
            `<div class="erp-flow-note" data-tone="info">
               <strong>${esc(row.name)}</strong> — الكمية الحالية:
               <span class="erp-num" dir="ltr">${formatQty(row.qty)}</span> ${esc(row.unit || '')}
             </div>
             <label class="erp-field"><span class="erp-label">الكمية المضافة</span>
               <input class="erp-input" type="number" min="0.01" step="0.01" value="1" data-v2-receipt-qty></label>
             <label class="erp-field"><span class="erp-label">سعر الشراء</span>
               <input class="erp-input" type="number" min="0" step="0.01" data-v2-receipt-price placeholder="مطلوب"></label>
             <p class="erp-text-sm erp-text-muted">
               الوحدة المسجلة: <span class="erp-addr" dir="ltr">${esc(row.unit || '—')}</span> —
               الخادم يرفض أي وحدة أخرى. في القديم كان السعر يُملأ تلقائيًا بآخر تكلفة مسجّلة؛
               هذه الشاشة لا تعرض التكلفة عمدًا، فاكتب السعر صراحةً — الفراغ أو الصفر يفسد متوسط التكلفة.
             </p>
             ${panelActions('إضافة للمخزون', 'save')}`);
    }

    /* ── الباب 4: تعديل مباشر (أدمن) — النصوص من :1445-1464 ─────────────── */

    function directHtml(row) {
        return panelShell('تعديل مباشر (أدمن)', 'pencil',
            `<div class="erp-flow-note" data-tone="warning">
               «${esc(row.name)}» — الكمية الحالية:
               <span class="erp-num" dir="ltr">${formatQty(row.qty)}</span> ${esc(row.unit || '')}.
               الفرق يُقيَّد حركة تسوية في دفتر المخزون باسمك — لا يُسجَّل بلا سبب.
             </div>
             <label class="erp-field"><span class="erp-label">الكمية الجديدة</span>
               <input class="erp-input" type="number" min="0" step="0.01" data-v2-direct-qty></label>
             <label class="erp-field"><span class="erp-label">التكلفة الجديدة</span>
               <input class="erp-input" type="number" min="0" step="0.01" data-v2-direct-cost></label>
             <label class="erp-field"><span class="erp-label">سبب التعديل</span>
               <input class="erp-input" type="text" data-v2-direct-reason placeholder="يُوثَّق في الدفتر"></label>
             ${panelActions('تطبيق التعديل', 'save')}`);
    }

    /* ── الباب 2: استيراد دفعة (شبكة يدوية) — :2488-2567 ────────────────── */

    function bulkRowHtml() {
        return `
          <div class="erp-wh-row" data-v2-bulk-row>
            <input class="erp-input" type="text" data-v2-bf="name" placeholder="الصنف" aria-label="الصنف">
            <input class="erp-input" type="text" data-v2-bf="category" placeholder="الفئة (عام)" aria-label="الفئة">
            <input class="erp-input" type="text" data-v2-bf="unit" placeholder="الوحدة (قطعة)" aria-label="الوحدة">
            <input class="erp-input" type="number" min="0" step="0.01" data-v2-bf="qty" placeholder="الكمية" aria-label="الكمية">
            <input class="erp-input" type="number" min="0" step="0.01" data-v2-bf="price" placeholder="السعر" aria-label="السعر">
            <input class="erp-input" type="number" min="0" step="0.01" data-v2-bf="min" placeholder="الحد الأدنى (5)" aria-label="الحد الأدنى">
            <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-remove-row aria-label="حذف الصف"><i class="ji" data-i="x" aria-hidden="true"></i></button>
          </div>`;
    }

    function bulkHtml() {
        const windowNote = truncated
            ? `حكم «جديد/محدَّث» محسوب على ${formatInt(allRows.length)} صنفًا محمّلًا من ${formatInt(registerTotal)} في السجل — خارج النافذة قد يكون الاسم موجودًا فيُحدَّث لا يُنشأ.`
            : `حكم «جديد/محدَّث» محسوب على السجل المحمّل (${formatInt(allRows.length)} صنفًا).`;
        return panelShell('استيراد المخزون', 'upload',
            `<div class="erp-flow-note" data-tone="info">
               في V2 تُكتب الأصناف في هذه الشبكة يدويًا بدل ملف Excel: الفئة الفارغة «عام»،
               والوحدة الفارغة «قطعة»، والحد الأدنى الفارغ 5 — نفس افتراضات الخادم.
               الأسماء تُطابق بتطبيع الخادم، فالاسم المتشابه شكلًا يحدّث الصنف القائم بدل إنشاء مكرر.
             </div>
             <div class="erp-stack" data-v2-bulk-rows>
               ${bulkRowHtml()}${bulkRowHtml()}${bulkRowHtml()}
             </div>
             <div><button type="button" class="erp-btn erp-btn--sm" data-v2-add-bulk-row>
               <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة صف</span></button></div>
             <div class="erp-stack" data-v2-bulk-fail></div>
             <p class="erp-text-sm erp-text-muted">
               يُرسل كل ${formatInt(BULK_CHUNK)} صنفًا في دفعة (مهلة الطلب) — نفس تقسيم القديم.
               ${esc(windowNote)}
             </p>
             ${panelActions('استيراد المخزون', 'upload')}`);
    }

    /* ── الباب 5: دمج المكرر (أدمن) — النصوص من :2211-2250 ──────────────── */

    function mergeHtml() {
        const groups = duplicateGroups(allRows);
        const scopeNote = truncated
            ? `الفحص على ${formatInt(allRows.length)} صنفًا محمّلًا من ${formatInt(registerTotal)} في السجل — مجموعات قد تكون خارج نافذة الجلب.`
            : `الفحص على السجل المحمّل (${formatInt(allRows.length)} صنفًا).`;
        if (!groups.length) {
            return panelShell('دمج أصناف مكررة', 'copy',
                `<div data-v2-panel-msg role="alert" class="erp-text-sm"></div>
                 <div class="erp-state" role="status">
                   <span class="erp-state__title">ممتاز — لا توجد أصناف مكررة بالاسم نفسه حاليًا 👌</span>
                   <span>${esc(scopeNote)}</span>
                 </div>`);
        }
        const cards = groups.map((g, gi) => `
          <div class="erp-wh-group" data-v2-group="${esc(g.key)}">
            <div class="erp-text-sm"><i class="ji" data-i="copy" aria-hidden="true"></i>
              «${esc(g.items[0].name)}» — ${formatInt(g.items.length)} نسخ</div>
            ${g.items.map((i, idx) => `
              <label class="erp-wh-group__pick">
                <input type="radio" name="erp-v2-merge-keep-${gi}" value="${esc(String(i.id))}"${idx === g.keepIdx ? ' checked' : ''} data-v2-keep>
                <span class="erp-text-sm">${esc(i.name)} — رصيد ${formatQty(i.qty)} ${esc(i.unit || '')}${Number(i.minQty) > 0 ? ` · حد أدنى ${formatQty(i.minQty)}` : ''} <span class="erp-text-muted" dir="ltr">(id: ${esc(String(i.id))})</span></span>
              </label>`).join('')}
            <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-merge-group="${esc(g.key)}">
              <i class="ji" data-i="copy" aria-hidden="true"></i><span>دمج في الصنف المحدد</span>
            </button>
          </div>`).join('');
        return panelShell('دمج أصناف مكررة', 'copy',
            `<div data-v2-panel-msg role="alert" class="erp-text-sm"></div>
             <div class="erp-flow-note" data-tone="warning">
               اختر النسخة التي تبقى في كل مجموعة ثم اضغط دمج — يتم نقل الرصيد والسجل التاريخي للمُبقي
               وحذف المكرر نهائيًا. لا تراجع بعد الدمج.
             </div>
             ${cards}
             <p class="erp-text-sm erp-text-muted">${esc(scopeNote)}</p>`);
    }

    /* ── فتح اللوحة — بوابة واحدة ──────────────────────────────────────── */

    function openPanel(kind, data) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (kind === 'audit') {
            if (!canAuditRead) {notify('استوديو الجرد متاح للمخزن والمدير والإدارة والمحاسبة'); return;}
            openAuditStudio();
            return;
        }
        const gate = kind === 'direct' ? canDirect : (kind === 'merge' ? canMerge : canWrite);
        if (!gate) {
            notify(kind === 'merge' ? 'الدمج متاح للأدمن فقط'
                : (kind === 'direct' ? 'التعديل المباشر للأدمن فقط' : 'وارد المخزون للمخزن والمدير والإدارة فقط'));
            return;
        }
        panelSeq += 1;
        panelKind = kind;
        panelData = data || null;
        if (kind === 'receipt') {setPanel(receiptHtml(data)); return;}
        if (kind === 'bulk') {setPanel(bulkHtml()); return;}
        if (kind === 'direct') {setPanel(directHtml(data)); return;}
        if (kind === 'merge') {setPanel(mergeHtml());}
    }

    /* ── التنفيذ: الإرسال من البوابة، والأخطاء تصعد كما ترد ────────────── */

    function submitPanel() {
        if (panelKind === 'receipt') {submitReceipt();}
        else if (panelKind === 'bulk') {submitBulk();}
        else if (panelKind === 'direct') {submitDirect();}
    }

    async function submitReceipt() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const row = panelData;
        if (!row) {return;}
        const qty = parseFloat(panelEl.querySelector('[data-v2-receipt-qty]')?.value) || 0;
        if (qty <= 0) {notify('أدخل كمية صحيحة'); return;}
        const priceRaw = String(panelEl.querySelector('[data-v2-receipt-price]')?.value ?? '').trim();
        const price = Number(priceRaw);
        if (priceRaw === '' || !Number.isFinite(price) || price < 0) {
            notify('أدخل سعر الشراء — هنا لا يُملأ تلقائيًا بآخر تكلفة (السجل لا يحملها)، والفراغ يُرفض معلنًا');
            return;
        }
        busy = true;
        try {
            await receiveInventoryItem(row.id, receiptPayload(row, qty, price));
            closePanel();
            notify(`تم إضافة ${formatQty(qty)}${row.unit ? ' ' + row.unit : ''} إلى ${row.name}`);
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'فشل تحديث المخزون في قاعدة البيانات');
        } finally {
            busy = false;
        }
    }

    async function submitDirect() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const row = panelData;
        if (!row) {return;}
        const qtyRaw = panelEl.querySelector('[data-v2-direct-qty]')?.value ?? '';
        const costRaw = panelEl.querySelector('[data-v2-direct-cost]')?.value ?? '';
        const reasonRaw = panelEl.querySelector('[data-v2-direct-reason]')?.value ?? '';
        const err = directEditError(qtyRaw, costRaw, reasonRaw);
        if (err) {notify(err); return;}
        const qty = parseFloat(qtyRaw);
        const cost = parseFloat(costRaw);
        const ok = await confirmFn(`تعديل مباشر لـ "${row.name}":\nالكمية ${formatQty(row.qty)} → ${formatQty(qty)}\nالتكلفة الجديدة ${cost} (القديمة غير معروضة عمدًا — السجل لا يحملها)\n\nسيُقيَّد الفرق في دفتر المخزون باسمك.`);
        if (!ok) {return;}
        busy = true;
        try {
            const res = await directEditInventoryItem(row.id, directEditPayload(qtyRaw, costRaw, reasonRaw));
            closePanel();
            notify(`تم التعديل المباشر — الفرق ${formatQty(Math.abs(res.delta || 0))}${row.unit ? ' ' + row.unit : ''} قُيِّد في الدفتر`);
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'فشل التعديل المباشر');
        } finally {
            busy = false;
        }
    }

    async function submitBulk() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const readRow = (r) => ({
            name: r.querySelector('[data-v2-bf="name"]')?.value || '',
            category: r.querySelector('[data-v2-bf="category"]')?.value || '',
            unit: r.querySelector('[data-v2-bf="unit"]')?.value || '',
            qty: r.querySelector('[data-v2-bf="qty"]')?.value || '',
            price: r.querySelector('[data-v2-bf="price"]')?.value || '',
            minQty: r.querySelector('[data-v2-bf="min"]')?.value || '',
        });
        const items = bulkReceiptRows([...panelEl.querySelectorAll('[data-v2-bulk-row]')].map(readRow));
        if (!items.length) {notify('لا توجد صفوف صالحة للاستيراد'); return;}
        const existingNames = new Set(allRows.map((i) => String(i.name || '').toLowerCase()));
        const chunks = [];
        for (let i = 0; i < items.length; i += BULK_CHUNK) {chunks.push(items.slice(i, i + BULK_CHUNK));}
        const failBox = panelEl.querySelector('[data-v2-bulk-fail]');
        const failures = [];
        const importedNames = new Set();
        let added = 0;
        let updated = 0;
        busy = true;
        try {
            panelMsg(`جارٍ استيراد ${items.length} صنف في ${chunks.length} دفعة — لا تغلق اللوحة`);
            for (let ci = 0; ci < chunks.length; ci += 1) {
                panelMsg(`جارٍ الاستيراد: ${Math.min(ci * BULK_CHUNK, items.length)}/${items.length} صنف`);
                try {
                    await bulkReceiveInventory(chunks[ci]);
                    chunks[ci].forEach((item) => {
                        if (importedNames.has(item.name.toLowerCase())) {return;}   // مكرر داخل الشبكة — عُدّ مرة
                        importedNames.add(item.name.toLowerCase());
                        if (existingNames.has(item.name.toLowerCase())) {updated += 1;} else {added += 1;}
                    });
                } catch (err) {
                    failures.push({
                        chunk: ci + 1,
                        names: chunks[ci].map((x) => x.name).slice(0, 4).join('، '),
                        message: (err && err.message) || 'فشل غير معروف',
                    });
                }
            }
            if (failures.length) {
                if (failBox) {
                    failBox.innerHTML = `<div class="erp-flow-note" data-tone="danger">
                        <div>استُورد ${formatInt(added + updated)} صنف من ${formatInt(items.length)} — فشلت ${formatInt(failures.length)} دفعة:</div>
                        ${failures.map((f) => `<div>• الدفعة ${formatInt(f.chunk)} (${esc(f.names)}...): ${esc(f.message)}</div>`).join('')}
                        <div class="erp-text-sm">صحّح الصفوف (غالبًا تعارض وحدة مع صنف موجود) وأعد الإرسال — الأصناف الناجحة ستتحدث كمياتها، فاحذف صفوفها قبل الإعادة.</div>
                      </div>`;
                }
                notify(`اكتمل جزئيًا: ${formatInt(added + updated)} نجح، ${formatInt(failures.length)} دفعة فشلت — التفاصيل في اللوحة`);
                await reload();                        // الناجح يُرى في الجدول حتى مع فشل دفعة
                return;                                // اللوحة تبقى — التفاصيل معروضة
            }
            closePanel();
            notify(`تم الاستيراد: ${formatInt(added)} صنف جديد، ${formatInt(updated)} صنف محدَّث`);
            await reload();
        } finally {
            busy = false;
        }
    }

    /* ── الباب 5: مجموعة دمج واحدة — بتأكيد بشري كما :2239 ─────────────── */

    async function mergeGroup(key) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const seq = panelSeq;
        if (!panelAlive(seq)) {return;}
        const g = duplicateGroups(allRows).find((x) => x.key === key);
        if (!g) {return;}
        const card = [...panelEl.querySelectorAll('[data-v2-group]')]
            .find((c) => c.getAttribute('data-v2-group') === key);
        const keepEl = card ? card.querySelector('input[data-v2-keep]:checked') : null;
        const keepId = keepEl ? Number(keepEl.value) : null;
        if (!keepId) {notify('اختر النسخة التي تبقى'); return;}
        const dupIds = g.items.filter((i) => Number(i.id) !== keepId).map((i) => Number(i.id));
        if (!dupIds.length) {notify('اختر النسخة التي تبقى'); return;}
        const names = g.items.filter((i) => Number(i.id) !== keepId).map((i) => i.name).join('، ');
        const ok = await confirmFn(`تأكيد الدمج: سيُنقل رصيد ${dupIds.length} صنفًا مكررًا («${names}») إلى النسخة المبقية ويُحذف نهائيًا مع إعادة توجيه السجل التاريخي. متابعة؟`);
        if (!ok) {return;}
        busy = true;
        try {
            const res = await mergeInventoryItems(keepId, dupIds);
            notify(`تم الدمج: ${res.mergedCount} مكرر حُذف ونُقل رصيده (${formatQty(res.movedQty)})`);
            await reload();
            if (panelAlive(seq) && panelKind === 'merge') {setPanel(mergeHtml());}
        } catch (e) {
            panelMsg((e && e.message) || 'فشل الدمج');
        } finally {
            busy = false;
        }
    }

    /* ── الباب 3: حذف عادي ← retry نهائي عند الحركات — :1489-1509 ──────── */

    async function deleteRow(row) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        busy = true;
        try {
            const ok = await confirmFn(`حذف الصنف "${row.name}"؟`);
            if (!ok) {return;}
            try {
                await deleteInventoryItem(row.id);
                notify('تم الحذف');
            } catch (e) {
                if (hasMovementsError(e)) {
                    if (!canForce) {notify((e && e.message) || 'لا يمكن حذف هذا الصنف: مرتبط بحركات مخزون أو وصفات أو فواتير — احتفظ به للحفاظ على سلامة الدفاتر'); return;}
                    const forceOk = await confirmFn(`"${row.name}" له حركات مخزون.\nهل تريد الحذف النهائي مع كل حركاته وسجلاته؟ (لا يمكن التراجع)`);
                    if (!forceOk) {return;}
                    await forceDeleteInventoryItem(row.id);
                    notify('تم الحذف النهائي مع الحركات');
                } else {
                    const m = String((e && e.message) || '');
                    notify(/foreign key|23503/.test(m)
                        ? 'لا يمكن حذف هذا الصنف: مرتبط بحركات مخزون أو وصفات أو فواتير — احتفظ به للحفاظ على سلامة الدفاتر'
                        : (m || 'فشل الحذف من قاعدة البيانات'));
                    return;
                }
            }
            await reload();
        } finally {
            busy = false;
        }
    }

    /* ── الباب 6: استوديو الجرد (جلسة/عدّ/سجل + توقيع) — :827-1277 ──────── */

    function auditStatusBadge(status) {return stateBadge(auditState(status));}

    function moneyText(v) {
        const m = formatMoney(v, studio ? studio.currency : '');
        return m.hasUnit ? `${m.amount} ${m.unit}` : m.amount;
    }

    function newStudio(locations, audits, currency) {
        return {
            tab: 'new',
            locations,
            audits,
            currency,
            locationId: Number(locations.find((l) => l.code === 'MAIN-WAREHOUSE')?.id || locations[0]?.id || 0),
            scopeMode: 'all', scopeCategory: '', scopeSearch: '',
            periodType: 'monthly', countedAt: isoDay(0), periodStart: isoDay(0), periodEnd: isoDay(0),
            notes: '',
            detail: null,
            search: '', diffOnly: false,
            draftVals: {}, draftNotes: {},
            previewText: '', previewSeq: 0,
        };
    }

    async function openAuditStudio() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (!canAuditRead) {notify('استوديو الجرد متاح للمخزن والمدير والإدارة والمحاسبة'); return;}
        panelSeq += 1;
        panelKind = 'audit';
        panelData = null;
        studio = null;
        const seq = panelSeq;
        setPanel(panelShell('استوديو جرد المخزون', 'clipboard-list',
            `<div class="erp-state" role="status"><span class="erp-state__title">جارٍ تجهيز الاستوديو…</span></div>`));
        try {
            const [locations, audits, currency] = await Promise.all([
                fetchAuditLocations(),
                fetchAudits(),
                fetchCurrency().catch(() => ''),
            ]);
            if (!panelAlive(seq)) {return;}
            studio = newStudio(locations, audits, String(currency || ''));
            renderStudio();
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            setPanel(panelShell('استوديو جرد المخزون', 'clipboard-list',
                `<div class="erp-flow-note" data-tone="danger">تعذر تحميل الاستوديو: ${esc((e && e.message) || 'خطأ في القراءة')}</div>
                 <div class="erp-wh-panel__actions">
                   <span class="erp-grow"></span>
                   <button type="button" class="erp-btn erp-btn--primary" data-v2-audit-open>
                     <i class="ji" data-i="refresh" aria-hidden="true"></i><span>إعادة المحاولة</span></button>
                 </div>`));
        }
    }

    function renderStudio() {
        setPanel(studioHtml());
        if (panelEl.querySelector(`#${SIG_ID}`)) {
            initSignaturePad(panelEl, SIG_ID, signerName);
        }
        if (studio.tab === 'new') {auditPreview();}
    }

    function studioTabs() {
        const t = studio.tab;
        const tab = (key, icon, label) => `<button type="button" class="erp-btn erp-btn--sm${t === key ? ' is-active' : ''}" data-v2-stab="${key}" aria-pressed="${t === key ? 'true' : 'false'}"><i class="ji" data-i="${icon}" aria-hidden="true"></i><span>${label}</span></button>`;
        return tab('new', 'plus', 'جلسة جديدة')
            + tab('count', 'clipboard-list', 'العد والفروقات')
            + tab('history', 'history', 'سجل الجرد');
    }

    function studioHtml() {
        const body = studio.tab === 'history' ? auditHistoryHtml()
            : (studio.tab === 'count' ? auditCountHtml() : auditNewHtml());
        return `<div class="erp-wh-panel">
          <div class="erp-wh-panel__head">
            <h3><i class="ji" data-i="clipboard-list" aria-hidden="true"></i> استوديو جرد المخزون</h3>
            <div class="erp-wh-panel__actions">
              ${studioTabs()}
              <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close>
                <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
              </button>
            </div>
          </div>
          <div class="erp-wh-panel__body erp-stack">${body}</div>
        </div>`;
    }

    /* ── تبويب «جلسة جديدة» — النصوص من :933-970 ──────────────────────── */

    function auditNewHtml() {
        const locChips = studio.locations.map((l) => {
            const on = Number(l.id) === Number(studio.locationId);
            const sub = `${l.dept_name ? esc(l.dept_name) + ' · ' : ''}${formatInt(l.items_count)} صنف · ${esc(moneyText(l.on_hand_value))}`;
            return `<button type="button" class="erp-wh-loc${on ? ' is-active' : ''}" data-v2-sloc="${esc(String(l.id))}" aria-pressed="${on ? 'true' : 'false'}">
              <i class="ji" data-i="package" aria-hidden="true"></i>
              <strong>${esc(l.name_ar)}</strong>
              <span>${sub}</span>
            </button>`;
        }).join('');
        const open = studio.audits.filter((a) => ['draft', 'submitted'].includes(String(a.status)));
        const openStrip = open.length ? `<div class="erp-flow-note" data-tone="warning">
            <i class="ji" data-i="alert-triangle" aria-hidden="true"></i> لديك جلسات جرد مفتوحة:
            ${open.slice(0, 3).map((a) => `<button type="button" class="erp-btn erp-btn--sm" data-v2-sopen="${esc(String(a.id))}">${esc(a.audit_number)} — متابعة العد</button>`).join('')}
          </div>` : '';
        const scopeCards = [['all', 'package', 'كل أصناف المخزن', 'جرد شامل للمخزن المختار'],
            ['in_stock', 'archive', 'ذات رصيد فقط', 'تجاهل أصناف الصفر في هذا المخزن'],
            ['category', 'folder', 'فئة محددة', 'جرد جزئي سريع'],
            ['search', 'search', 'بحث بالاسم/الباركود', 'أصناف مختارة']]
            .map(([mode, icon, title, hint]) => {
                const on = studio.scopeMode === mode;
                return `<button type="button" class="erp-wh-scope${on ? ' is-active' : ''}" data-v2-sscope="${mode}" aria-pressed="${on ? 'true' : 'false'}">
                  <i class="ji" data-i="${icon}" aria-hidden="true"></i><strong>${title}</strong><span>${hint}</span>
                </button>`;
            }).join('');
        const cats = [...new Set(allRows.map((r) => r.category).filter(Boolean))]
            .sort((a, b) => String(a).localeCompare(String(b), 'ar'));
        const catField = studio.scopeMode === 'category' ? `
          <label class="erp-field"><span class="erp-label">الفئة</span>
            <select class="erp-select" data-v2-scat>
              <option value="">— اختر الفئة —</option>
              ${cats.map((c) => `<option value="${esc(c)}"${c === studio.scopeCategory ? ' selected' : ''}>${esc(c)}</option>`).join('')}
            </select></label>
          <p class="erp-text-sm erp-text-muted">الفئات من النافذة المحمّلة من السجل (${formatInt(allRows.length)} صنفًا${truncated ? ` من ${formatInt(registerTotal)} — خارجها فئات لا تُعرض هنا` : ''}).
          النطاق نفسه يُقرَّر على الخادم عند بدء الجلسة.</p>` : '';
        const searchField = studio.scopeMode === 'search' ? `
          <label class="erp-field"><span class="erp-label">بحث</span>
            <input class="erp-input" type="text" data-v2-ssearch value="${esc(studio.scopeSearch)}" placeholder="اسم الصنف أو الباركود"></label>` : '';
        const periodOpts = AUDIT_PERIOD_TYPES
            .map((v) => `<option value="${v}"${studio.periodType === v ? ' selected' : ''}>${esc(PERIOD_LABEL[v] || v)}</option>`).join('');
        const currencyNote = studio.currency ? ''
            : `<p class="erp-text-sm erp-text-muted">لا وحدة عملة مضبوطة في إعدادات النظام — القيم المالية تُعرض بلا رمز.</p>`;
        const footer = canAuditWrite
            ? `<div data-v2-panel-msg role="alert" class="erp-text-sm"></div>
               <div class="erp-wh-panel__actions">
                 <span class="erp-grow"></span>
                 <button type="button" class="erp-btn erp-btn--primary" data-v2-start-audit>
                   <i class="ji" data-i="play" aria-hidden="true"></i><span>بدء جلسة الجرد</span>
                 </button>
               </div>`
            : `<p class="erp-text-sm erp-text-muted">دورك يسمح بالمشاهدة فقط — بدء الجلسات والعدّ والاعتماد للمخزن والمدير والإدارة.</p>`;
        return `${openStrip}
          <div class="erp-flow-note" data-tone="info">
            <strong>دورة جرد آمنة بثلاث خطوات — لكل مخزن على حدة</strong>
            <div class="erp-text-sm">١) اختر المخزن وحدّد نطاق الجرد وابدأ الجلسة — ٢) عدّ الأصناف فعلياً (كل عدّ يُحفظ بضغط زر الحفظ في صفه وتظهر الفروق فوراً مقارنةً برصيد هذا المخزن) — ٣) اعتمد الفروقات فيُطبَّق على رصيد المخزن بحركات تصحيح موثّقة، وعجز المخزن يُسجَّل كلفة على القسم صاحبه. لا يتأثر أي رصيد قبل الاعتماد.</div>
          </div>
          <h4 class="erp-card__title"><i class="ji" data-i="package" aria-hidden="true"></i> اختر مخزن الجرد</h4>
          <div class="erp-wh-loc-grid">${locChips || '<span class="erp-text-muted">لا توجد مخازن مفعّلة</span>'}</div>
          <div class="erp-wh-scope-grid">${scopeCards}</div>
          ${catField}${searchField}
          <p class="erp-wh-preview" data-v2-spreview role="status" aria-live="polite">${esc(studio.previewText)}</p>
          <div class="erp-wh-period">
            <label class="erp-field"><span class="erp-label">نوع الفترة</span>
              <select class="erp-select" data-v2-speriod>${periodOpts}</select></label>
            <label class="erp-field"><span class="erp-label">تاريخ العد</span>
              <input class="erp-input erp-input--ltr" type="date" data-v2-sdate value="${esc(studio.countedAt)}"></label>
            <label class="erp-field"><span class="erp-label">بداية الفترة</span>
              <input class="erp-input erp-input--ltr" type="date" data-v2-sstart value="${esc(studio.periodStart)}"></label>
            <label class="erp-field"><span class="erp-label">نهاية الفترة</span>
              <input class="erp-input erp-input--ltr" type="date" data-v2-send value="${esc(studio.periodEnd)}"></label>
          </div>
          <label class="erp-field"><span class="erp-label">ملاحظات الجلسة</span>
            <input class="erp-input" type="text" data-v2-snotes value="${esc(studio.notes)}" placeholder="مثال: جرد نهاية الشهر — فرع الرئيسي"></label>
          ${currencyNote}
          ${footer}`;
    }

    async function auditPreview() {
        if (!studio || panelKind !== 'audit') {return;}
        const box = panelEl.querySelector('[data-v2-spreview]');
        if (!box) {return;}
        if (!studio.locationId) {studio.previewText = ''; box.textContent = ''; return;}
        const seq = panelSeq;
        studio.previewSeq += 1;
        const mine = studio.previewSeq;
        box.textContent = '…جارٍ حساب النطاق على الخادم';
        try {
            const p = await fetchAuditPreview(studio.locationId, studio.scopeMode, studio.scopeCategory, studio.scopeSearch);
            if (!panelAlive(seq) || !studio || studio.previewSeq !== mine) {return;}
            studio.previewText = scopePreviewText(p, studio.currency) || 'تعذرت المعاينة الحية — سيحدد النطاق على الخادم عند بدء الجلسة';
        } catch (_) {
            if (!panelAlive(seq) || !studio || studio.previewSeq !== mine) {return;}
            studio.previewText = 'تعذرت المعاينة الحية — سيحدد النطاق على الخادم عند بدء الجلسة';
        }
        box.textContent = studio.previewText;
    }

    async function startAudit() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (!studio) {return;}
        if (!canAuditWrite) {notify('بدء الجلسات للمخزن والمدير والإدارة فقط'); return;}
        if (!studio.locationId) {notify('اختر مخزن الجرد أولاً'); return;}
        const err = auditPeriodError(studio.periodStart, studio.periodEnd);
        if (err) {panelMsg(err); return;}
        const seq = panelSeq;
        busy = true;
        try {
            const res = await startAuditSession(startAuditPayload({
                countedAt: studio.countedAt,
                periodType: studio.periodType,
                periodStart: studio.periodStart,
                periodEnd: studio.periodEnd,
                notes: studio.notes,
                locationId: studio.locationId,
                scopeMode: studio.scopeMode,
                scopeCategory: studio.scopeCategory,
                scopeSearch: studio.scopeSearch,
            }));
            if (!panelAlive(seq) || !studio) {return;}
            notify(`بدأت جلسة الجرد ${res.audit.audit_number} على ${res.location?.name || 'المخزن'} — ${formatInt(res.itemCount)} صنف`);
            await openAuditSession(res.audit.id);
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            panelMsg((e && e.message) || 'تعذر بدء جلسة الجرد');
        } finally {
            busy = false;
        }
    }

    async function openAuditSession(id) {
        if (!studio) {return;}
        const seq = panelSeq;
        try {
            const detail = await fetchAuditDetail(id);
            if (!panelAlive(seq) || !studio) {return;}
            studio.detail = detail;
            studio.tab = 'count';
            studio.search = '';
            studio.diffOnly = false;
            studio.draftVals = {};
            studio.draftNotes = {};
            renderStudio();
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            panelMsg((e && e.message) || 'تعذر فتح جلسة الجرد');
        }
    }

    async function refreshAuditDetail(seq = panelSeq) {
        if (!studio || !studio.detail) {return;}
        try {
            const detail = await fetchAuditDetail(studio.detail.audit.id);
            if (!panelAlive(seq) || !studio) {return;}
            studio.detail = detail;
            studio.draftVals = {};
            studio.draftNotes = {};
            renderStudio();
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            panelMsg((e && e.message) || 'تعذر تحديث الجلسة');
        }
    }

    async function showStudioTab(tab) {
        if (!studio || tab === studio.tab) {return;}
        studio.tab = tab;
        renderStudio();
        if (tab !== 'history') {return;}
        const seq = panelSeq;
        try {
            const audits = await fetchAudits();
            if (!panelAlive(seq) || !studio || studio.tab !== 'history') {return;}
            studio.audits = audits;
            renderStudio();
        } catch (_) { /* المعروض من آخر قراءة يبقى — التحديث ليس شرطًا للعرض */ }
    }

    /* ── تبويب «العد والفروقات» — النصوص من :1062-1103 ─────────────────── */

    function countFilteredItems() {
        const items = (studio.detail && studio.detail.items) || [];
        const q = studio.search.trim();
        let out = items;
        if (q) {
            out = out.filter((i) => String(i.item_name || '').includes(q)
                || String(i.barcode || '').includes(q)
                || String(i.category || '').includes(q));
        }
        if (studio.diffOnly) {
            out = out.filter((i) => (i.counted_at != null || i.is_counted === true) && Number(i.variance_qty) !== 0);
        }
        return out;
    }

    function countItemRow(item) {
        const row = auditItemToRow(item);
        const editable = String(studio.detail.audit.status) === 'draft' && canAuditWrite;
        const key = String(item.item_id);
        const draft = studio.draftVals[key];
        const draftNote = studio.draftNotes[key];
        const val = draft !== undefined ? draft : (row.isCounted ? String(row.countedQty) : '');
        const noteVal = draftNote !== undefined ? draftNote : row.notes;
        const diffText = row.isCounted
            ? (row.varianceQty === 0 ? 'مطابق' : (row.varianceQty > 0 ? '+' : '') + formatQty(row.varianceQty))
            : 'لم يُعدّ';
        const dir = row.isCounted && row.varianceQty !== 0 ? (row.varianceQty < 0 ? 'neg' : 'pos') : 'flat';
        return `<tr class="erp-wh-audit-row" data-v2-crow="${esc(key)}">
            <td><strong>${esc(row.name)}</strong><span class="erp-mini__sub">${esc(item.category || '—')} · ${esc(item.unit || 'وحدة')}${item.barcode ? ` · <span class="erp-addr" dir="ltr">${esc(item.barcode)}</span>` : ''}</span></td>
            <td class="erp-num" dir="ltr">${formatQty(row.systemQty)}</td>
            <td><input class="erp-input" type="number" min="0" step="0.001" inputmode="decimal" data-v2-cq="${esc(key)}" value="${esc(val)}" placeholder="${esc(String(row.systemQty))}" aria-label="العدّ الفعلي — ${esc(row.name)}"${editable ? '' : ' disabled'}></td>
            <td class="erp-wh-audit-var" data-dir="${dir}">${diffText}</td>
            <td class="erp-num" dir="ltr">${row.isCounted ? esc(moneyText(row.varianceValue)) : '—'}</td>
            <td><input class="erp-input" type="text" data-v2-cn="${esc(key)}" value="${esc(noteVal)}" placeholder="ملاحظة" aria-label="ملاحظة — ${esc(row.name)}"${editable ? '' : ' disabled'}></td>
            <td>${editable && row.isCounted ? `
              <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-aclear="${esc(key)}" title="مسح العد وإرجاعه إلى غير معدود" aria-label="مسح عد ${esc(row.name)}"><i class="ji" data-i="x" aria-hidden="true"></i></button>` : ''}${editable ? `
              <button type="button" class="erp-btn erp-btn--sm" data-v2-asave="${esc(key)}" title="حفظ عدّ هذا الصنف" aria-label="حفظ عدّ ${esc(row.name)}"><i class="ji" data-i="save" aria-hidden="true"></i></button>` : ''}</td>
          </tr>`;
    }

    function countRowsHtml() {
        const items = countFilteredItems();
        if (!items.length) {
            return `<tr><td colspan="7" class="erp-text-muted">لا توجد أصناف مطابقة للبحث في هذه الجلسة</td></tr>`;
        }
        return items.map(countItemRow).join('');
    }

    function countHeadHtml() {
        const audit = studio.detail.audit;
        const progress = studio.detail.progress || {};
        const s = auditSummaryOf(studio.detail.items.map(auditItemToRow));
        const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
        const locChip = studio.detail.location_name
            ? ` · <span class="erp-badge" data-tone="info"><span class="erp-badge-label">${esc(studio.detail.location_name)}</span></span>` : '';
        return `<div class="erp-wh-panel__head">
              <div>
                <strong class="erp-addr" dir="ltr">${esc(audit.audit_number || '')}</strong>
                <div class="erp-text-sm erp-text-muted">أنشأها ${esc(audit.created_by || '—')} — ${esc(String(audit.counted_at || '').slice(0, 10))}${locChip}</div>
              </div>
              <span class="erp-grow"></span>
              ${auditStatusBadge(audit.status)}
            </div>
            <div class="erp-wh-progress" role="progressbar" aria-valuenow="${esc(String(percent))}" aria-valuemin="0" aria-valuemax="100" aria-label="تقدّم العد">
              <span style="inline-size:${percent}%"></span>
            </div>
            <div class="erp-wh-chips">
              <span class="erp-badge" data-tone="info"><i class="ji" data-i="clipboard-list" aria-hidden="true"></i><span class="erp-badge-label">معدود ${formatInt(progress.counted)} / ${formatInt(progress.total)}</span></span>
              <span class="erp-badge" data-tone="${s.itemsWithVariance ? 'warning' : 'success'}"><i class="ji" data-i="layers" aria-hidden="true"></i><span class="erp-badge-label">أصناف بفروقات ${formatInt(s.itemsWithVariance)}</span></span>
              <span class="erp-badge" data-tone="danger"><i class="ji" data-i="undo" aria-hidden="true"></i><span class="erp-badge-label">نقص ${formatInt(s.shortageItems)}</span></span>
              <span class="erp-badge" data-tone="success"><i class="ji" data-i="refresh" aria-hidden="true"></i><span class="erp-badge-label">زيادة ${formatInt(s.surplusItems)}</span></span>
              <span class="erp-badge" data-tone="${s.projectedVarianceValue < 0 ? 'danger' : 'success'}"><i class="ji" data-i="coins" aria-hidden="true"></i><span class="erp-badge-label">صافي الفروقات ${esc(moneyText(s.projectedVarianceValue))}</span></span>
              ${s.staleItems ? `<span class="erp-badge" data-tone="warning" title="تغير رصيد هذه الأصناف بعد بدء الجلسة"><i class="ji" data-i="alert-triangle" aria-hidden="true"></i><span class="erp-badge-label">انحراف رصيد ${formatInt(s.staleItems)}</span></span>` : ''}
            </div>
            ${auditStatusStrip(audit)}${auditStaleBanner()}`;
    }

    function auditStatusStrip(audit) {
        const status = String(audit.status || '');
        if (status === 'submitted') {
            return `<div class="erp-flow-note" data-tone="info"><i class="ji" data-i="lock" aria-hidden="true"></i> الجلسة أُرسلت للاعتماد — العد مقفل. يمكن للمدير اعتماد الفروقات أو إلغاء الجلسة.</div>`;
        }
        if (status === 'approved') {
            return `<div class="erp-flow-note" data-tone="success"><i class="ji" data-i="circle-check" aria-hidden="true"></i> اعتُمدت الجلسة وطُبّقت الفروقات على الأرصدة بتاريخ ${esc(String(audit.approved_at || '').slice(0, 16).replace('T', ' '))}.</div>`;
        }
        if (status === 'cancelled') {
            return `<div class="erp-flow-note" data-tone="danger"><i class="ji" data-i="circle-x" aria-hidden="true"></i> أُلغيت الجلسة (${esc(audit.cancel_reason || 'بدون سبب')}) — لا أثر على الأرصدة.</div>`;
        }
        return '';
    }

    function auditStaleBanner() {
        const stale = (studio.detail.items || []).filter((i) => i.is_stale);
        if (!stale.length) {return '';}
        return `<div class="erp-flow-note" data-tone="warning"><i class="ji" data-i="alert-triangle" aria-hidden="true"></i> <strong>تنبيه انحراف الرصيد:</strong> تغير رصيد ${formatInt(stale.length)} صنف في النظام بعد بدء الجلسة (مثال: ${esc(stale.slice(0, 2).map((i) => i.item_name).join('، '))}). سيمنع النظام الاعتماد حتى تبدأ جلسة جديدة تلتقط الأرصدة الحالية.</div>`;
    }

    function auditCountHtml() {
        if (!studio.detail) {
            const open = studio.audits.filter((a) => ['draft', 'submitted'].includes(String(a.status)));
            return `<div class="erp-state" role="status">
              <span class="erp-state__title">لا توجد جلسة جرد مفتوحة الآن.</span>
              <span>ابدأ جلسة جديدة من تبويب «جلسة جديدة»، أو تابع إحدى الجلسات المفتوحة:</span>
            </div>
            <div class="erp-wh-panel__actions">
              ${open.length ? open.slice(0, 5).map((a) => `<button type="button" class="erp-btn erp-btn--sm" data-v2-sopen="${esc(String(a.id))}">${esc(a.audit_number)} (${formatInt(a.item_count)} صنف)</button>`).join('') : '<span class="erp-text-muted">لا توجد جلسات مفتوحة</span>'}
            </div>`;
        }
        const audit = studio.detail.audit;
        const status = String(audit.status || '');
        const currencyNote = studio.currency ? ''
            : ' لا وحدة عملة مضبوطة في الإعدادات — القيم المالية تُعرض بلا رمز.';
        let footer = '';
        if (canAuditWrite && ['draft', 'submitted'].includes(status)) {
            footer = `
              ${signaturePadMarkup(SIG_ID, 'توقيع مسؤول الجرد / المعتمد', signerName)}
              <div data-v2-panel-msg role="alert" class="erp-text-sm"></div>
              <label class="erp-field"><span class="erp-label">سبب الإلغاء</span>
                <input class="erp-input" type="text" data-v2-cancel-reason placeholder="مطلوب عند إلغاء الجلسة (3 أحرف على الأقل)"></label>
              <div class="erp-wh-panel__actions">
                <button type="button" class="erp-btn erp-btn--danger" data-v2-cancel-audit>
                  <i class="ji" data-i="circle-x" aria-hidden="true"></i><span>إلغاء الجلسة</span></button>
                <span class="erp-grow"></span>
                ${status === 'draft' ? `<button type="button" class="erp-btn" data-v2-submit-audit>
                  <i class="ji" data-i="send" aria-hidden="true"></i><span>إرسال للاعتماد</span></button>` : ''}
                <button type="button" class="erp-btn erp-btn--primary" data-v2-approve-audit>
                  <i class="ji" data-i="circle-check" aria-hidden="true"></i><span>${status === 'draft' ? 'اعتماد فوري وتطبيق الفروقات' : 'اعتماد وتطبيق الفروقات'}</span></button>
              </div>`;
        } else if (['draft', 'submitted'].includes(status)) {
            footer = `<p class="erp-text-sm erp-text-muted">دورك يسمح بالمشاهدة والعد فقط — الاعتماد يتطلب مديراً.</p>`;
        }
        return `<div data-v2-chead class="erp-stack">${countHeadHtml()}</div>
          <div class="erp-wh-toolbar">
            <label class="erp-field"><span class="erp-label">بحث</span>
              <input class="erp-input" type="text" data-v2-csearch value="${esc(studio.search)}" placeholder="بحث بالاسم أو الباركود أو الفئة…"></label>
            <label class="erp-check"><input type="checkbox" data-v2-cdiffs${studio.diffOnly ? ' checked' : ''}> الفروقات فقط</label>
            <span class="erp-grow"></span>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-crefresh>
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span></button>
          </div>
          <div class="erp-wh-audit-scroll">
            <table class="erp-wh-audit-table">
              <thead><tr><th>الصنف</th><th>رصيد النظام</th><th>العدّ الفعلي</th><th>الفرق</th><th>قيمة الفرق</th><th>ملاحظة</th><th></th></tr></thead>
              <tbody data-v2-ctbody>${countRowsHtml()}</tbody>
            </table>
          </div>
          <p class="erp-text-sm erp-text-muted">يُحفظ كل عدّ بضغط زر الحفظ في صفه — لا حفظ تلقائي. البحث و«الفروقات فقط» يحكمان العرض لا الحفظ.${esc(currencyNote)}</p>
          ${footer}`;
    }

    function renderCountBody() {
        const head = panelEl.querySelector('[data-v2-chead]');
        if (head) {head.innerHTML = countHeadHtml();}
        const tb = panelEl.querySelector('[data-v2-ctbody]');
        if (tb) {tb.innerHTML = countRowsHtml();}
    }

    function applyProgress(counted) {
        const progress = studio.detail.progress;
        if (!progress) {return;}
        const n = Number(counted) || 0;
        progress.counted = n;
        progress.remaining = Math.max(0, Number(progress.total || 0) - n);
        progress.percent = Number(progress.total) ? Math.round((n / Number(progress.total)) * 100) : 0;
    }

    async function saveCount(itemId) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (!studio || !studio.detail) {return;}
        if (!canAuditWrite) {notify('العدّ للمخزن والمدير والإدارة فقط'); return;}
        const audit = studio.detail.audit;
        if (String(audit.status) !== 'draft') {notify('العد متاح في الجلسات المسودة فقط'); return;}
        const seq = panelSeq;
        const key = String(itemId);
        const row = [...panelEl.querySelectorAll('[data-v2-crow]')]
            .find((r) => r.getAttribute('data-v2-crow') === key);
        const qtyRaw = row && row.querySelector('[data-v2-cq]') ? String(row.querySelector('[data-v2-cq]').value).trim() : '';
        if (qtyRaw === '') {notify('أدخل الكمية المعدودة أولاً — أو امسح العد بزر ×'); return;}
        const value = Number(qtyRaw);
        if (!Number.isFinite(value) || value < 0) {notify('الكمية المعدودة غير صالحة'); return;}
        const note = row && row.querySelector('[data-v2-cn]') ? String(row.querySelector('[data-v2-cn]').value || '') : '';
        const item = studio.detail.items.find((i) => Number(i.item_id) === Number(itemId));
        busy = true;
        try {
            const res = await saveAuditCount(audit.id, itemId, value, note);
            if (!panelAlive(seq) || !studio) {return;}
            const local = studio.detail.items.find((i) => Number(i.item_id) === Number(itemId));
            if (local && res && res.item) {
                local.counted_qty = Number(res.item.counted_qty);
                local.variance_qty = Number(res.item.variance_qty);
                local.variance_value = Number(res.item.variance_value);
                local.notes = res.item.notes || null;
                local.counted_at = res.item.counted_at != null ? res.item.counted_at : new Date().toISOString();
            }
            delete studio.draftVals[key];
            delete studio.draftNotes[key];
            if (res && res.counted_items != null) {applyProgress(res.counted_items);}
            renderCountBody();
            notify(`حُفظ عدّ «${(item && item.item_name) || '؟'}»`);
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            notify((e && e.message) || 'تعذر حفظ العد');
        } finally {
            busy = false;
        }
    }

    async function clearCount(itemId) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (!studio || !studio.detail) {return;}
        if (!canAuditWrite || String(studio.detail.audit.status) !== 'draft') {return;}
        const seq = panelSeq;
        const key = String(itemId);
        busy = true;
        try {
            const res = await clearAuditCount(studio.detail.audit.id, itemId);
            if (!panelAlive(seq) || !studio) {return;}
            const local = studio.detail.items.find((i) => Number(i.item_id) === Number(itemId));
            if (local) {
                local.counted_qty = local.system_qty;
                local.variance_qty = 0;
                local.variance_value = 0;
                local.counted_at = null;
                local.notes = null;
            }
            delete studio.draftVals[key];
            delete studio.draftNotes[key];
            if (res && res.counted_items != null) {applyProgress(res.counted_items);}
            renderCountBody();
            notify('مُسح العد — الصنف عاد إلى «غير معدود»');
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            notify((e && e.message) || 'تعذر مسح العد');
        } finally {
            busy = false;
        }
    }

    function readAuditSig() {
        const res = readSignaturePad(panelEl, SIG_ID, signerName);
        if (res.error) {panelMsg(signatureErrorText(res.error)); return null;}
        return res.dataUrl;
    }

    async function submitAudit() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (!studio || !studio.detail || !canAuditWrite) {return;}
        const audit = studio.detail.audit;
        if (String(audit.status) !== 'draft') {return;}
        const seq = panelSeq;
        const sig = readAuditSig();
        if (!sig) {return;}
        const ok = await confirmFn('سيتم إرسال الجلسة للاعتماد وتثبيت العد والتوقيع. متابعة؟');
        if (!ok) {return;}
        busy = true;
        try {
            await submitAuditSession(audit.id, sig, signerName);
            notify('أُرسلت الجلسة للاعتماد — العد مقفل الآن');
            await refreshAuditDetail(seq);
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            panelMsg((e && e.message) || 'تعذر إرسال الجلسة');
        } finally {
            busy = false;
        }
    }

    async function approveAudit() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (!studio || !studio.detail || !canAuditWrite) {return;}
        const audit = studio.detail.audit;
        const status = String(audit.status || '');
        if (!['draft', 'submitted'].includes(status)) {return;}
        const seq = panelSeq;
        const sig = readAuditSig();
        if (!sig) {return;}
        const summary = auditSummaryOf(studio.detail.items.map(auditItemToRow));
        const ok = await confirmFn(`سيتم تطبيق الفروقات على أرصدة المخزون:\n— أصناف بفروقات: ${formatInt(summary.itemsWithVariance)} (نقص ${formatInt(summary.shortageItems)} / زيادة ${formatInt(summary.surplusItems)})\n— صافي قيمة الفروقات: ${moneyText(summary.projectedVarianceValue)}\nتُسجَّل حركات تصحيح موثّقة ولا يمكن التراجع. متابعة؟`);
        if (!ok) {return;}
        busy = true;
        try {
            if (status === 'draft') {await submitAuditSession(audit.id, sig, signerName);}
            const result = await approveAuditSession(audit.id, sig, signerName);
            notify(`اعتُمد الجرد وطُبّقت ${formatInt((result.transactions || []).length)} حركة تصحيح على الأرصدة`);
            await reload();
            if (!panelAlive(seq)) {return;}
            await refreshAuditDetail(seq);
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            panelMsg((e && e.message) || 'تعذر اعتماد الجرد — لم يُطبق أي تغيير');
        } finally {
            busy = false;
        }
    }

    async function cancelAudit() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (!studio || !studio.detail || !canAuditWrite) {return;}
        const audit = studio.detail.audit;
        if (!['draft', 'submitted'].includes(String(audit.status || ''))) {return;}
        const seq = panelSeq;
        const reason = String(panelEl.querySelector('[data-v2-cancel-reason]')?.value || '').trim();
        if (reason.length < 3) {notify('سبب الإلغاء مطلوب (3 أحرف على الأقل)'); return;}
        const ok = await confirmFn('سيتم إلغاء الجلسة دون أي تأثير على أرصدة المخزون. متابعة؟');
        if (!ok) {return;}
        busy = true;
        try {
            await cancelAuditSession(audit.id, reason);
            notify('أُلغيت جلسة الجرد');
            if (!panelAlive(seq) || !studio) {return;}
            studio.detail = null;
            studio.audits = await fetchAudits().catch(() => studio.audits);
            if (!panelAlive(seq) || !studio) {return;}
            studio.tab = 'history';
            renderStudio();
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            panelMsg((e && e.message) || 'تعذر إلغاء الجلسة');
        } finally {
            busy = false;
        }
    }

    /* ── تبويب «سجل الجرد» — النصوص من :1255-1277 ──────────────────────── */

    function auditHistoryHtml() {
        const rows = studio.audits.map((a) => {
            const row = auditToRow(a);
            const created = String(a.created_at || '').slice(0, 16).replace('T', ' ');
            const counted = a.counted_items != null ? Number(a.counted_items) : null;
            return `<tr>
              <td><strong class="erp-addr" dir="ltr">${esc(row.number)}</strong><span class="erp-mini__sub" dir="ltr">${esc(created)}</span></td>
              <td class="erp-addr">${esc(row.countedAt)}</td>
              <td>${esc(row.createdBy || '—')}</td>
              <td class="erp-num" dir="ltr">${counted != null ? `${formatInt(counted)} / ${formatInt(row.itemCount)}` : formatInt(row.itemCount)}</td>
              <td class="erp-num" dir="ltr">${row.varianceValue ? esc(moneyText(row.varianceValue)) : '—'}</td>
              <td>${auditStatusBadge(row.status)}</td>
              <td><button type="button" class="erp-btn erp-btn--sm" data-v2-sopen="${esc(String(a.id))}">
                <i class="ji" data-i="eye" aria-hidden="true"></i><span>فتح</span></button></td>
            </tr>`;
        }).join('') || `<tr><td colspan="7" class="erp-text-muted">لا توجد جلسات جرد بعد — ابدأ الأولى من تبويب «جلسة جديدة»</td></tr>`;
        return `<div class="erp-wh-audit-scroll">
            <table class="erp-wh-audit-table">
              <thead><tr><th>رقم الجلسة</th><th>تاريخ العد</th><th>المنشئ</th><th>معدود / الأصناف</th><th>صافي الفروقات</th><th>الحالة</th><th>إجراءات</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <p class="erp-text-sm erp-text-muted">الجلسات المعتمدة ظهرت فروقاتها كحركات تصحيح في سجل المخزون، والملغاة دون أي أثر. اضغط «فتح» لعرض تفاصيل أي جلسة — وإلغاؤها من داخل الجلسة نفسها.${studio.currency ? '' : ' لا وحدة عملة مضبوطة في الإعدادات — صافي الفروقات يُعرض بلا رمز.'}</p>`;
    }

    /* ── Filters: the server owns them ─────────────────────────────────── */

    function filters() {
        return { q: qInput.value.trim(), category: q('[data-v2-cat]').value, stock: q('[data-v2-stockseg] [data-v2-stock].is-active')?.getAttribute('data-v2-stock') || 'all' };
    }

    function activeFilters() {
        const f = filters();
        const list = [];
        if (f.stock !== 'all') {list.push(`الحالة: ${STOCK_SEG[f.stock]}`);}
        if (f.category && f.category !== 'all') {list.push(`الفئة: ${f.category}`);}
        if (f.q) {list.push(`بحث: ${f.q}`);}
        return list;
    }

    /** Category options come from the server's own DISTINCT list (:1791), so
     *  an option is a stored value and never a spelling invented here. The
     *  carried value is written as `selected` in the markup: assigning after
     *  `innerHTML` has already reset the select silently drops the filter. */
    function categoryOptions(categories) {
        const sel = q('[data-v2-cat]');
        const keep = sel.value;
        sel.innerHTML = `<option value="all"${keep === 'all' ? ' selected' : ''}>كل الفئات</option>`
            + categories.map((c) => `<option value="${esc(c)}"${c === keep ? ' selected' : ''}>${esc(c)}</option>`).join('');
    }

    /* ── Paint ────────────────────────────────────────────────────────── */
    function paint() {
        const f = filters();
        const active = activeFilters();
        const on = active.length > 0;
        const scope = on ? 'بالفلاتر الحالية' : 'السجل كله';

        scopeLine.textContent = truncated
            ? `${formatInt(allRows.length)} من ${formatInt(registerTotal)} صنفًا · سقف الجلب${on ? ' · ' + active.join(' · ') : ''}`
            : `${formatInt(allRows.length)} صنفًا · ${scope}`;

        kpisHost.innerHTML = kpiStrip(
            buildInventoryKpis(allRows, { scope, registerTotal, truncated }), scope);

        const under = allRows.filter((r) => r.stateKey === 'low' || r.stateKey === 'out');
        const gaps = shortageRows(under);
        shortageHost.innerHTML = shortageBlock(gaps, Math.max(...gaps.map((g) => g.short), 1));
        const out = allRows.filter((r) => r.stateKey === 'out').length;
        shortageNote.textContent = under.length
            ? `${gaps.length < under.length ? `أول ${formatInt(gaps.length)} من ${formatInt(under.length)}` : formatInt(under.length)} صنفًا · نفد ${formatInt(out)}`
            : (on ? 'لا شيء تحت الحد بهذه الفلاتر' : 'كل الأصناف فوق حدها');

        const cats = categoryCounts(allRows);
        topsHost.innerHTML = topsBlock(cats, allRows.length);
        topsNote.textContent = cats.length ? `${formatInt(cats.length)} فئة` : '';

        table.setRows(allRows);
        countEl.textContent = `(${formatInt(allRows.length)})`;

        clearBtn.hidden = !on;
        filterNote.hidden = !on;
        if (on) {
            filterNote.textContent = `الفلاتر نشطة (${active.join(' · ')}) — المؤشرات والتوزيع محسوبة على ${formatInt(allRows.length)} صنفًا قرّها الخادم بهذه الفلاتر`
                + (truncated ? ` من ${formatInt(registerTotal)} في السجل (سقف الجلب)` : '')
                + (fuzzy && f.q ? '. البحث تسامحي: طابقنا عائلات الحروف المتشابهة، فقد تعود أصناف لا تحرف كتابتك حرفيًا.' : '.');
        }
        printNote.textContent = `سجل الأصناف — ${formatInt(allRows.length)} صنفًا${on ? ` (${active.join(' · ')})` : ''}. المطبوعة تعرض الصفحة الحالية من الجدول، لا السجل كاملًا.`;
    }

    /* ── Load ─────────────────────────────────────────────────────────── */
    async function reload() {
        if (loading) {queued = true; return;}       // never stack two walks
        loading = true;
        table.setLoading(true);
        try {
            const f = filters();
            const [inv, shelves] = await Promise.allSettled([
                fetchInventory(f),
                fetchShelves(),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            if (shelves.status === 'fulfilled' && shelves.value.length) {
                shelfById = shelfMap(shelves.value);
                shelfNote.hidden = true;
            } else {
                shelfNote.hidden = false;
            }
            if (inv.status === 'rejected') {throw inv.reason;}
            allRows = inv.value.rows.map((r) => inventoryToRow(r, shelfById));
            registerTotal = inv.value.total;
            truncated = inv.value.truncated;
            fuzzy = inv.value.fuzzy;
            categoryOptions(inv.value.categories);
            paint();
            if (!allRows.length) {
                notify(activeFilters().length
                    ? 'لا صنف يطابق الفلاتر الحالية عند الخادم — امسح الفلاتر لترى السجل.'
                    : 'لا أصناف في السجل — لا اسم ولا رصيد يُختلق له.');
            }
        } catch (e) {
            if (!el.isConnected) {return;}
            allRows = [];
            registerTotal = 0;
            truncated = false;
            table.setRows([]);
            kpisHost.innerHTML = '';
            shortageHost.innerHTML = '';
            topsHost.innerHTML = '';
            countEl.textContent = '';
            scopeLine.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض المخزون بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل السجل: ${(e && e.message) || 'خطأ'}`));
        } finally {
            table.setLoading(false);
            loading = false;
            if (queued && el.isConnected) {
                queued = false;
                reload();                            // the newest filters win
            }
        }
    }

    /* ── Wiring (delegated; no inline handlers) ───────────────────────── */
    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-v2-gov]')) {if (navigate) {navigate('warehouse-gov');} return;}
        if (event.target.closest('[data-v2-clear]')) {
            qInput.value = '';
            q('[data-v2-cat]').value = 'all';
            q('[data-v2-stockseg]').innerHTML = segBlock('all');
            reload();
            return;
        }
        const seg = event.target.closest('[data-v2-stock]');
        if (seg) {
            q('[data-v2-stockseg]').innerHTML = segBlock(seg.getAttribute('data-v2-stock'));
            reload();
            return;
        }
        const act = event.target.closest('[data-v2-act]');
        if (act) {
            const row = allRows.find((r) => String(r.id) === String(act.getAttribute('data-id')));
            if (!row) {return;}
            const kind = act.getAttribute('data-v2-act');
            if (kind === 'receipt') {openPanel('receipt', row); return;}
            if (kind === 'direct') {openPanel('direct', row); return;}
            if (kind === 'delete') {deleteRow(row);}
            return;
        }
        const opener = event.target.closest('[data-v2-new]');
        if (opener) {openPanel(opener.getAttribute('data-v2-new')); return;}
        if (event.target.closest('[data-v2-audit-open]')) {openAuditStudio(); return;}
        // ── استوديو الجرد: كل زر يعود إلى ملفه بعقد الـ repo ──
        const stab = event.target.closest('[data-v2-stab]');
        if (stab) {showStudioTab(stab.getAttribute('data-v2-stab')); return;}
        const sloc = event.target.closest('[data-v2-sloc]');
        if (sloc && studio) {
            studio.locationId = Number(sloc.getAttribute('data-v2-sloc')) || 0;
            renderStudio();
            return;
        }
        const sscope = event.target.closest('[data-v2-sscope]');
        if (sscope && studio) {
            const mode = sscope.getAttribute('data-v2-sscope');
            if (mode !== studio.scopeMode) {
                studio.scopeMode = mode;
                studio.scopeCategory = '';
                studio.scopeSearch = '';
            }
            renderStudio();
            return;
        }
        const sopen = event.target.closest('[data-v2-sopen]');
        if (sopen) {openAuditSession(Number(sopen.getAttribute('data-v2-sopen'))); return;}
        if (event.target.closest('[data-v2-start-audit]')) {startAudit(); return;}
        if (event.target.closest('[data-v2-crefresh]')) {refreshAuditDetail(); return;}
        const asave = event.target.closest('[data-v2-asave]');
        if (asave) {saveCount(asave.getAttribute('data-v2-asave')); return;}
        const aclear = event.target.closest('[data-v2-aclear]');
        if (aclear) {clearCount(aclear.getAttribute('data-v2-aclear')); return;}
        if (event.target.closest('[data-v2-submit-audit]')) {submitAudit(); return;}
        if (event.target.closest('[data-v2-approve-audit]')) {approveAudit(); return;}
        if (event.target.closest('[data-v2-cancel-audit]')) {cancelAudit(); return;}
        if (event.target.closest('[data-v2-panel-close]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-submit]')) {submitPanel(); return;}
        if (event.target.closest('[data-v2-add-bulk-row]')) {
            q('[data-v2-bulk-rows]')?.insertAdjacentHTML('beforeend', bulkRowHtml());
            return;
        }
        if (event.target.closest('[data-v2-remove-row]')) {
            event.target.closest('[data-v2-bulk-row]')?.remove();
            return;
        }
        const mg = event.target.closest('[data-v2-merge-group]');
        if (mg) {mergeGroup(mg.getAttribute('data-v2-merge-group')); return;}
        // The table's own retry button clears the error but cannot refetch in
        // client mode — the host owns the data, so the refetch lives here.
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-cat]')) {reload(); return;}
        if (!studio) {return;}
        // ── استوديو الجرد: تغييرات النموذج تعيش في حالة الاستوديو ──
        if (event.target.matches('[data-v2-speriod]')) {studio.periodType = event.target.value; return;}
        if (event.target.matches('[data-v2-sdate]')) {studio.countedAt = event.target.value; return;}
        if (event.target.matches('[data-v2-sstart]')) {studio.periodStart = event.target.value; return;}
        if (event.target.matches('[data-v2-send]')) {studio.periodEnd = event.target.value; return;}
        if (event.target.matches('[data-v2-scat]')) {studio.scopeCategory = event.target.value; auditPreview(); return;}
        const cdiffs = event.target.closest('[data-v2-cdiffs]');
        if (cdiffs) {
            studio.diffOnly = cdiffs.checked;
            const tb = panelEl.querySelector('[data-v2-ctbody]');
            if (tb) {tb.innerHTML = countRowsHtml();}
        }
    });

    el.addEventListener('input', (event) => {
        if (event.target.matches('[data-v2-q]')) {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                searchTimer = null;
                if (el.isConnected) {reload();}
            }, 350);
            return;
        }
        if (!studio) {return;}
        // ── استوديو الجرد: المدخلات تبقى مسودات في الحالة حتى يتصرف المستخدم ──
        const cq = event.target.closest('[data-v2-cq]');
        if (cq) {studio.draftVals[cq.getAttribute('data-v2-cq')] = cq.value; return;}
        const cn = event.target.closest('[data-v2-cn]');
        if (cn) {studio.draftNotes[cn.getAttribute('data-v2-cn')] = cn.value; return;}
        if (event.target.matches('[data-v2-snotes]')) {studio.notes = event.target.value; return;}
        const ssearch = event.target.closest('[data-v2-ssearch]');
        if (ssearch) {
            studio.scopeSearch = ssearch.value;
            clearTimeout(previewTimer);
            previewTimer = setTimeout(() => {
                previewTimer = null;
                if (el.isConnected) {auditPreview();}
            }, 350);
            return;
        }
        const csearch = event.target.closest('[data-v2-csearch]');
        if (csearch) {
            studio.search = csearch.value;
            const tb = panelEl.querySelector('[data-v2-ctbody]');
            if (tb) {tb.innerHTML = countRowsHtml();}
        }
    });

    paint();
    reload();

    return {
        el,
        reload,
        getRows: () => allRows,
        destroy() {
            if (searchTimer) {clearTimeout(searchTimer); searchTimer = null;}
            if (previewTimer) {clearTimeout(previewTimer); previewTimer = null;}
            queued = false;
            panelSeq += 1;                           // لوحة مفتوحة لا تكتب بعد الفكاك
            table.destroy();
            disposeSignaturePads(SIG_ID);
            el.remove();
        },
    };
}
