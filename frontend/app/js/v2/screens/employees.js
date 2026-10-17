/**
 * V2 — Employees screen · شاشة 02 في سجل الترحيل (قراءة + دورة كتابة كاملة W2-2)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SAME CONTRACT AS SCREEN 01 (attendance.js), SAME VISUAL LANGUAGE
 *   Every network call goes through js/v2/data/employees-repo.js (reads and
 *   writes alike — the screen owns no URL and no token). Writes exist only
 *   behind the same roles the server demands (admin|manager|hr, or an
 *   hr.edit grant the server alone can see); the UI gate is a convenience,
 *   the server re-checks every request and its Arabic message is what the
 *   panel shows on refusal.
 *
 * WHAT THE SCREEN DOES (W2-2 additions marked)
 *   • A scope line that names how many people the roster holds, and renames
 *     itself the moment a filter hides any of them.
 *   • Chips for the statuses the rows ACTUALLY contain — a status that is new
 *     in the database gets its own chip instead of hiding inside a total.
 *     Their labels come from js/v2/status.js, never re-typed here.
 *   • «الموظفون حسب القسم»: the same horizontal-bar component the preview
 *     dashboard uses, counted over the roster, keyed by the stored department
 *     code so two codes with the same name stay two rows.
 *   • The roster in EnterpriseDataTable + the legacy card grid, each with a
 *     per-row action column: كشف (everyone), تعديل/حذف (writers only).
 *   • (W2-2) إضافة/تعديل عبر لوحة نموذج واحدة — the 24 writable server
 *     fields, admin-only auto_checkout/auto_lock, client mirrors of the
 *     server's shift/duplicate/department checks, and a 300px photo upload
 *     like the legacy one.
 *   • (W2-2) كشف الموظف: profile + expiry warnings + shift + salary (when
 *     the server returned it) + current-month attendance summary +
 *     آخر 5 إجازات + بطاقة QR (render, save PNG, print, regenerate) — every
 *     piece fetched from its own server door and shown as it arrived.
 *   • (W2-5) كشف يوم/فترة داخل البطاقة (نطاقٌ صريح، صفٌّ لكل يوم بما فيه
 *     الغياب والراحة الأسبوعية، والحالة من حقل الخادم لا من حساب وردية في
 *     الواجهة) + «البطاقة الرسمية للطباعة» (صفحة HTML كاملة يولّدها الخادم).
 *   • (W2-2) استيراد/تصدير Excel عبر XLSX المحمّل عند الطلب (v2/vendor.js):
 *     the legacy template columns verbatim, the legacy preflight rules and
 *     words, and an export that follows the same 12 columns but never
 *     carries البصمة الرقمية or رقم البطاقة (declared deviation).
 *
 * WHAT IT REFUSES TO DO
 *   • Never a second copy of a status label — labels come from status.js.
 *   • Never a printed window.print from anywhere but the user's click; the
 *     QR card print routes through the same single call with a body class
 *     that narrows what the paper shows.
 *   • Never a second print path: the QR card, the full card and the day/range
 *     sheet all ride that one print call behind a body class. The luxury
 *     card is the screen's only window.open — it is a whole HTML page the
 *     SERVER generates (tools/employee-card), which this page's print
 *     stylesheet cannot dress.
 *   • Never guesses an employee_id for a door: the كشف panel passes the id
 *     it was opened on, and the server's role scope decides the rest.
 *
 * PRIVACY (read this before adding a column)
 *   The API returns full employee rows including salary, iqama number and
 *   fingerprint tokens. employees-repo.js hands this screen an allowlist:
 *   employeeId, name, department, position, phone, status. The table row is
 *   the allowlist, period. The raw rows stay in `rawById` ONLY for the
 *   elevated roles this screen already serves (admin|manager|hr — the same
 *   audience the server hands salary to) and feed exactly two things: the
 *   edit-form prefill and the Excel export's own columns. Nothing sensitive
 *   is ever rendered as a row, a title or a cell.
 *
 * CARDS EXCEPTION (documented, narrow)
 *   The legacy directory is a card grid showing salary
 *   (features/employees.js:90), and only admin|manager|hr may open this
 *   screen. Salary, device number and shift facts therefore reach the card
 *   painter through cardExtrasMap (id-keyed, never through the row whose
 *   shape tests/v2-employees.test.js pins). iqama, tokens and photo blobs
 *   outside the allowlist stay out of every path.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.146';
import { resolveStatus, statusBadge } from '../status.js?v=4.9.146';
import {
    employeeToRow, fetchEmployees, fetchDepartments, departmentMap, employeeMap,
    buildEmployeeKpis, deptCounts, applyEmployeeFilters, searchEmployees, formatInt,
    cardExtrasMap, initialsOf, validPhotoSrc, shiftSummary,
    empWriteVisible, validateEmployeeForm, buildEmployeePayload,
    createEmployee, updateEmployee, deleteEmployee,
    fetchEmployeeCard, regenerateEmployeeQr,
    EMP_SHEET_COLS, sheetTemplateRows, buildSheetImport, sheetRowToPayload, exportSheetRows,
} from '../data/employees-repo.js?v=4.9.146';
import { fetchCurrency, formatMoney } from '../data/reports-repo.js?v=4.9.146';
import { fetchAttendanceReport, todayIso, minutesToHM, weekdayAr } from '../data/attendance-repo.js?v=4.9.146';
import { fetchLeaveWorkflow, fetchLeaveTypes, leaveTypeMap, leaveToRow, leaveStateOf } from '../data/leaves-repo.js?v=4.9.146';
import {
    fetchEmployeeSchedule, scheduleNotice, cardKpis, cardPayroll,
    systemQrText, humanQrText,
    fetchLuxCardHtml, rangeReportRows, MAX_RANGE_DAYS,
} from '../data/employee-card-repo.js?v=4.9.146';
import { ensureXlsx, ensureQrCode } from '../vendor.js?v=4.9.146';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Arabic for a stored status, through the single status authority. */
const statusOf = (v) => resolveStatus('employees', v);

/** Same order as employees-repo.shiftSummary — الأحد=0 … السبت=6. */
const OFF_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function deptCell(row) {
    if (row.dept === '—') {return `<span class="erp-text-muted">بلا قسم مسجّل</span>`;}
    if (row.deptResolved) {return esc(row.dept);}
    return `<span class="erp-text-muted" title="كود القسم كما هو في السجل — لم يُحلّ إلى اسم">${esc(row.dept)}</span>`;
}

function nameCell(row) {
    if (row.nameResolved) {return esc(row.name);}
    // A missing name is a fact about the record, not a name to guess at.
    return `<span class="erp-text-muted" title="لا اسم مخزّن — يُعرض رقم السجل">${esc(row.name)}</span>`;
}

/** One chip: the count, what it counts, and the base its share uses. */
function kpiStrip(kpis, scopeLabel) {
    return `<ul class="erp-kpis" aria-label="مؤشرات ${esc(scopeLabel)} — محسوبة على الصفوف المعروضة">`
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

/** Roster spread over departments — the frozen `.erp-tops` component. */
function topsBlock(depts, total) {
    if (!depts.length) {
        return `<div class="erp-state" role="status">
          <span class="erp-state__title">لا أقسام في الدليل</span>
          <span>لا صف يحمل قسمًا مسجّلًا، فال توزيع محسوب على لا شيء.</span>
        </div>`;
    }
    const max = Math.max(...depts.map((d) => d.count), 1);
    const aria = `عدد الموظفين في كل قسم، أكبر قسم ${formatInt(max)} موظفًا من ${formatInt(total)}`;
    return `<ul class="erp-tops" role="list" aria-label="${esc(aria)}">`
        + depts.map((d) => {
            const known = d.resolved || d.code === '';
            const label = d.code === '' ? 'بلا قسم مسجّل'
                : (d.resolved ? d.label : `${d.label} (كود)`);
            const title = `${label}: ${formatInt(d.count)} من ${formatInt(total)} موظفًا`;
            return `
        <li class="erp-top__row">
          <span class="erp-top__name${known ? '' : ' erp-text-muted'}" title="${esc(title)}">${esc(label)}</span>
          <span class="erp-top__track"><span class="erp-top__fill" style="inline-size:${Math.round((d.count / max) * 100)}%"></span></span>
          <span class="erp-top__val"><span class="erp-num" dir="ltr">${formatInt(d.count)}</span></span>
        </li>`;
        }).join('')
        + `</ul>`;
}

/**
 * كشف يوم/فترة من داخل البطاقة (القديم: smart-card.js:716-748). نطاقٌ صريح
 * وشريطٌ واحد، والنتيجة تُبنى في لوحة الكشف نفسها — لا نافذة منبثقة — وتُطبع
 * من نفس نداء الطباعة الوحيد بشارة body أضيق. المدى الافتراضي أول الشهر حتى
 * اليوم، وأزرار النطاق .erp-no-print فلا تدخل الورقة.
 */
function attRangeBlock() {
    const today = todayIso();
    return `<div data-v2-file-range>
          <h4 class="erp-emp-sec">كشف يوم/فترة</h4>
          <div class="erp-emp-att erp-no-print">
            <label class="erp-emp-att__f"><span>من</span>
              <input type="date" class="erp-input erp-input--ltr" data-v2-att-from max="${esc(today)}" value="${esc(`${today.slice(0, 7)}-01`)}"></label>
            <label class="erp-emp-att__f"><span>إلى</span>
              <input type="date" class="erp-input erp-input--ltr" data-v2-att-to max="${esc(today)}" value="${esc(today)}"></label>
            <span class="erp-grow"></span>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-att="day">
              <i class="ji" data-i="calendar-days" aria-hidden="true"></i><span>كشف اليوم</span></button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-att="range">
              <i class="ji" data-i="search" aria-hidden="true"></i><span>كشف الفترة</span></button>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-att="print" disabled>
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة الكشف</span></button>
          </div>
          <div data-v2-att-result></div>
        </div>`;
}

/** حالات صفّ الكشف: مفاتيح لا نصوص — النصّ واللون هنا، والحالة تأتي من حقول
 *  الخادم وحدها (data/employee-card-repo.js rangeReportRows). */
const ATT_STATE = {
    absent: { label: 'لم يحضر', tone: 'danger' },
    'day-off': { label: 'راحة أسبوعية', tone: 'neutral' },
    review: { label: 'يحتاج مراجعة', tone: 'warning' },
    'no-in': { label: 'بلا حضور', tone: 'warning' },
    'no-out': { label: 'بلا انصراف', tone: 'warning' },
    late: { label: 'تأخير', tone: 'danger' },
    'in-time': { label: 'في الموعد', tone: 'success' },
};

function template() {
    return `
      <div class="erp-v2-employees" data-v2-employees>
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">الموظفون
              <span class="erp-eyebrow" dir="ltr" lang="en">Employees</span>
            </h2>
            <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <span class="erp-filterbar erp-no-print">
              <label class="erp-text-sm erp-text-muted" for="v2emp-q">بحث</label>
              <input type="search" class="erp-input" id="v2emp-q" data-v2-q
                     autocomplete="off" spellcheck="false"
                     aria-describedby="v2emp-qhint"
                     placeholder="اسم أو كود أو وظيفة أو تليفون أو رقم بصمة">
              <label class="erp-text-sm erp-text-muted" for="v2emp-dept">القسم</label>
              <select class="erp-select" id="v2emp-dept" data-v2-dept>
                <option value="all">كل الأقسام</option>
              </select>
              <label class="erp-text-sm erp-text-muted" for="v2emp-status">الحالة</label>
              <select class="erp-select" id="v2emp-status" data-v2-status>
                <option value="all">كل الحالات</option>
              </select>
            </span>
            <span class="erp-text-sm erp-text-muted erp-no-print" id="v2emp-qhint" data-v2-qhint role="status" aria-live="polite"></span>
            <button type="button" class="erp-btn erp-btn--ghost erp-btn--sm erp-no-print" data-v2-clear aria-label="مسح التصفية" hidden>
              <i class="ji" data-i="x" aria-hidden="true"></i><span>مسح</span>
            </button>
            <span data-v2-tools></span>
            <span data-v2-viewseg></span>
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
            <h3 class="erp-card__title">الموظفون حسب القسم
              <span class="erp-eyebrow" dir="ltr" lang="en">By Department</span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted" data-v2-tops-note></span>
          </div>
          <div class="erp-card__body">
            <div data-v2-tops></div>
          </div>
        </section>

        <section class="erp-card" data-v2-cards-section hidden>
          <div class="erp-card__head">
            <h3 class="erp-card__title">بطاقات الموظفين
              <span class="erp-eyebrow" dir="ltr" lang="en">Cards</span>
              <span class="erp-text-muted erp-text-sm" data-v2-cardscount></span>
            </h3>
          </div>
          <div class="erp-card__body">
            <div data-v2-cards></div>
          </div>
        </section>

        <section class="erp-card" data-v2-roster>
          <div class="erp-card__head">
            <h3 class="erp-card__title">دليل الموظفين
              <span class="erp-eyebrow" dir="ltr" lang="en">Roster</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted">
              القراءة والكتابة من وجه الخادم الحالي
              (<span class="erp-addr" dir="ltr">/api/employees</span>)،
              والصلاحية قررها الخادم وحده: الإضافة والتعديل والحذف والاستيراد
              لأدوار admin|manager|hr (أو منحة hr.edit) — ورسالة الخادم هي المعروضة
              عند الرفض. الجدول يعرض قائمة السماح فقط؛
              بطاقات العرض تضيف الراتب ورقم البصمة والوردية كما في القديم
              (لأدوار هذه الشاشة حصرًا)، والهوية والرموز لا تظهر أبدًا.
              التصدير يتبع أعمدة قالب الاستيراد الاثنتي عشرة نفسها،
              لكنه لا يحمل البصمة الرقمية ولا رقم البطاقة — تضييق معلن عن القديم.
              <span data-v2-dept-note hidden>تعذّر تحميل أسماء الأقسام — تُعرض أكوادها.</span>
              <span data-v2-curnote hidden>تعذّرت قراءة وحدة المال — الرواتب بلا وحدة.</span>
            </p>
            <p class="erp-text-sm erp-text-muted" data-v2-filter-note hidden></p>
            <p class="erp-print-note" data-v2-print-note></p>
            <div data-v2-table></div>
          </div>
        </section>

        <!-- اللوحة خارج البطاقتين معًا: بطاقة الدليل تُخفى في عرض «بطاقات»
             (rosterSection.hidden)، ولو وُلِدت اللوحة داخلها لظهر النقر على
             «كشف» من بطاقة موظف بلا شيء. هنا تظهر في العرضين. -->
        <div data-v2-panel hidden></div>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, userName?: string|null,
 *          notify?: (message:string, kind?:string)=>void,
 *          confirmFn?: (message:string)=>Promise<boolean>|boolean}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountEmployeesScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 employees]', m);
    const confirmFn = typeof ctx.confirmFn === 'function'
        ? ctx.confirmFn
        : (message) => Promise.resolve(window.confirm(message));
    const role = ctx.role ? String(ctx.role) : '';
    const canWrite = empWriteVisible(role);
    const isAdmin = role === 'admin';

    let allRows = [];
    let rows = [];
    let rawById = new Map();
    let deptList = [];
    let loading = false;
    let busy = false;
    let deptByCode = new Map();

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeLine = q('[data-v2-scope-line]');
    const kpisHost = q('[data-v2-kpis]');
    const topsHost = q('[data-v2-tops]');
    const topsNote = q('[data-v2-tops-note]');
    const countEl = q('[data-v2-count]');
    const filterNote = q('[data-v2-filter-note]');
    const printNote = q('[data-v2-print-note]');
    const deptNote = q('[data-v2-dept-note]');
    const clearBtn = q('[data-v2-clear]');
    const cardsSection = q('[data-v2-cards-section]');
    const rosterSection = q('[data-v2-roster]');
    const cardsHost = q('[data-v2-cards]');
    const cardsCountEl = q('[data-v2-cardscount]');
    const viewSegHost = q('[data-v2-viewseg]');
    const curNote = q('[data-v2-curnote]');
    const panelEl = q('[data-v2-panel]');
    const searchEl = q('[data-v2-q]');
    const qHint = q('[data-v2-qhint]');

    let extrasById = new Map();
    let currency = '';
    const expandedIds = new Set();

    /* البحث (W2-6) — الصندوق هنا، والدرجات والمطابقة في الباب. */
    let searchQuery = '';
    let searchTimer = null;

    /* ── Panel state (W2-2) — one panel element, three kinds ──────────── */
    let panelSeq = 0;        // invalidates in-flight fills when the panel changes
    let panelKind = null;    // 'form' | 'file' | 'import'
    let panelRow = null;     // the roster row the panel was opened on
    let panelData = null;    // per-kind scratch (form photo, file fetches, import model)

    /* ── View: cards (legacy parity default) or table. Browser-only
       preference, like the theme pref — never a server field. */
    const VIEW_KEY = 'erp.v2.employees.view';
    function currentView() {
        try {
            const v = localStorage.getItem(VIEW_KEY);
            return v === 'table' ? 'table' : 'cards';
        } catch { return 'cards'; }
    }
    function setView(v) {
        try { localStorage.setItem(VIEW_KEY, v === 'table' ? 'table' : 'cards'); } catch { /* private mode */ }
        paint();
    }
    function viewSeg() {
        const v = currentView();
        const btn = (id, label) => `<button type="button" data-v2-view="${id}"`
            + `${id === v ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${label}</button>`;
        return `<div class="erp-seg erp-no-print" role="group" aria-label="طريقة العرض">`
            + `<span class="erp-seg__label">العرض</span>`
            + btn('cards', 'بطاقات') + btn('table', 'جدول') + `</div>`;
    }

    /** Toolbar add/import/export — add+import follow the server's write
     *  roles; export is a re-save of rows the server already sent this
     *  session, so every viewer keeps it. */
    function toolsSeg() {
        return (canWrite ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--primary erp-no-print" data-v2-new="add">
              <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة موظف</span></button>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-new="import">
              <i class="ji" data-i="upload" aria-hidden="true"></i><span>استيراد Excel</span></button>` : '')
            + `<button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-export>
              <i class="ji" data-i="download" aria-hidden="true"></i><span>تصدير Excel</span></button>`;
    }

    const table = createDataTable({
        caption: 'دليل الموظفين — بيانات حية',
        mode: 'client',
        pageSize: 20,
        stickyHeader: true,
        // البحث هنا أذكى من مرشّح الجدول: يطوي الهمزات وحروف النقاط ويوازن
        // «007» بـ«7». صندوق الجدول كان يصير ثاني بحث في نفس الشاشة.
        search: false,
        emptyMessage: 'لا يوجد موظفون',
        emptyHint: 'تحقق من صلاحية العرض أو من التصفية الحالية.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'code', header: 'الكود', sortable: true, filterable: true,
                width: '110px', className: 'erp-mono',
            },
            { key: 'name', header: 'الاسم', sortable: true, filterable: true, render: nameCell },
            { key: 'dept', header: 'القسم', sortable: true, filterable: true, width: '150px', render: deptCell },
            {
                key: 'position', header: 'المسمى', sortable: true, filterable: true, width: '150px',
                render: (row) => (row.position === '—'
                    ? `<span class="erp-text-muted">—</span>` : esc(row.position)),
            },
            {
                key: 'phone', header: 'الهاتف', width: '140px', className: 'erp-tnum',
                render: (row) => (row.phone && row.phone !== '—'
                    ? `<span class="erp-num" dir="ltr">${esc(row.phone)}</span>`
                    : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'status', header: 'الحالة', sortable: true, filterable: true, width: '150px',
                value: (row) => statusOf(row.status).label,
                render: (row) => statusBadge('employees', row.status),
            },
            {
                key: 'actions', header: 'إجراءات', width: canWrite ? '240px' : '110px',
                className: 'erp-td--actions',
                render: (row) => rowActions(row),
            },
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    /** Per-row actions (W1-6 house pattern): كشف for everyone who can see
     *  the roster; edit/delete only behind the server's write roles. */
    function rowActions(row) {
        return `<span class="erp-emp-actions">`
            + `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-act="file" data-id="${esc(String(row.id))}" title="كشف الموظف — الملف الكامل">
                <i class="ji" data-i="id-card" aria-hidden="true"></i><span>كشف</span></button>`
            + (canWrite ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-act="edit" data-id="${esc(String(row.id))}" title="تعديل بيانات الموظف">
                <i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span></button>` : '')
            + (canWrite ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-act="delete" data-id="${esc(String(row.id))}" title="حذف الموظف">
                <i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span></button>` : '')
            + `</span>`;
    }

    /* ── Filters ──────────────────────────────────────────────────────── */

    /** Options are rebuilt only when the roster reloads, never on a paint:
     *  an open <select> must not be torn away from under the pointer. */
    function filterOptions() {
        const deptSel = q('[data-v2-dept]');
        const statusSel = q('[data-v2-status]');
        const keepDept = deptSel.value;
        const keepStatus = statusSel.value;

        const depts = deptCounts(allRows);
        deptSel.innerHTML = `<option value="all">كل الأقسام</option>` + depts.map((d) => {
            const value = d.code || '—';
            const label = d.code === '' ? 'بلا قسم مسجّل'
                : (d.resolved ? d.label : `${d.label} (كود)`);
            return `<option value="${esc(value)}"${value === keepDept ? ' selected' : ''}>${esc(label)}</option>`;
        }).join('');

        const seen = new Map();
        for (const r of allRows) {
            const v = String((r && r.status) ?? '');
            if (!seen.has(v)) {seen.set(v, statusOf(v).label);}
        }
        statusSel.innerHTML = `<option value="all">كل الحالات</option>`
            + [...seen.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ar'))
                .map(([v, label]) => {
                    const value = v || '—';
                    return `<option value="${esc(value)}"${value === keepStatus ? ' selected' : ''}>${esc(label)}</option>`;
                }).join('');

        // A filter can point at a value the new roster no longer has.
        if (![...deptSel.options].some((o) => o.value === deptSel.value)) {deptSel.value = 'all';}
        if (![...statusSel.options].some((o) => o.value === statusSel.value)) {statusSel.value = 'all';}
    }

    function filters() {
        return { dept: q('[data-v2-dept]').value, status: q('[data-v2-status]').value };
    }

    /** The filters that are actually on, named the way their own option
     *  names it — "كل الحالات" is not a filter, so it never appears. */
    function activeFilters() {
        const named = (sel, prefix) => (sel.value && sel.value !== 'all'
            ? [`${prefix}: ${sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : sel.value}`]
            : []);
        const term = searchQuery.trim();
        return [
            ...(term ? [`بحث: ${term}`] : []),
            ...named(q('[data-v2-dept]'), 'قسم'),
            ...named(q('[data-v2-status]'), 'الحالة'),
        ];
    }

    /* ── Paint ────────────────────────────────────────────────────────── */
    /** ما فعله التطبيع يجب أن يُقال، لا يُخفى: وإلا صار البحث الذكي خطأً
     *  صامتًا يظن صاحبه أن «احمد» لم توجد. العدّ هنا على الدليل كله قبل
     *  القسم والحالة، لأن الباب يعمل أولًا. */
    function searchNote(res) {
        if (!res.matched) {return '';}
        if (!res.hits) {return `لا نتيجة لـ«${searchQuery.trim()}» — جرّب جزءًا من الاسم أو رقم البصمة.`;}
        const bits = [`${formatInt(res.hits)} مطابقة في الدليل`];
        if (res.exact) {bits.push(`${formatInt(res.exact)} مطابقة تامّة لرقم موظف أو بصمة`);}
        if (res.folded) {bits.push('بعض النتائج بعد تطبيع الحروف (أ/ا، ة/ه، س/ش…)');}
        return bits.join(' · ');
    }

    function salaryText(sal) {
        if (sal === null || sal === undefined) {return `<span class="erp-text-muted">—</span>`;}
        const m = formatMoney(sal, currency);
        return `<span class="erp-num" dir="ltr">${esc(m.amount)}</span>`
            + (m.hasUnit ? ` <small>${esc(m.unit)}</small>` : '');
    }

    function shiftBits(ex) {
        const sh = shiftSummary({
            shift_start: ex.shift_start, shift_karim: ex.shift_karim,
            auto_checkout: ex.auto_checkout, auto_lock: ex.auto_lock,
            day_off: ex.day_off,
        });
        const out = [`<span class="erp-person__shift"><i class="ji" data-i="clock" aria-hidden="true"></i>`
            + `<span class="erp-num" dir="ltr">${esc(sh.start)}</span>`
            + `<span>· ${esc(sh.hours)}س${sh.overnight ? ' <i class="ji" data-i="moon" aria-hidden="true"></i>' : ''}</span></span>`];
        if (sh.auto) {out.push(`<span class="erp-person__shift"><i class="ji" data-i="timer" aria-hidden="true"></i><span>انصراف تلقائي</span></span>`);}
        if (sh.locked) {out.push(`<span class="erp-person__shift"><i class="ji" data-i="lock" aria-hidden="true"></i><span>مقفل</span></span>`);}
        if (sh.off) {out.push(`<span class="erp-person__shift"><i class="ji" data-i="calendar" aria-hidden="true"></i><span>راحة: ${esc(sh.off)}</span></span>`);}
        return out.join('');
    }

    function cardsBlock(list) {
        if (!list.length) {
            return `<div class="erp-state" role="status"><span class="erp-state__title">لا موظفين</span>`
                + `<span>تحقق من صلاحية العرض أو من التصفية الحالية.</span></div>`;
        }
        return `<ul class="erp-cards" aria-label="بطاقات الموظفين">` + list.map((row) => {
            const ex = extrasById.get(String(row.id)) || {};
            const photo = validPhotoSrc(ex.photo);
            const avatar = photo
                ? `<span class="erp-avatar" aria-hidden="true"><img src="${esc(photo)}" alt="" loading="lazy"></span>`
                : `<span class="erp-avatar" aria-hidden="true">${esc(initialsOf(row.nameResolved ? row.name : ''))}</span>`;
            const fp = ex.deviceUserId
                ? `<span class="erp-person__shift"><span class="erp-dot erp-dot--success" aria-hidden="true"></span><span>بصمة ${esc(ex.deviceUserId)}</span></span>`
                : `<span class="erp-person__shift"><span class="erp-dot erp-dot--warning" aria-hidden="true"></span><span>بلا بصمة</span></span>`;
            const open = expandedIds.has(String(row.id));
            const phone = row.phone && row.phone !== '—'
                ? `<span class="erp-num erp-person__phone" dir="ltr">${esc(row.phone)}</span>`
                : `<span class="erp-text-muted">لا هاتف مسجل</span>`;
            return `<li class="erp-person">
          <button type="button" class="erp-person__head" data-v2-expand="${esc(row.id)}"
                  aria-expanded="${open ? 'true' : 'false'}" aria-label="بطاقة ${esc(row.name)} — ${open ? 'طي' : 'عرض'} التفاصيل">
            ${avatar}
            <span class="erp-person__who">
              <span class="erp-person__name">${esc(row.name)}</span>
              <span class="erp-person__code" dir="ltr">${esc(row.code)}</span>
            </span>
            ${statusBadge('employees', row.status)}
          </button>
          <div class="erp-person__facts">
            <div class="erp-person__fact"><i class="ji" data-i="building" aria-hidden="true"></i><span>${esc(row.dept)}</span></div>
            <div class="erp-person__fact"><i class="ji" data-i="briefcase" aria-hidden="true"></i><span>${row.position !== '—' ? esc(row.position) : '<span class="erp-text-muted">—</span>'}</span></div>
            <div class="erp-person__fact"><i class="ji" data-i="banknote" aria-hidden="true"></i><span class="erp-person__salary">${salaryText(ex.salary)}</span></div>
          </div>
          <div class="erp-person__meta">${fp}${shiftBits(ex)}</div>
          ${open ? `<div class="erp-person__more">
            <div class="erp-person__fact"><i class="ji" data-i="clock" aria-hidden="true"></i><span>الهاتف: ${phone}</span></div>
            <div class="erp-person__fact"><i class="ji" data-i="user" aria-hidden="true"></i><span>الحالة: ${esc(statusOf(row.status).label)}</span></div>
            ${rowActions(row)}
          </div>` : ''}
        </li>`;
        }).join('') + `</ul>`;
    }

    function paint() {
        const f = filters();
        const searched = searchEmployees(allRows, searchQuery, extrasById);
        const active = activeFilters();
        const on = active.length > 0;
        rows = on ? applyEmployeeFilters(searched.rows, f) : searched.rows;

        const scope = on ? 'النتيجة المصفّاة' : 'الدليل كله';
        scopeLine.textContent = on
            ? `${formatInt(rows.length)} من ${formatInt(allRows.length)} موظفًا · ${active.join(' · ')}`
            : `${formatInt(allRows.length)} موظفًا · ${scope}`;

        kpisHost.innerHTML = kpiStrip(
            buildEmployeeKpis(rows, { scope, labelOf: statusOf }), scope);

        const depts = deptCounts(rows);
        topsHost.innerHTML = topsBlock(depts, rows.length);
        topsNote.textContent = on
            ? `محسوب على ${formatInt(rows.length)} من ${formatInt(allRows.length)} موظفًا`
            : (depts.length ? `${formatInt(depts.length)} قسمًا` : '');

        table.setRows(rows);
        countEl.textContent = `(${formatInt(rows.length)})`;

        const view = currentView();
        viewSegHost.innerHTML = viewSeg();
        cardsSection.hidden = view !== 'cards';
        rosterSection.hidden = view !== 'table';
        if (view === 'cards') {
            cardsHost.innerHTML = cardsBlock(rows);
            cardsCountEl.textContent = `(${formatInt(rows.length)})`;
        }

        clearBtn.hidden = !on;
        filterNote.hidden = !on;
        if (on) {
            filterNote.textContent = `التصفية نشطة (${active.join(' · ')}) — المؤشرات والتوزيع محسوبة على ${formatInt(rows.length)} من ${formatInt(allRows.length)} موظفًا.`;
        }
        qHint.textContent = searchNote(searched);
        printNote.textContent = view === 'cards'
            ? `بطاقات الموظفين — ${formatInt(rows.length)} بطاقة. المطبوعة تعرض البطاقات الظاهرة.`
            : `دليل الموظفين — ${formatInt(rows.length)} موظفًا. المطبوعة تعرض الصفحة الحالية من الجدول، لا الدليل كاملًا.`;
    }

    /* ── Load ─────────────────────────────────────────────────────────── */
    async function reload() {
        if (loading) {return;}
        loading = true;
        table.setLoading(true);
        try {
            const [employees, departments, cur] = await Promise.allSettled([fetchEmployees(), fetchDepartments(), fetchCurrency().catch(() => '')]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            if (departments.status === 'fulfilled' && departments.value.length) {
                deptByCode = departmentMap(departments.value);
                deptList = departments.value;
                deptNote.hidden = true;
            } else {
                deptNote.hidden = false;
            }
            currency = cur.status === 'fulfilled' ? String(cur.value ?? '') : '';
            curNote.hidden = !!currency;
            if (employees.status === 'rejected') {throw employees.reason;}
            allRows = employees.value.map((e) => employeeToRow(e, deptByCode));
            rawById = employeeMap(employees.value);
            extrasById = cardExtrasMap(employees.value || []);
            filterOptions();
            paint();
            if (!allRows.length) {notify('لا موظفين في الدليل — لا اسم ولا قسم يُختلق له.');}
        } catch (e) {
            if (!el.isConnected) {return;}
            allRows = [];
            rows = [];
            rawById = new Map();
            extrasById = new Map();
            table.setRows([]);
            kpisHost.innerHTML = '';
            topsHost.innerHTML = '';
            countEl.textContent = '';
            scopeLine.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : `تعذّر تحميل الموظفين: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading = false;
        }
    }

    /* ── Panel scaffolding (W1-6 house pattern) ───────────────────────── */
    function panelShell(title, icon, body) {
        return `<div class="erp-emp-panel">
          <div class="erp-emp-panel__head">
            <h3 class="erp-emp-panel__title"><i class="ji" data-i="${esc(icon)}" aria-hidden="true"></i> ${esc(title)}</h3>
            <span class="erp-grow"></span>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost erp-no-print" data-v2-panel-close>
              <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
            </button>
          </div>
          <div class="erp-emp-panel__body erp-stack">${body}</div>
        </div>`;
    }

    function panelActions(submitLabel, submitIcon) {
        return `<div data-v2-panel-msg role="alert" class="erp-text-sm"></div>
          <div class="erp-emp-panel__actions">
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
        panelRow = null;
        panelData = null;
        panelEl.innerHTML = '';
        panelEl.hidden = true;
    }

    function panelMsg(text) {
        const m = panelEl.querySelector('[data-v2-panel-msg]');
        if (m) {m.textContent = String(text || '');}
    }

    /* ── Add / edit form (one panel, two modes) ───────────────────────── */
    function statusOptions() {
        const values = ['active', 'inactive', ''];
        for (const r of allRows) {
            const v = String((r && r.status) ?? '');
            if (!values.includes(v)) {values.push(v);}
        }
        return values;
    }

    function positionsList() {
        const set = new Set();
        for (const raw of rawById.values()) {
            const p = String((raw && raw.position) || '').trim();
            if (p) {set.add(p);}
        }
        return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
    }

    function sliceDate(v) {
        const s = String(v || '').trim();
        return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
    }

    function employeeIdSet() {
        const set = new Set();
        for (const raw of rawById.values()) {
            const id = String((raw && raw.employeeId) ?? '').trim();
            if (id) {set.add(id);}
        }
        return set;
    }

    /** Status label → stored value for the import preflight — built from the
     *  single status authority, so «نشط» maps exactly to what it labels. */
    function statusLabelMap() {
        const map = new Map();
        const values = new Set(['active', 'inactive', 'suspended', 'probation']);
        for (const r of allRows) {
            const v = String((r && r.status) ?? '');
            if (v) {values.add(v);}
        }
        for (const v of values) {
            const label = statusOf(v).label;
            if (!map.has(label)) {map.set(label, v);}
        }
        return map;
    }

    function openFormPanel(row) {
        panelSeq += 1;
        panelKind = 'form';
        panelRow = row || null;
        const raw = row ? (rawById.get(String(row.id)) || {}) : {};
        const f = row ? {
            name: String(raw.name || ''),
            employeeId: String(raw.employeeId || ''),
            department: String(raw.department || ''),
            position: String(raw.position || ''),
            phone: String(raw.phone || ''),
            email: String(raw.email || ''),
            joinDate: sliceDate(raw.joinDate),
            salary: raw.salary !== undefined && raw.salary !== null ? String(raw.salary) : '',
            status: raw.status !== undefined && raw.status !== null ? String(raw.status) : 'active',
            deviceUserId: String(raw.deviceUserId || ''),
            shift_start: String(raw.shift_start || '09:00'),
            shift_karim: raw.shift_karim !== undefined && raw.shift_karim !== null ? String(raw.shift_karim) : '10',
            day_off: raw.day_off === 0 || raw.day_off ? String(raw.day_off) : '',
            iqamaExpiry: sliceDate(raw.iqamaExpiry),
            healthCertExpiry: sliceDate(raw.healthCertExpiry),
            healthEduExpiry: sliceDate(raw.healthEduExpiry),
            auto_checkout: !!raw.auto_checkout,
            auto_lock: !!raw.auto_lock,
        } : {
            name: '',
            employeeId: `EMP${String(allRows.length + 1).padStart(3, '0')}`,
            department: '', position: '', phone: '', email: '',
            joinDate: todayIso(), salary: '', status: 'active',
            deviceUserId: '', shift_start: '09:00', shift_karim: '10', day_off: '',
            iqamaExpiry: '', healthCertExpiry: '', healthEduExpiry: '',
            auto_checkout: false, auto_lock: false,
        };
        panelData = { form: f, photo: '' };
        const sel = (v, want) => (String(v) === String(want) ? ' selected' : '');
        const deptOptions = deptList.map((d) => `<option value="${esc(String(d.code))}"${sel(d.code, f.department)}>${esc(d.name || d.code)}</option>`).join('');
        const avatar = (raw.photo && validPhotoSrc(raw.photo))
            ? `<img src="${esc(validPhotoSrc(raw.photo))}" alt="">`
            : esc(initialsOf(f.name || ''));
        setPanel(panelShell(row ? `تعديل بيانات: ${`${f.name}`.trim() || row.code}` : 'إضافة موظف جديد', row ? 'pencil' : 'plus', `
          <div class="erp-emp-form">
            <label class="erp-emp-field"><span>الاسم الكامل *</span>
              <input class="erp-input" type="text" data-v2-f="name" value="${esc(f.name)}" maxlength="255"></label>
            <label class="erp-emp-field"><span>الرقم الوظيفي${row ? ' (غير قابل للتعديل)' : ''}</span>
              <input class="erp-input erp-mono" type="text" dir="ltr" data-v2-f="employeeId" value="${esc(f.employeeId)}" maxlength="50"${row ? ' readonly' : ''}></label>
            <label class="erp-emp-field"><span>القسم</span>
              <select class="erp-select" data-v2-f="department">
                <option value=""${sel('', f.department)}>بلا قسم</option>${deptOptions}</select></label>
            <label class="erp-emp-field"><span>المنصب</span>
              <input class="erp-input" type="text" data-v2-f="position" value="${esc(f.position)}" list="v2emp-pos-list" maxlength="255"></label>
            <label class="erp-emp-field"><span>الجوال</span>
              <input class="erp-input" type="text" dir="ltr" data-v2-f="phone" value="${esc(f.phone)}" maxlength="50"></label>
            <label class="erp-emp-field"><span>البريد</span>
              <input class="erp-input" type="email" dir="ltr" data-v2-f="email" value="${esc(f.email)}" maxlength="255"></label>
            <label class="erp-emp-field"><span>تاريخ الالتحاق</span>
              <input class="erp-input" type="date" data-v2-f="joinDate" value="${esc(f.joinDate)}"></label>
            <label class="erp-emp-field"><span>الراتب الأساسي</span>
              <input class="erp-input" type="number" step="0.01" min="0" dir="ltr" data-v2-f="salary" value="${esc(f.salary)}"></label>
            <label class="erp-emp-field"><span>الحالة</span>
              <select class="erp-select" data-v2-f="status">${statusOptions().map((v) => `<option value="${esc(v)}"${sel(v, f.status)}>${esc(statusOf(v).label)}</option>`).join('')}</select></label>
            <label class="erp-emp-field"><span>رقم البصمة على الجهاز</span>
              <input class="erp-input" type="text" dir="ltr" data-v2-f="deviceUserId" value="${esc(f.deviceUserId)}" maxlength="64" placeholder="اتركه فارغًا للربط التلقائي بالرقم الوظيفي"></label>
            <label class="erp-emp-field"><span>بداية الوردية</span>
              <input class="erp-input" type="time" dir="ltr" data-v2-f="shift_start" value="${esc(f.shift_start)}"></label>
            <label class="erp-emp-field"><span>ساعات الوردية (1–24)</span>
              <input class="erp-input" type="number" min="1" max="24" step="0.5" dir="ltr" data-v2-f="shift_karim" value="${esc(f.shift_karim)}"></label>
            <label class="erp-emp-field"><span>الراحة الأسبوعية</span>
              <select class="erp-select" data-v2-f="day_off">
                <option value=""${sel('', f.day_off)}>بلا راحة محددة</option>
                ${OFF_NAMES.map((nm, i) => `<option value="${i}"${sel(i, f.day_off)}>${esc(nm)}</option>`).join('')}</select></label>
            <label class="erp-emp-field"><span>انتهاء الإقامة</span>
              <input class="erp-input" type="date" data-v2-f="iqamaExpiry" value="${esc(f.iqamaExpiry)}"></label>
            <label class="erp-emp-field"><span>انتهاء الشهادة الصحية</span>
              <input class="erp-input" type="date" data-v2-f="healthCertExpiry" value="${esc(f.healthCertExpiry)}"></label>
            <label class="erp-emp-field"><span>انتهاء التثقيف الصحي</span>
              <input class="erp-input" type="date" data-v2-f="healthEduExpiry" value="${esc(f.healthEduExpiry)}"></label>
            ${isAdmin ? `
            <label class="erp-emp-check"><input type="checkbox" data-v2-f="auto_checkout"${f.auto_checkout ? ' checked' : ''}><span>انصراف تلقائي</span></label>
            <label class="erp-emp-check"><input type="checkbox" data-v2-f="auto_lock"${f.auto_lock ? ' checked' : ''}><span>قفل اليوم بعد الانصراف التلقائي</span></label>` : ''}
          </div>
          <datalist id="v2emp-pos-list">${positionsList().map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>
          <div class="erp-emp-photo">
            <span class="erp-emp-photo__preview erp-avatar" data-v2-photo-preview aria-hidden="true">${avatar}</span>
            <label class="erp-btn erp-btn--sm erp-no-print" for="v2emp-photo-file">
              <i class="ji" data-i="camera" aria-hidden="true"></i><span>صورة الموظف</span></label>
            <input type="file" id="v2emp-photo-file" accept="image/*" capture="environment" data-v2-photo hidden>
            <span class="erp-text-sm erp-text-muted" data-v2-photo-note>تُصغَّر إلى 300px كالبطاقة القديمة — تُرفع مع الحفظ.</span>
          </div>
          ${panelActions(row ? 'حفظ التعديلات' : 'إضافة الموظف', row ? 'save' : 'plus')}`));
    }

    function readForm() {
        const form = {};
        panelEl.querySelectorAll('[data-v2-f]').forEach((inp) => {
            form[inp.getAttribute('data-v2-f')] = inp.type === 'checkbox' ? inp.checked : inp.value;
        });
        return form;
    }

    async function submitForm() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const editing = !!panelRow;
        const editId = panelRow ? panelRow.id : null;
        const form = readForm();
        if (panelData && panelData.photo) {form.photo = panelData.photo;}
        const errors = validateEmployeeForm(form, {
            editing,
            existingIds: employeeIdSet(),
            deptCodes: deptList.map((d) => String(d.code)),
        });
        if (errors.length) {panelMsg(errors[0].message); return;}
        const payload = buildEmployeePayload(form, { role, editing });
        const submitBtn = panelEl.querySelector('[data-v2-submit]');
        busy = true;
        if (submitBtn) {submitBtn.disabled = true;}
        try {
            if (editing) {await updateEmployee(editId, payload);}
            else {await createEmployee(payload);}
            busy = false;
            closePanel();
            await reload();
            if (!el.isConnected) {return;}
            notify(editing ? 'تم حفظ التعديلات' : 'تمت إضافة الموظف');
        } catch (e) {
            busy = false;
            if (submitBtn && submitBtn.isConnected) {submitBtn.disabled = false;}
            panelMsg((e && e.message) || 'تعذر الحفظ');
        }
    }

    async function deleteRow(row) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const ok = await confirmFn('حذف هذا الموظف؟');
        if (!ok) {return;}
        busy = true;
        try {
            await deleteEmployee(row.id);
            closePanel();
            notify('تم الحذف');
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify((e && e.message) || 'تعذر الحذف');
        } finally {
            busy = false;
        }
    }

    /* ── كشف الموظف (file panel) ──────────────────────────────────────── */

    /** A stored expiry is a fact with a state; the state is computed against
     *  today, never against a guessed format. Malformed values stay visible. */
    function expiryLine(label, value) {
        const s = sliceDate(value);
        if (!s) {return `<div class="erp-emp-fact"><span class="erp-text-muted">${esc(label)}: —</span></div>`;}
        const today = todayIso();
        let tag = 'سارية'; let cls = 'erp-emp-exp--ok';
        const diff = Date.parse(`${s}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
        if (s < today) {tag = 'منتهية'; cls = 'erp-emp-exp--over';}
        else if (diff <= 30 * 86400000) {tag = 'تنتهي خلال 30 يومًا'; cls = 'erp-emp-exp--soon';}
        return `<div class="erp-emp-fact"><span>${esc(label)}:
          <span class="erp-num" dir="ltr">${esc(s)}</span>
          <small class="${cls}">${esc(tag)}</small></span></div>`;
    }

    function openFilePanel(row) {
        panelSeq += 1;
        panelKind = 'file';
        panelRow = row;
        const seq = panelSeq;
        panelData = { qrUrl: '' };
        const raw = rawById.get(String(row.id)) || {};
        const ex = extrasById.get(String(row.id)) || {};
        const photo = validPhotoSrc(ex.photo);
        const avatar = photo
            ? `<span class="erp-emp-photo__preview erp-avatar" aria-hidden="true"><img src="${esc(photo)}" alt=""></span>`
            : `<span class="erp-emp-photo__preview erp-avatar" aria-hidden="true">${esc(initialsOf(row.nameResolved ? row.name : ''))}</span>`;
        const hasSalary = ex.salary !== null && ex.salary !== undefined;
        setPanel(panelShell(`كشف الموظف — ${row.name}`, 'id-card', `
          <div class="erp-emp-file__head">
            ${avatar}
            <div class="erp-emp-file__who">
              <strong class="erp-emp-file__name">${esc(row.name)}</strong>
              <span class="erp-text-sm erp-text-muted"><span class="erp-mono" dir="ltr">${esc(row.code)}</span></span>
            </div>
            ${statusBadge('employees', row.status)}
            <span data-v2-file-badge></span>
          </div>
          <div class="erp-emp-grid">
            <div class="erp-emp-fact"><i class="ji" data-i="building" aria-hidden="true"></i><span>القسم: ${deptCell(row)}</span></div>
            <div class="erp-emp-fact"><i class="ji" data-i="briefcase" aria-hidden="true"></i><span>المسمى: ${row.position !== '—' ? esc(row.position) : '—'}</span></div>
            <div class="erp-emp-fact"><i class="ji" data-i="phone" aria-hidden="true"></i><span>الجوال: ${row.phone !== '—' ? `<span class="erp-num" dir="ltr">${esc(row.phone)}</span>` : '—'}</span></div>
            <div class="erp-emp-fact"><i class="ji" data-i="file-text" aria-hidden="true"></i><span>البريد: ${raw.email ? esc(raw.email) : '—'}</span></div>
            <div class="erp-emp-fact"><i class="ji" data-i="calendar-days" aria-hidden="true"></i><span>تاريخ الالتحاق: ${sliceDate(raw.joinDate) ? `<span class="erp-num" dir="ltr">${esc(sliceDate(raw.joinDate))}</span>` : '—'}</span></div>
            <div class="erp-emp-fact"><i class="ji" data-i="scan" aria-hidden="true"></i><span>رقم البصمة: ${ex.deviceUserId ? `<span class="erp-num" dir="ltr">${esc(ex.deviceUserId)}</span>` : '<span class="erp-text-muted">بلا بصمة</span>'}</span></div>
          </div>
          <div class="erp-emp-grid">
            ${expiryLine('انتهاء الإقامة', raw.iqamaExpiry)}
            ${expiryLine('انتهاء الشهادة الصحية', raw.healthCertExpiry)}
            ${expiryLine('انتهاء التثقيف الصحي', raw.healthEduExpiry)}
          </div>
          <div class="erp-person__meta">${shiftBits(ex)}</div>
          <div class="erp-person__meta" data-v2-file-sched></div>
          ${hasSalary ? `<div class="erp-emp-fact"><i class="ji" data-i="banknote" aria-hidden="true"></i><span>الراتب الأساسي: ${salaryText(ex.salary)}</span></div>` : ''}
          <div data-v2-file-kpis></div>
          <div data-v2-file-att></div>
          ${attRangeBlock()}
          <div data-v2-file-leaves></div>
          <div data-v2-file-qr></div>
          <div class="erp-emp-panel__actions">
            <span class="erp-grow"></span>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-print="card">
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة البطاقة الكاملة</span></button>
            ${canWrite ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-lux>
              <i class="ji" data-i="id-card" aria-hidden="true"></i><span>البطاقة الرسمية للطباعة</span></button>` : ''}
            ${canWrite ? `<button type="button" class="erp-btn" data-v2-act="edit" data-id="${esc(String(row.id))}">
              <i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span></button>` : ''}
            ${canWrite ? `<button type="button" class="erp-btn erp-btn--danger" data-v2-act="delete" data-id="${esc(String(row.id))}">
              <i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span></button>` : ''}
            <button type="button" class="erp-btn" data-v2-panel-close>إغلاق</button>
          </div>`));
        fillAttendance(row, seq);
        fillSchedule(row, seq);
        fillLeaves(row, seq);
        fillQr(row, seq);
    }

    async function fillAttendance(row, seq) {
        const host = panelEl.querySelector('[data-v2-file-att]');
        if (!host) {return;}
        host.innerHTML = `<p class="erp-text-sm erp-text-muted">جارٍ جلب حضور الشهر…</p>`;
        let res = null; let err = '';
        try { res = await fetchAttendanceReport({ employeeId: row.id }); }
        catch (e) { err = (e && e.message) || 'خطأ'; }
        if (!el.isConnected || seq !== panelSeq || panelKind !== 'file' || !host.isConnected) {return;}
        if (err) {host.innerHTML = `<p class="erp-text-sm erp-emp-bad">تعذر جلب تقرير الحضور: ${esc(err)}</p>`; return;}
        const s = (res && res.summary) || {};
        const stat = (label, value) => `<span class="erp-emp-stat"><span class="erp-emp-stat__v erp-num" dir="ltr">${esc(value)}</span><span class="erp-emp-stat__l">${esc(label)}</span></span>`;
        host.innerHTML = `
          <h4 class="erp-emp-sec">حضور الشهر (${esc(s.from || '')} — ${esc(s.to || '')})</h4>
          <div class="erp-emp-stats">
            ${stat('أيام حضور', formatInt(s.daysPresent))}
            ${stat('أيام مكتملة', formatInt(s.completeDays))}
            ${stat('أيام تأخير', formatInt(s.lateDays))}
            ${stat('ساعات عمل', s.totalKarim !== undefined ? String(s.totalKarim) : '0')}
            ${stat('ساعات تأخير', s.totalLateHours !== undefined ? String(s.totalLateHours) : '0')}
            ${Number(s.reviewDays) > 0 ? stat('قيد المراجعة', formatInt(s.reviewDays)) : ''}
          </div>
          <p class="erp-text-sm erp-text-muted">الشهر الحالي — النطاق افتراضي من الخادم؛ الكشف الكامل والطباعة في شاشة الحضور.</p>`;
        paintCardSummary(row, s);
    }

    /**
     * شارة الأداء ومؤشراته والراتب التقديري — من نفس ملخّص التقرير، بلا بابٍ
     * ثانٍ. البطاقة القديمة (smart-card.js:181-198) كانت تعيد حساب التأخير من
     * أوقات البصمة في الواجهة؛ V2 يقرأ رقم الخادم نفسه الذي تعرضه شاشة الحضور،
     * فلا يمكن للبطاقة أن تقول شيئًا تخالفه الشاشة.
     */
    function paintCardSummary(row, s) {
        const k = cardKpis(s);
        const badgeHost = panelEl.querySelector('[data-v2-file-badge]');
        if (badgeHost) {
            badgeHost.innerHTML = k.badge
                ? `<span class="erp-badge" data-tone="${k.badgeTone}">${esc(k.badge)}</span>`
                : '';
        }
        const kpiHost = panelEl.querySelector('[data-v2-file-kpis]');
        if (!kpiHost) {return;}
        const raw = (label, html) => `<span class="erp-emp-stat"><span class="erp-emp-stat__v">${html}</span>`
            + `<span class="erp-emp-stat__l">${esc(label)}</span></span>`;
        const stat = (label, value) => raw(label, `<span class="erp-num" dir="ltr">${esc(value)}</span>`);
        if (k.workDays <= 0) {
            kpiHost.innerHTML = `<h4 class="erp-emp-sec">الأداء</h4>
              <p class="erp-text-sm erp-text-muted">لا أيام حضور مسجّلة هذا الشهر — لا نسبة تُحسب ولا خصم يُقدَّر.</p>`;
            return;
        }
        const ex = extrasById.get(String(row.id)) || {};
        const pr = cardPayroll({ salary: ex.salary, lateMinutes: k.lateMinutes, workDays: k.workDays });
        kpiHost.innerHTML = `
          <h4 class="erp-emp-sec">الأداء</h4>
          <div class="erp-emp-stats">
            ${stat('نسبة الانتظام', `${k.rate}%`)}
            ${stat('أيام حضور', formatInt(k.workDays))}
            ${stat('أيام تأخير', formatInt(k.lateDays))}
            ${stat('ساعات تأخير', String(k.lateHours))}
            ${k.reviewDays > 0 ? stat('قيد المراجعة', formatInt(k.reviewDays)) : ''}
          </div>
          <progress class="erp-emp-rate" max="100" value="${esc(String(k.rate))}"
                    aria-label="نسبة الانتظام ${esc(String(k.rate))} بالمئة"></progress>
          ${pr ? `<h4 class="erp-emp-sec">الراتب التقديري</h4>
          <div class="erp-emp-stats">
            ${raw('الأساسي', salaryText(pr.basic))}
            ${raw(`خصم تأخير (${formatInt(pr.deductionHours)} س)`, salaryText(pr.deduction))}
            ${raw('صافي تقديري', salaryText(pr.net))}
          </div>
          <p class="erp-text-sm erp-text-muted">تقديري — الخصم المعتمد يُحتسب في كشف الرواتب.</p>` : ''}`;
    }

    /**
     * الدوام المجدول القادم — hr-routes.js:1639. التعديل بتاريخ مستقبلي لا
     * يُسمَع في البطاقة فورًا، فالشارة تقول «مجدول من…» بدل أن توهم بدوامٍ
     * لم يبدأ (تفسير smart-card.js:30-32 نفسه). موظفٌ بلا تعديلٍ مستقبلي لا
     * شارة له — وهذا صمتٌ مقصود، لا خطأ مخفيّ.
     */
    async function fillSchedule(row, seq) {
        const host = panelEl.querySelector('[data-v2-file-sched]');
        if (!host) {return;}
        let res;
        try { res = await fetchEmployeeSchedule(row.id); }
        catch (_) {return;}
        if (!el.isConnected || seq !== panelSeq || panelKind !== 'file' || !host.isConnected) {return;}
        const n = scheduleNotice(res);
        if (!n) {return;}
        const extra = n.extra > 0 ? ` <span class="erp-text-muted">(+${formatInt(n.extra)})</span>` : '';
        /* «(12س)» و«: 16:00» يحذفان كاملَين حين لا قيمة: العمودان يجوز أن
           يكونا null، و«()س» أو «: » يوهمان بقراءةٍ ناقصة بينما لم تُكتب. */
        const time = n.start ? `: <span class="erp-num" dir="ltr">${esc(n.start)}</span>` : '';
        const hours = n.hours ? ` (${esc(n.hours)}س)` : '';
        host.innerHTML = `<span class="erp-emp-sched"><i class="ji" data-i="calendar-days" aria-hidden="true"></i>`
            + `<span>مجدول من <span class="erp-num" dir="ltr">${esc(n.effectiveFrom)}</span>${time}${hours}${extra}</span></span>`;
    }

    async function fillLeaves(row, seq) {
        const host = panelEl.querySelector('[data-v2-file-leaves]');
        if (!host) {return;}
        host.innerHTML = `<p class="erp-text-sm erp-text-muted">جارٍ جلب الإجازات…</p>`;
        let mine = []; let err = '';
        try {
            const [wf, types] = await Promise.all([fetchLeaveWorkflow(), fetchLeaveTypes()]);
            const typeById = leaveTypeMap(types && types.rows ? types.rows : []);
            mine = (Array.isArray(wf) ? wf : [])
                .map((l) => leaveToRow(l, typeById))
                .filter((r) => r.employeeKey === String(row.id));
            mine.sort((a, b) => String(b.start).localeCompare(String(a.start)));
            mine = mine.slice(0, 5);
        } catch (e) { err = (e && e.message) || 'خطأ'; }
        if (!el.isConnected || seq !== panelSeq || panelKind !== 'file' || !host.isConnected) {return;}
        if (err) {host.innerHTML = `<p class="erp-text-sm erp-emp-bad">تعذر جلب الإجازات: ${esc(err)}</p>`; return;}
        if (!mine.length) {
            host.innerHTML = `<h4 class="erp-emp-sec">آخر الإجازات</h4><p class="erp-text-sm erp-text-muted">لا إجازات مسجلة لهذا الموظف.</p>`;
            return;
        }
        host.innerHTML = `<h4 class="erp-emp-sec">آخر الإجازات</h4><ul class="erp-emp-leaves">`
            + mine.map((r) => {
                const st = leaveStateOf(r);
                return `<li class="erp-emp-leave">
                  <span class="erp-emp-leave__type">${esc(r.type)}</span>
                  <span class="erp-text-sm erp-text-muted"><span class="erp-num" dir="ltr">${esc(r.start)}</span> ← <span class="erp-num" dir="ltr">${esc(r.end)}</span>${r.days !== null ? ` · ${formatInt(r.days)} يوم` : ''}</span>
                  ${statusBadge(st.domain, st.key)}
                </li>`;
            }).join('') + `</ul>`;
    }

    async function fillQr(row, seq) {
        const host = panelEl.querySelector('[data-v2-file-qr]');
        if (!host) {return;}
        host.innerHTML = `<p class="erp-text-sm erp-text-muted">جارٍ جلب بطاقة QR…</p>`;
        let card = null; let err = '';
        try { card = await fetchEmployeeCard(row.id); }
        catch (e) { err = (e && e.message) || 'خطأ'; }
        if (!el.isConnected || seq !== panelSeq || panelKind !== 'file' || !host.isConnected) {return;}
        if (err) {host.innerHTML = `<h4 class="erp-emp-sec">بطاقة QR</h4><p class="erp-text-sm erp-emp-bad">تعذر جلب البطاقة: ${esc(err)}</p>`; return;}
        const regenBtn = canWrite
            ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-qr="regen"><i class="ji" data-i="refresh" aria-hidden="true"></i><span>تجديد QR</span></button>`
            : '';
        if (!card || !card.qrAvailable || !card.qrPayload) {
            host.innerHTML = `<h4 class="erp-emp-sec">بطاقة QR</h4>
              <p class="erp-text-sm erp-text-muted">${esc((card && card.message) || 'لا رمز QR متاح')}</p>
              <div class="erp-emp-qr__btns erp-no-print">${regenBtn}</div>`;
            return;
        }
        const ready = await ensureQrCode();
        const systemText = systemQrText(card);
        let qrUrl = '';
        if (ready && systemText) {
            try { qrUrl = await window.QRCode.toDataURL(systemText, { margin: 1, width: 320 }); }
            catch (_) { qrUrl = ''; }
        }
        // رمز البيانات: نصٌّ مقروء يمسحه الجوال — لا يُقدَّم لكشك الحضور أبدًا.
        const humanText = humanQrText({
            employeeName: row.name,
            employeeCode: row.code,
            deptName: row.deptResolved ? row.dept : '',
            position: row.position !== '—' ? row.position : '',
            deviceUserId: (extrasById.get(String(row.id)) || {}).deviceUserId,
            cardId: (card.qrPayload || {}).cardId,
        });
        let humanUrl = '';
        if (ready) {
            try { humanUrl = await window.QRCode.toDataURL(humanText, { margin: 1, width: 320 }); }
            catch (_) { humanUrl = ''; }
        }
        if (!el.isConnected || seq !== panelSeq || panelKind !== 'file' || !host.isConnected) {return;}
        if (panelData) {panelData.qrUrl = qrUrl; panelData.humanQrUrl = humanUrl;}
        const payload = card.qrPayload || {};
        host.innerHTML = `<h4 class="erp-emp-sec">بطاقة QR</h4>
          <div class="erp-emp-qr-card">
            <div class="erp-emp-qr__pair">
              <div class="erp-emp-qr__one">
                ${qrUrl
                    ? `<img class="erp-emp-qr__img" src="${esc(qrUrl)}" alt="رمز QR للموظف ${esc(row.name)}">`
                    : `<p class="erp-text-sm erp-text-muted">تعذر تحميل مولّد الرموز — أعد فتح الكشف للمحاولة مرة أخرى.</p>`}
                <span class="erp-emp-qr__cap">رمز النظام — يمسحه كشك الحضور</span>
              </div>
              ${humanUrl ? `<div class="erp-emp-qr__one">
                <img class="erp-emp-qr__img" src="${esc(humanUrl)}" alt="رمز بيانات الموظف ${esc(row.name)} للقراءة فقط">
                <span class="erp-emp-qr__cap">رمز البيانات — يمسحه الجوال للقراءة</span>
              </div>` : ''}
            </div>
            <div class="erp-emp-qr__meta">
              <span class="erp-text-sm">رقم البطاقة: <span class="erp-num" dir="ltr">${esc(payload.cardId || '')}</span></span>
              <span class="erp-text-sm erp-text-muted">إصدار <span class="erp-num" dir="ltr">${esc(String(payload.qrVersion ?? ''))}</span> — المسح يتحقق عبر بوابة الخادم</span>
            </div>
            <div class="erp-emp-qr__btns erp-no-print">
              ${qrUrl ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-qr="save"><i class="ji" data-i="download" aria-hidden="true"></i><span>حفظ رمز النظام</span></button>` : ''}
              ${humanUrl ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-qr="save-human"><i class="ji" data-i="download" aria-hidden="true"></i><span>حفظ رمز البيانات</span></button>` : ''}
              ${qrUrl ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-qr="print"><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة رمز QR</span></button>` : ''}
              ${regenBtn}
            </div>
          </div>`;
    }

    async function regenQr() {
        if (busy || !panelRow || panelKind !== 'file') {return;}
        const ok = await confirmFn('تجديد بطاقة QR؟ سيصبح الرمز القديم غير صالح.');
        if (!ok) {return;}
        busy = true;
        try {
            await regenerateEmployeeQr(panelRow.id);
            notify('تم تجديد بطاقة QR — الرمز القديم لم يعد صالحًا');
        } catch (e) {
            notify((e && e.message) || 'تعذر تجديد QR');
        } finally {
            busy = false;
        }
        if (panelKind === 'file' && panelRow) {await fillQr(panelRow, panelSeq);}
    }

    /* ── كشف يوم/فترة (W2-5) ─────────────────────────────────────────── */

    function attRangeReady(on) {
        const btn = panelEl.querySelector('[data-v2-att="print"]');
        if (btn) {btn.disabled = !on;}
    }

    /** كشف يوم أو فترة من داخل البطاقة: نفس باب تقرير الموظف بنطاقٍ صريح.
     *  المُرسَل هو id الصفّ الذي فُتحت عليه اللوحة، والخادم وحده يقرّر النطاق
     *  المسموح — ولا يُعاد اشتقاق حالة يوم في المتصفح. */
    async function loadAttRange(kind) {
        if (!panelRow || panelKind !== 'file') {return;}
        const fromEl = panelEl.querySelector('[data-v2-att-from]');
        const toEl = panelEl.querySelector('[data-v2-att-to]');
        const today = todayIso();
        let from = today;
        let to = today;
        if (kind !== 'day') {
            from = (fromEl && fromEl.value) || '';
            to = (toEl && toEl.value) || '';
            if (!from || !to) {notify('اختر تاريخ البداية والنهاية'); return;}
            if (to < from) {notify('تاريخ النهاية يسبق تاريخ البداية'); return;}
        }
        if (fromEl) {fromEl.value = from;}
        if (toEl) {toEl.value = to;}
        const seq = panelSeq;
        const host = panelEl.querySelector('[data-v2-att-result]');
        if (!host) {return;}
        attRangeReady(false);
        host.innerHTML = `<p class="erp-text-sm erp-text-muted">جارٍ قراءة الكشف…</p>`;
        let res = null; let err = '';
        try { res = await fetchAttendanceReport({ employeeId: panelRow.id, from, to }); }
        catch (e) { err = (e && e.message) || 'خطأ'; }
        if (!el.isConnected || seq !== panelSeq || panelKind !== 'file' || !host.isConnected) {return;}
        if (err) {host.innerHTML = `<p class="erp-text-sm erp-emp-bad">تعذر قراءة الكشف: ${esc(err)}</p>`; return;}
        host.innerHTML = attRangeHtml(rangeReportRows(res));
        attRangeReady(true);
    }

    /** ورقة الكشف: المؤشرات من ملخّص الخادم، وحالة اليوم من `lateMinutes`
     *  و`needsReview` لسجله — لا حساب وردية في المتصفح. أيام الغياب تظهر
     *  صفوفًا («لم يحضر») فلا يخفي الجدول نصف المعلومة. */
    function attRangeHtml(model) {
        const s = model.summary;
        const who = model.employee && model.employee.name ? String(model.employee.name) : '';
        const stat = (label, value) => `<span class="erp-emp-stat"><span class="erp-emp-stat__v erp-num" dir="ltr">${esc(value)}</span>`
            + `<span class="erp-emp-stat__l">${esc(label)}</span></span>`;
        const body = model.rows.map((r) => {
            // السقوط إلى «يحتاج مراجعة» لا إلى «لم يحضر»: حالةٌ لا يعرفها
            // القاموس تستدعي عينًا بشرية، لا تهمة غياب.
            const st = ATT_STATE[r.state] || ATT_STATE.review;
            const late = r.state === 'late' ? ` ${minutesToHM(r.lateMinutes)}` : '';
            return `<tr>
              <td class="erp-td"><span class="erp-num" dir="ltr">${esc(r.date)}</span></td>
              <td class="erp-td erp-text-muted">${esc(weekdayAr(r.date))}</td>
              <td class="erp-td"><span class="erp-num" dir="ltr">${esc(r.checkIn || '—')}</span></td>
              <td class="erp-td"><span class="erp-num" dir="ltr">${esc(r.checkOut || '—')}</span></td>
              <td class="erp-td"><span class="erp-num" dir="ltr">${esc(minutesToHM(r.minutes))}</span></td>
              <td class="erp-td"><span class="erp-badge" data-tone="${esc(st.tone)}">${esc(st.label)}${esc(late)}</span></td>
            </tr>`;
        }).join('') || `<tr><td class="erp-td" colspan="6">لا أيام في هذه الفترة</td></tr>`;
        const offDays = model.rows.filter((r) => r.state === 'day-off').length;
        const notes = [
            model.truncated ? `عرض أول ${formatInt(MAX_RANGE_DAYS)} يومًا من الفترة — ضيّق النطاق لرؤية الباقي.` : '',
            s.reviewDays > 0 ? `قيد المراجعة: ${formatInt(s.reviewDays)} يومًا (${minutesToHM(s.reviewMinutes)}) لا تدخل الإجمالي.` : '',
            offDays > 0 ? `راحة أسبوعية مجدولة: ${formatInt(offDays)} يومًا في هذه الفترة — بترميز اليوم المخزّن، لا تُعدّ غيابًا.` : '',
            'الحالة من حقل التأخير الذي يحسبه الخادم نفسه — نفس رقم شاشة الحضور.',
        ].filter(Boolean);
        return `<h4 class="erp-emp-sec">كشف <span class="erp-num" dir="ltr">${esc(s.from)}</span> — <span class="erp-num" dir="ltr">${esc(s.to)}</span>${who ? ` · ${esc(who)}` : ''}</h4>
          <div class="erp-emp-stats">
            ${stat('أيام حضور', formatInt(s.daysPresent))}
            ${stat('أيام مكتملة', formatInt(s.completeDays))}
            ${stat('أيام في الموعد', formatInt(s.onTimeDays))}
            ${stat('أيام تأخير', formatInt(s.lateDays))}
            ${stat('إجمالي التأخير', s.totalLateMinutes > 0 ? minutesToHM(s.totalLateMinutes) : '—')}
            ${stat('إجمالي الساعات', String(s.totalKarim))}
          </div>
          <div class="erp-table__scroll erp-emp-att__scroll">
            <table class="erp-table__grid">
              <thead><tr><th>التاريخ</th><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>الحالة</th></tr></thead>
              <tbody>${body}</tbody>
            </table>
          </div>
          <p class="erp-text-sm erp-text-muted">${notes.map((n) => esc(n)).join(' ')}</p>`;
    }

    /** البطاقة الرسمية (lux): يولّدها الخادم صفحةً مستقلّة، فتُكتب في نافذة
     *  فارغة تُفتح داخل نقرة المستخدم نفسها — وإلا حجبها المتصفح. نفس خطاف
     *  printLuxCard القديم (smart-card.js:702-714) حرفًا. */
    async function printLux() {
        if (!panelRow || panelKind !== 'file') {return;}
        const win = window.open('', '_blank');
        if (!win) {notify('اسمح بالنوافذ المنبثقة لطباعة البطاقة'); return;}
        try {
            const html = await fetchLuxCardHtml(panelRow.id);
            win.document.write(html);
            win.document.close();
        } catch (e) {
            try { win.close(); } catch (_) { /* أُغلقت */ }
            notify((e && e.message) || 'تعذر توليد البطاقة');
        }
    }

    /** The single print call of this screen. The QR card print narrows the
     *  paper with a body class and cleans it on afterprint (plus a timer,
     *  because Safari fires no afterprint for class-triggered prints). */
    function printNow() {
        window.print();
    }

    /**
     * شارة واحدة = ورقة واحدة. النقر على زري طباعة مختلفين قبل أن يعمل المؤقّت
     * كان يركّب الشارات فوق بعضها — unionٌ لم يحدّده أحد ويخفي ما لا ينبغي.
     * لكل نداءٍ طباعةٍ واحد تمسح أختَيها أولًا، فلا تصل الورقة إلا بشارةٍ واحدة.
     */
    const PRINT_MODES = ['erp-v2-print-card', 'erp-v2-print-empcard', 'erp-v2-print-dayrange'];
    function printMode(cls) {
        PRINT_MODES.forEach((c) => document.body.classList.remove(c));
        const cleanup = () => document.body.classList.remove(cls);
        document.body.classList.add(cls);
        window.addEventListener('afterprint', cleanup, { once: true });
        setTimeout(cleanup, 3000);
        printNow();
    }

    function printQrCard() {
        printMode('erp-v2-print-card');
    }

    /** طباعة البطاقة كاملة: الأداء والراتب والرمزين معًا — نفس نداء الطباعة
     *  الوحيد، وشارةُ body أوسع تقول للورقة ما تُبقيه. */
    function printEmpCard() {
        printMode('erp-v2-print-empcard');
    }

    /** طباعة كشف اليوم/الفترة وحده: الورقة تحمل الجدول والملخّص بلا رأسٍ
     *  ولا مؤشرات — نفس نداء الطباعة الوحيد وشارة body ثالثة. */
    function printAttRange() {
        printMode('erp-v2-print-dayrange');
    }

    /* ── Import panel (W2-2) ──────────────────────────────────────────── */
    function openImportPanel() {
        panelSeq += 1;
        panelKind = 'import';
        panelRow = null;
        panelData = null;
        setPanel(panelShell('استيراد الموظفين من Excel', 'file-text', `
          <p class="erp-text-sm erp-text-muted">الأعمدة: ${esc(EMP_SHEET_COLS.join('، '))}</p>
          <div class="erp-emp-warn" role="note">
            <i class="ji" data-i="alert-triangle" aria-hidden="true"></i>
            <span>تنبيه: الرقم الوظيفي الموجود مسبقًا سيُتخطى (لا تعديل) — الصفوف الناقصة (اسم/رقم) تُرفض في المعاينة قبل الاستيراد.</span>
          </div>
          <div>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-template>
              <i class="ji" data-i="download" aria-hidden="true"></i><span>تحميل القالب</span></button>
          </div>
          <label class="erp-emp-field"><span>اختر ملف Excel أو CSV</span>
            <input class="erp-input erp-no-print" type="file" accept=".xlsx,.xls,.csv" data-v2-import-file></label>
          <div data-v2-import-preview></div>
          <p class="erp-text-sm erp-text-muted" data-v2-import-progress role="status" aria-live="polite"></p>
          <div data-v2-import-result></div>
          <div data-v2-panel-msg role="alert" class="erp-text-sm"></div>
          <div class="erp-emp-panel__actions">
            <span class="erp-grow"></span>
            <button type="button" class="erp-btn" data-v2-panel-close>إلغاء</button>
            <button type="button" class="erp-btn erp-btn--primary" data-v2-import-run disabled>
              <i class="ji" data-i="upload" aria-hidden="true"></i><span>استيراد المعتمد</span>
            </button>
          </div>`));
    }

    async function downloadTemplate() {
        panelMsg('');
        const ready = await ensureXlsx();
        if (!el.isConnected || panelKind !== 'import') {return;}
        if (!ready) {panelMsg('تعذر تحميل مولد ملفات Excel — تحقق من الشبكة وأعد المحاولة'); return;}
        const wb = window.XLSX.utils.book_new();
        const ws = window.XLSX.utils.aoa_to_sheet(sheetTemplateRows());
        ws['!cols'] = EMP_SHEET_COLS.map(() => ({ wch: 20 }));
        window.XLSX.utils.book_append_sheet(wb, ws, 'الموظفون');
        window.XLSX.writeFile(wb, 'نموذج_استيراد_الموظفين.xlsx');
    }

    async function handleImportFile(file) {
        if (!file || panelKind !== 'import') {return;}
        panelMsg('');
        const host = panelEl.querySelector('[data-v2-import-preview]');
        if (host) {host.innerHTML = `<p class="erp-text-sm erp-text-muted">جارٍ قراءة الملف…</p>`;}
        const ready = await ensureXlsx();
        if (!el.isConnected || panelKind !== 'import') {return;}
        if (!ready) {
            if (host) {host.innerHTML = '';}
            panelMsg('تعذر تحميل قارئ ملفات Excel — تحقق من الشبكة وأعد المحاولة');
            return;
        }
        try {
            const buf = await file.arrayBuffer();
            const wb = window.XLSX.read(buf, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const data = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            const raw = data.filter((r, i) => i > 0 && (String(r[0]).trim() || String(r[1]).trim()));
            const model = buildSheetImport(raw, {
                existingIds: employeeIdSet(),
                departments: deptList,
                statusByLabel: statusLabelMap(),
            });
            if (!el.isConnected || panelKind !== 'import') {return;}
            panelData = model;
            renderImportPreview();
        } catch (_) {
            if (host) {host.innerHTML = `<p class="erp-text-sm erp-emp-bad">خطأ في قراءة الملف</p>`;}
        }
    }

    function renderImportPreview() {
        const host = panelEl.querySelector('[data-v2-import-preview]');
        const runBtn = panelEl.querySelector('[data-v2-import-run]');
        if (!host || !panelData || !panelData.rows) {return;}
        const list = panelData.rows;
        const c = panelData.counts;
        const badge = (x) => (x.err
            ? (x.err.includes('موجود') ? '<span class="erp-badge" data-tone="neutral">موجود</span>' : '<span class="erp-badge" data-tone="danger">مرفوض</span>')
            : '<span class="erp-badge" data-tone="success">جاهز</span>');
        host.innerHTML = `<div class="erp-text-sm">معاينة: ${formatInt(c.total)} صف —
            <span class="erp-emp-exp--ok">صالح: ${formatInt(c.ok)}</span> —
            <span class="erp-text-muted">موجود: ${formatInt(c.dup)}</span> —
            <span class="erp-emp-bad">مرفوض: ${formatInt(c.bad)}</span></div>
          <ul class="erp-emp-import-list">`
            + list.slice(0, 8).map((x) => `<li class="erp-emp-import-row">
                <span class="erp-mono" dir="ltr">${esc(x.id || '—')}</span>
                <span>${esc(x.name || '—')}</span>
                <span class="erp-text-muted">${esc(x.dept || '—')}</span>
                ${x.err ? `<small class="erp-emp-bad">${esc(x.err)}</small>` : ''}
                ${x.warn ? `<small class="erp-emp-exp--soon">${esc(x.warn)}</small>` : ''}
                ${badge(x)}
              </li>`).join('')
            + `</ul>`
            + (list.length > 8 ? `<p class="erp-text-sm erp-text-muted">... و${formatInt(list.length - 8)} صفوف أخرى</p>` : '');
        if (runBtn) {runBtn.disabled = c.ok === 0;}
    }

    async function runImport() {
        if (busy || panelKind !== 'import' || !panelData || !panelData.rows) {return;}
        const toSend = panelData.rows.filter((x) => !x.err);
        if (!toSend.length) {panelMsg('لا صفوف صالحة للاستيراد — ارفع الملف وعاين أولًا'); return;}
        const ok = await confirmFn(`استيراد ${toSend.length} موظف جديد؟`);
        if (!ok) {return;}
        busy = true;
        const runBtn = panelEl.querySelector('[data-v2-import-run]');
        if (runBtn) {runBtn.disabled = true;}
        const progress = panelEl.querySelector('[data-v2-import-progress]');
        const existingIds = employeeIdSet();
        let added = 0; let skipped = 0; const errs = [];
        for (const x of toSend) {
            if (existingIds.has(x.id)) {skipped += 1; continue;}
            try {
                await createEmployee(sheetRowToPayload(x, todayIso()));
                existingIds.add(x.id);
                added += 1;
            } catch (e) {
                errs.push(`${x.id}: ${(e && e.message) || 'فشل'}`);
            }
            if (progress && progress.isConnected) {
                progress.textContent = `جارٍ الاستيراد… ${formatInt(added + skipped + errs.length)} من ${formatInt(toSend.length)}`;
            }
        }
        busy = false;
        if (!el.isConnected) {return;}
        await reload();
        if (!el.isConnected) {return;}
        notify(`تم: ${added} جديد${skipped ? ` — تُخطي ${skipped} موجود` : ''}${errs.length ? ` — أخطاء: ${errs.length}` : ''}`);
        if (panelKind === 'import') {
            const result = panelEl.querySelector('[data-v2-import-result]');
            if (result) {
                result.innerHTML = `<p class="erp-text-sm">تم: ${formatInt(added)} جديد — تُخطي ${formatInt(skipped)} موجود — أخطاء: ${formatInt(errs.length)}</p>`
                    + (errs.length ? `<ul class="erp-emp-import-list">${errs.slice(0, 20).map((m) => `<li class="erp-emp-import-row erp-emp-bad">${esc(m)}</li>`).join('')}</ul>` : '');
            }
            if (progress) {progress.textContent = '';}
            const prev = panelEl.querySelector('[data-v2-import-preview]');
            if (prev) {prev.innerHTML = '';}
            if (runBtn && runBtn.isConnected) {runBtn.disabled = true;}
            panelData = { rows: [], counts: { total: 0, ok: 0, dup: 0, bad: 0 } };
        }
    }

    /* ── Export (W2-2) ────────────────────────────────────────────────── */
    async function exportRowsToXlsx() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        busy = true;
        try {
            const ready = await ensureXlsx();
            if (!el.isConnected) {return;}
            if (!ready) {notify('تعذر تحميل مولد ملفات Excel — تحقق من الشبكة وأعد المحاولة'); return;}
            const matrix = exportSheetRows(rows, rawById, deptByCode, { statusLabelOf: (v) => statusOf(v).label });
            const ws = window.XLSX.utils.aoa_to_sheet(matrix);
            ws['!cols'] = matrix[0].map(() => ({ wch: 20 }));
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, 'الموظفون');
            window.XLSX.writeFile(wb, `employees_${todayIso()}.xlsx`);
            notify(`تم التصدير — ${formatInt(rows.length)} موظفًا (${rows.length === allRows.length ? 'الدليل كله' : 'النتيجة المصفّاة'})`);
        } catch (e) {
            notify((e && e.message) || 'تعذر التصدير');
        } finally {
            busy = false;
        }
    }

    /* ── Photo pick (300px, legacy scale) ─────────────────────────────── */
    function downscalePhoto(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('read'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('img'));
                img.onload = () => {
                    const max = 300;
                    const scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
                    const w = Math.max(1, Math.round((img.width || max) * scale));
                    const h = Math.max(1, Math.round((img.height || max) * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', 0.85));
                };
                img.src = String(reader.result || '');
            };
            reader.readAsDataURL(file);
        });
    }

    async function handlePhotoPick(input) {
        const file = input && input.files && input.files[0];
        if (!file || panelKind !== 'form' || !panelData) {return;}
        const note = panelEl.querySelector('[data-v2-photo-note]');
        try {
            const dataUrl = await downscalePhoto(file);
            if (!el.isConnected || panelKind !== 'form' || !panelData) {return;}
            panelData.photo = dataUrl;
            const prev = panelEl.querySelector('[data-v2-photo-preview]');
            if (prev) {prev.innerHTML = `<img src="${esc(dataUrl)}" alt="">`;}
            if (note) {note.textContent = 'الصورة جاهزة — تُرفع مع الحفظ.';}
        } catch (_) {
            if (note && note.isConnected) {note.textContent = 'تعذر قراءة الصورة — جرّب ملفًا آخر.';}
        }
    }

    /* ── Wiring (delegated; no inline handlers) ───────────────────────── */
    el.addEventListener('click', (event) => {
        const expBtn = event.target.closest('[data-v2-expand]');
        if (expBtn) {
            const id = String(expBtn.dataset.v2Expand || '');
            if (id) {
                if (expandedIds.has(id)) {expandedIds.delete(id);}
                else {expandedIds.add(id);}
                paint();
                cardsHost.querySelector(`[data-v2-expand="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
            }
            return;
        }
        const viewBtn = event.target.closest('[data-v2-view]');
        if (viewBtn) {setView(viewBtn.dataset.v2View); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-print]')) {
            const printBtn = event.target.closest('[data-v2-print]');
            if (printBtn.getAttribute('data-v2-print') === 'card') {printEmpCard(); return;}
            printNow();
            return;
        }
        if (event.target.closest('[data-v2-clear]')) {
            searchEl.value = '';
            searchQuery = '';
            q('[data-v2-dept]').value = 'all';
            q('[data-v2-status]').value = 'all';
            paint();
            return;
        }
        // The table's own retry button clears the error but cannot refetch in
        // client mode — the host owns the data, so the refetch lives here.
        if (event.target.closest('[data-erp-retry]')) {reload(); return;}
        const act = event.target.closest('[data-v2-act]');
        if (act) {
            const row = allRows.find((r) => String(r.id) === String(act.getAttribute('data-id')));
            if (!row) {return;}
            const kind = act.getAttribute('data-v2-act');
            if (kind === 'file') {openFilePanel(row); return;}
            if (kind === 'edit' && canWrite) {openFormPanel(row); return;}
            if (kind === 'delete' && canWrite) {deleteRow(row); return;}
            return;
        }
        const newBtn = event.target.closest('[data-v2-new]');
        if (newBtn) {
            const kind = newBtn.getAttribute('data-v2-new');
            if (kind === 'add' && canWrite) {openFormPanel(null); return;}
            if (kind === 'import' && canWrite) {openImportPanel(); return;}
            return;
        }
        if (event.target.closest('[data-v2-export]')) {exportRowsToXlsx(); return;}
        if (event.target.closest('[data-v2-panel-close]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-submit]')) {submitForm(); return;}
        const qrBtn = event.target.closest('[data-v2-qr]');
        if (qrBtn) {
            const kind = qrBtn.getAttribute('data-v2-qr');
            if (kind === 'save' || kind === 'save-human') {
                const url = kind === 'save'
                    ? (panelData && panelData.qrUrl)
                    : (panelData && panelData.humanQrUrl);
                if (url) {
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `employee-${kind === 'save' ? 'qr' : 'data'}-${panelRow ? panelRow.code : ''}.png`;
                    a.click();
                }
                return;
            }
            if (kind === 'print') {printQrCard(); return;}
            if (kind === 'regen') {regenQr(); return;}
            return;
        }
        const attBtn = event.target.closest('[data-v2-att]');
        if (attBtn) {
            const kind = attBtn.getAttribute('data-v2-att');
            if (kind === 'print') {printAttRange(); return;}
            loadAttRange(kind);
            return;
        }
        if (event.target.closest('[data-v2-lux]')) {printLux(); return;}
        if (event.target.closest('[data-v2-template]')) {downloadTemplate(); return;}
        if (event.target.closest('[data-v2-import-run]')) {runImport();}
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-dept], [data-v2-status]')) {paint(); return;}
        if (event.target.matches('[data-v2-photo]')) {handlePhotoPick(event.target); return;}
        if (event.target.matches('[data-v2-import-file]')) {
            handleImportFile(event.target.files && event.target.files[0]);
        }
    });
    /* البحث محليٌّ على الدليل المحمَّل، فالتأخير حمايةٌ من إعادة الرسم لكل
     * حرفٍ لا توفيرٌ لشبكة. ١٦٠ مللي ثانية: أسرع من أن يحسّها كاتبٌ وأبطأ
     * من أن يرسم معه. زر «مسح» الصغير في نوع="search" يطلق input وحده.
     * «/» محجوزٌ لـ«لوحة الأوامر» (ui/enhancement.js:150) فلا يُخترَع اختصارُ
     * تركيزٍ ينافسها؛ Escape يُفرغ الصندوق ثم يتركه. */
    el.addEventListener('input', (event) => {
        const box = event.target;
        if (!box.matches || !box.matches('[data-v2-q]')) {return;}
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            searchQuery = box.value;
            paint();
        }, 160);
    });
    el.addEventListener('keydown', (event) => {
        const box = event.target;
        if (!box.matches || !box.matches('[data-v2-q]')) {return;}
        if (event.key === 'Enter') {
            event.preventDefault();
            clearTimeout(searchTimer);
            searchQuery = box.value;
            paint();
            const term = searchQuery.trim();
            if (!term) {return;}
            if (!rows.length) {notify(`لا نتيجة لـ«${term}» — جرّب جزءًا من الاسم أو رقم البصمة.`); return;}
            // نتيجة واحدة = القصد موظفٌ بعينه: تُفتح بطاقته كما كان يفعل القديم.
            if (rows.length === 1) {openFilePanel(rows[0]);}
            return;
        }
        if (event.key === 'Escape') {
            if (box.value) {
                event.preventDefault();
                clearTimeout(searchTimer);
                box.value = '';
                searchQuery = '';
                paint();
            } else {
                box.blur();
            }
        }
    });

    q('[data-v2-tools]').innerHTML = toolsSeg();
    paint();
    reload();

    return {
        el,
        reload,
        getRows: () => rows,
        destroy() {
            clearTimeout(searchTimer);
            table.destroy();
            el.remove();
        },
    };
}
