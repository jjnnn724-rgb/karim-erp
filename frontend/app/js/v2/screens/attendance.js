/**
 * V2 — Attendance screen · شاشة 01 في سجل الترحيل (قراءة + دورة كتابة W2-3)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHY ATTENDANCE FIRST
 *   The owner's closest subject, freshly root-caused data, and a table the
 *   preview already proves. The register reads /api/attendance/range; the
 *   write cycle mirrors features/hr.js:319-565 one door at a time — every
 *   write goes through v2/data/attendance-repo.js, carries a mandatory
 *   reason stored in the record's notes, and the server re-checks the role.
 *
 * WHAT THE SCREEN SHOWS (one language, no new components)
 *   • A period the manager can name without arithmetic: quick segments
 *     (اليوم / ٧ أيام / ٣٠ يومًا) that write the real date inputs, plus the
 *     inputs themselves for anything custom.
 *   • Six chips built by the repository from the loaded rows only, each with
 *     the definition of what it counts and a share whose denominator is
 *     stated. No chip carries a comparison nobody measured.
 *   • Punches per day as bars, grouped by the STORED date — the same string
 *     the rows below show.
 *   • The full register in EnterpriseDataTable (search, sort, paging).
 *   • The seven-tool bar of the live screen, same doors and sentences
 *     (features/hr.js:163-170 + :319-565): period gaps with the resolve
 *     panel (fill/excuse/swap), admin excuse, row correct, QR kiosk, Excel
 *     export, shift apply from punches, printable monthly sheet, strict
 *     audit, and the all-rows revert. attToolsFor decides visibility; the
 *     server decides execution.
 *
 * RULES THIS FILE FOLLOWS (per-screen contract, see js/v2/MIGRATION.md)
 *   • No network of its own — every call goes through
 *     v2/data/attendance-repo.js (endpoint contract cited there). The kiosk
 *     camera is Html5Qrcode fetched on first use (vendor.js); legacy
 *     scanner.js is never referenced — V2 does not load it.
 *   • No inline handlers: all listeners are addEventListener, delegated on
 *     this screen's own root, created per mount so re-mounting cannot
 *     double-bind.
 *   • Every write button hides by role here and is re-checked by the server;
 *     every write carries a mandatory reason stored with the actor's name
 *     and date (auditNote/joinNotes), and one click cannot start two writes
 *     (saving guard). The camera belongs to the panel: any panel open/close
 *     stops a running lens, and destroy() stops it too.
 *   • Exactly one print call site: the monthly sheet rides a body class set
 *     before that call and removed after it (afterprint + safety timer).
 *   • Names come from /api/employees joined client-side — exactly like
 *     features/hr.js does with STATE. If the names call fails, rows still
 *     render as #id (stated in the UI), never as invented names. Department
 *     labels join the same way through /api/hrDepartments; if that call
 *     fails the stored code is shown, muted and labelled as a code.
 *   • Filter options are derived from the rows that loaded, never from a
 *     hard-coded list; a filter that hides rows renames the scope the chips
 *     are taken over, so a subset never reads as the whole period.
 *   • State presentation follows the repo rule: only on_leave (stored)
 *     becomes a badge; derived states are tone dots + Arabic text; missing
 *     punches are muted text.
 *   • Loading/error guards: a click cannot start two reloads, and an
 *     in-flight response never touches a destroyed screen.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.152';
import { statusBadge } from '../status.js?v=4.9.152';
import { ensureHtml5Qrcode, ensureXlsx } from '../vendor.js?v=4.9.152';
import {
    attendanceToRow, ATTENDANCE_STATE_AR, PERIODS,
    fetchAttendanceRange, buildAttendanceKpis, buildAttendanceLegend,
    buildPunchBars, applyAttendanceFilters, distinctValues, formatInt,
    periodRange, todayIso, spanDays,
    attToolsFor, seesFullPeriod, buildAttendanceGaps, filterGaps, GAPS_CAP,
    buildExportMatrix, exportFileName, parseScanPayload, scanAttendance,
    scanResultText, revertInferred, revertResultText, REVERT_INFERRED_CONFIRM,
    updateAttendance, createAttendance, createApprovedLeave,
    buildExcusePayload, buildAttendanceCreate,
    calcPunchTimes, shiftStartFor, fetchWorkStartHour,
    auditNote, joinNotes, validateReason,
    attWriteVisible, validatePunchForm, buildTodayExceptions,
    validateShiftsText, suggestShiftLines, withSuggestedLines, formatShiftsResult,
    monthOf, fetchShiftsAnalysis, applyShifts,
    fetchStrictAudit, summarizeAudit,
    fetchMonthlyAttendance, buildMonthlySheet, minutesToHM,
} from '../data/attendance-repo.js?v=4.9.152';
import { fetchEmployees, employeeMap, fetchDepartments, departmentMap } from '../data/employees-repo.js?v=4.9.152';
import { fetchLeaveWorkflow } from '../data/leaves-repo.js?v=4.9.152';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Tokens, not hexes — a theme switch must not break the legend. */
const TONE_VAR = {
    success: 'var(--erp-success)',
    info: 'var(--erp-info)',
    warning: 'var(--erp-warning)',
    danger: 'var(--erp-danger)',
    neutral: 'var(--erp-neutral)',
};

/** Local YYYY-MM-DD on the device calendar (repo keeps the same basis). */
function isoDay(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Arabic calendar sentence for the range, Gregorian + Latin digits so the
 *  numbers match the table below it. Falls back to the raw ISO pair. */
function arabicRange(from, to) {
    const fmt = (iso) => {
        try {
            const [y, m, d] = String(iso).split('-').map(Number);
            return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',
                { day: 'numeric', month: 'long', year: 'numeric' })
                .format(new Date(y, m - 1, d));
        } catch { return String(iso); }
    };
    if (from === to) {return fmt(from);}
    return `${fmt(from)} ← ${fmt(to)}`;
}

function stateCell(row) {
    if (row.state === 'leave') {return statusBadge('leave', 'approved');}
    if (row.state === 'late') {
        return `<span class="erp-row-wrap"><span class="erp-dot erp-dot--warning" aria-hidden="true"></span><span>متأخر</span></span>`;
    }
    if (row.state === 'early') {
        return `<span class="erp-row-wrap"><span class="erp-dot erp-dot--warning" aria-hidden="true"></span><span>انصراف مبكر</span></span>`;
    }
    if (row.state === 'missing') {
        return `<span class="erp-row-wrap"><span class="erp-dot erp-dot--info" aria-hidden="true"></span><span>بصمة ناقصة</span></span>`;
    }
    if (row.state === 'none') {return `<span class="erp-text-muted">لا بصمات</span>`;}
    return `<span class="erp-text-muted">حاضر</span>`;
}

function employeeCell(row) {
    if (row.nameResolved) {return esc(row.employee);}
    // An unresolved id is a fact about the join, not a name to guess.
    return `<span class="erp-text-muted" title="لم تُحلّ هوية هذا الرقم — الأسماء من /api/employees">${esc(row.employee)}</span>`;
}

function deptCell(row) {
    if (row.deptResolved || row.dept === '—') {return esc(row.dept);}
    return `<span class="erp-text-muted" title="كود القسم كما هو في السجل">${esc(row.dept)}</span>`;
}

/**
 * صندوق استثناءات اليوم (W2): غياب/تأخير/انصراف مبكر/بصمة ناقصة في مكان
 * واحد، من دالة العقد `buildTodayExceptions` ونصوصها نفسها (hr.js:281-303).
 * صفر لون خام: الشارات بسمة `data-tone` وحدها، والصندوق يستعمل أصناف
 * `erp-card`/`erp-table__grid` القائمة — لا CSS جديد لهذه الإضافة.
 * @param {{rows:any[],date:string,weekday:string,open:number,excused:number}} data
 * @param {{withAction?:boolean, deptByCode?:Map<string,any>}} [opts]
 * @returns {string}
 */
function todayBlock(data, opts = {}) {
    const rows = Array.isArray(data && data.rows) ? data.rows : [];
    const deptByCode = opts.deptByCode instanceof Map ? opts.deptByCode : new Map();
    const deptOf = (emp) => {
        const code = String((emp && emp.department) ?? '');
        const d = deptByCode.get(code);
        return (d && d.name) ? String(d.name) : (code || '—');
    };
    const head = `<div class="erp-card__head">`
        + `<h3 class="erp-card__title">استثناءات اليوم <span class="erp-eyebrow" dir="ltr" lang="en">Today</span>`
        + `<span class="erp-text-muted erp-text-sm">${esc((data && data.weekday) || '')} · <span dir="ltr">${esc((data && data.date) || '')}</span></span></h3>`
        + `<span class="erp-grow"></span>`
        + `<span class="erp-text-sm erp-text-muted">مفتوح <b class="erp-tnum">${formatInt((data && data.open) || 0)}</b>`
        + ` · معذور <b class="erp-tnum">${formatInt((data && data.excused) || 0)}</b></span>`
        + `</div>`;
    if (!rows.length) {
        return `<section class="erp-card erp-no-print" data-v2-today-card>${head}`
            + `<div class="erp-card__body"><p class="erp-text-sm erp-text-muted">لا استثناءات اليوم — البصمات مكتملة.</p></div></section>`;
    }
    const body = `<div class="erp-table__scroll" style="max-height:280px;overflow:auto">`
        + `<table class="erp-table__grid"><thead><tr>`
        + `<th>الموظف</th><th>القسم</th><th>النوع</th><th>التفصيل</th><th>الساعات</th>${opts.withAction ? '<th></th>' : ''}`
        + `</tr></thead><tbody>`
        + rows.map((r) => `<tr${r.type === 'absent' ? ' class="erp-tr--danger"' : ''}>`
            + `<td class="erp-td"><b>${esc((r.emp && r.emp.name) || '')}</b>${r.excused ? ' <span class="erp-text-muted">(معذور)</span>' : ''}</td>`
            + `<td class="erp-td erp-text-muted">${esc(deptOf(r.emp))}</td>`
            + `<td class="erp-td"><span class="erp-badge" data-tone="${esc(r.tone || 'neutral')}">${esc(r.label || '')}</span></td>`
            + `<td class="erp-td erp-text-muted" dir="ltr">${esc(r.detail || '')}</td>`
            + `<td class="erp-td erp-tnum" dir="ltr">${esc(r.hours || '—')}</td>`
            + `${opts.withAction ? `<td class="erp-td">${r.excused ? '' : `<button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-resolve="${esc(String((r.emp && r.emp.id) ?? ''))}|${esc((data && data.date) || '')}" aria-label="معالجة ${esc((r.emp && r.emp.name) || '')}">معالجة</button>`}</td>` : ''}`
            + `</tr>`).join('')
        + `</tbody></table></div>`;
    return `<section class="erp-card erp-no-print" data-v2-today-card>${head}<div class="erp-card__body">${body}</div></section>`;
}

/** One chip: number, what it counts, and the share it belongs to. */
function kpiStrip(kpis, scopeLabel) {
    return `<ul class="erp-kpis" aria-label="مؤشرات ${esc(scopeLabel)} — مشتقة من السجلات المعروضة">`
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

function barsBlock(bars) {
    if (!bars.length) {
        return `<div class="erp-state" role="status">
          <span class="erp-state__title">لا بصمات في هذه الفترة</span>
          <span>وسّع المدى الزمني أو تحقق من مزامنة أجهزة البصمة.</span>
        </div>`;
    }
    const max = Math.max(...bars.map((b) => b.records), 1);
    const aria = `بصمات الأيام، أكثر يوم ${formatInt(max)} سجلًا`;
    return `<div class="erp-bars" role="img" aria-label="${esc(aria)}">`
        + bars.map((b) => `
        <div class="erp-bar${b.records === max ? ' erp-bar--max' : ''}">
          <span class="erp-bar__val"><span class="erp-num" dir="ltr">${formatInt(b.records)}</span></span>
          <span class="erp-bar__track" style="block-size:${Math.max(8, Math.round((b.records / max) * 110))}px"
                title="${esc(`${b.date}: ${formatInt(b.inCount)} دخول · ${formatInt(b.outCount)} خروج · ${formatInt(b.late)} متأخر`)}"></span>
          <span class="erp-bar__day">${esc(b.label)}</span>
        </div>`).join('')
        + `</div>`;
}

function legendBlock(legend) {
    return `<ul class="erp-legend">`
        + legend.map((l) => `<li>
            <span class="erp-legend__dot" style="background:${TONE_VAR[l.tone] || TONE_VAR.neutral}" aria-hidden="true"></span>
            <span>${esc(l.label)}</span>
            <span class="erp-legend__val"><span class="erp-num" dir="ltr">${formatInt(l.count)}</span> · ${esc(l.pill.text)}</span>
          </li>`).join('')
        + `</ul>`;
}

/** The period control: quick segments only. The date inputs live outside
 *  this node so a repaint can never throw away the manager's focus. */
function segBlock(activeKind) {
    return `<div class="erp-seg" role="group" aria-label="الفترة">`
        + `<span class="erp-seg__label">الفترة</span>`
        + Object.keys(PERIODS).map((kind) => {
            const on = kind === activeKind;
            return `<button type="button" data-v2-period="${esc(kind)}"${on ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(PERIODS[kind].seg)}</button>`;
        }).join('')
        + `</div>`;
}

function periodKindFor(from, to) {
    const today = todayIso();
    for (const kind of Object.keys(PERIODS)) {
        const r = periodRange(kind, today);
        if (r && r.from === from && r.to === to) {return kind;}
    }
    return null;
}

function template(from, to) {
    return `
      <div class="erp-v2-attendance" data-v2-attendance>
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">الحضور والانصراف
              <span class="erp-eyebrow" dir="ltr" lang="en">Attendance</span>
            </h2>
            <div class="erp-dash-sub" data-v2-period-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <span data-v2-periodseg>${segBlock(periodKindFor(from, to))}</span>
            <span class="erp-filterbar erp-no-print">
              <label class="erp-text-sm erp-text-muted" for="v2att-from">من</label>
              <input class="erp-input erp-input--ltr" id="v2att-from" type="date" value="${esc(from)}" max="${esc(todayIso())}">
              <label class="erp-text-sm erp-text-muted" for="v2att-to">إلى</label>
              <input class="erp-input erp-input--ltr" id="v2att-to" type="date" value="${esc(to)}" max="${esc(todayIso())}">
            </span>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-print aria-label="طباعة">
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
            <span data-v2-tools></span>
          </div>
        </div>

        <div data-v2-kpis></div>

        <div data-v2-today></div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">بصمات الأيام
              <span class="erp-eyebrow" dir="ltr" lang="en">Punches By Day</span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted" data-v2-days-note></span>
          </div>
          <div class="erp-card__body">
            <div data-v2-bars></div>
            <div data-v2-legend></div>
            <div class="erp-filterbar" style="margin-block-start:var(--erp-space-4)">
              <label class="erp-text-sm erp-text-muted" for="v2att-dept">القسم</label>
              <select class="erp-select" id="v2att-dept" data-v2-dept>
                <option value="all">كل الأقسام</option>
              </select>
              <label class="erp-text-sm erp-text-muted" for="v2att-state">الحالة</label>
              <select class="erp-select" id="v2att-state" data-v2-state>
                <option value="all">كل الحالات</option>
                ${Object.keys(ATTENDANCE_STATE_AR).map((s) => `<option value="${esc(s)}">${esc(ATTENDANCE_STATE_AR[s])}</option>`).join('')}
              </select>
              <button type="button" class="erp-btn erp-btn--ghost erp-btn--sm" data-v2-clear hidden>
                <i class="ji" data-i="x" aria-hidden="true"></i><span>مسح التصفية</span>
              </button>
            </div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">سجل الحضور
              <span class="erp-eyebrow" dir="ltr" lang="en">Register</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted">
              قراءة السجل من نفس واجهة النظام الحالي
              (<span class="erp-addr" dir="ltr">/api/attendance/range</span>)،
              ورؤساء الأقسام يرون أقسامهم فقط بقرار من الخادم. الكتابة من
              الأزرار المحكومة بالأدوار أعلاه — كل إجراء يحمل سببًا إجباريًا
              يُخزَّن في ملاحظات السجل باسمك، والخادم يعيد فحص الدور قبل التنفيذ.
              <span data-v2-names-note hidden>تعذّر تحميل الأسماء — تُعرض أرقام الموظفين.</span>
              <span data-v2-dept-note hidden>تعذّر تحميل أسماء الأقسام — تُعرض أكوادها.</span>
            </p>
            <p class="erp-text-sm erp-text-muted" data-v2-filter-note hidden></p>
            <p class="erp-print-note" data-v2-print-note></p>
            <div data-v2-table></div>
          </div>
        </section>

        <section class="erp-card" data-v2-gaps-wrap hidden>
          <div class="erp-card__head">
            <h3 class="erp-card__title">نواقص الفترة
              <span class="erp-eyebrow" dir="ltr" lang="en">Gaps</span>
            </h3>
            <span class="erp-grow"></span>
            <input class="erp-input erp-no-print" data-v2-gaps-q placeholder="بحث بالاسم أو الكود..." aria-label="بحث النواقص" style="max-width:220px">
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-gaps-x>إخفاء</button>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted" data-v2-gaps-note></p>
            <div data-v2-gaps></div>
          </div>
        </section>

        <div data-v2-toolpanel></div>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountAttendanceScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 attendance]', m);
    const tools = attToolsFor(ctx.role);
    const canResolve = tools.some((t) => t.id === 'gaps');
    /* الأدوار الثلاثة التي يقبلها الخادم كتابةً (server.js:1778) — هي مرجع
       الأزرار الكتابية، و`canResolve` يشترط أن أداة النواقص ظاهرة أصلًا.
       الاثنان يتفقان على كل دور مُشحون، فالربط يوثّق المصدر ولا يغيّر سلوكًا. */
    const canWrite = canResolve && attWriteVisible(ctx.role);

    let allRows = [];
    let rows = [];
    let loading = false;
    let refsLoaded = false;
    let empById = new Map();
    let deptByCode = new Map();
    let namesOk = true;

    host.insertAdjacentHTML('beforeend', template(isoDay(-6), isoDay(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const countEl = q('[data-v2-count]');
    const periodLine = q('[data-v2-period-line]');
    const kpisHost = q('[data-v2-kpis]');
    const barsHost = q('[data-v2-bars]');
    const legendHost = q('[data-v2-legend]');
    const daysNote = q('[data-v2-days-note]');
    const filterNote = q('[data-v2-filter-note]');
    const printNote = q('[data-v2-print-note]');
    const namesNote = q('[data-v2-names-note]');
    const deptNote = q('[data-v2-dept-note]');
    const clearBtn = q('[data-v2-clear]');

    const table = createDataTable({
        caption: 'سجل الحضور والانصراف — بيانات حية',
        mode: 'client',
        pageSize: 20,
        stickyHeader: true,
        emptyMessage: 'لا توجد سجلات في الفترة المحددة',
        emptyHint: 'وسّع الفترة أو تحقق من صلاحية العرض.',
        rowKey: (row) => row.id,
        columns: [
            { key: 'employee', header: 'الموظف', sortable: true, filterable: true, render: employeeCell },
            { key: 'dept', header: 'القسم', sortable: true, filterable: true, width: '130px', render: deptCell },
            { key: 'date', header: 'التاريخ', sortable: true, filterable: true, width: '120px', align: 'center', className: 'erp-tnum' },
            { key: 'in', header: 'الدخول', width: '96px', align: 'center', className: 'erp-tnum' },
            { key: 'out', header: 'الخروج', width: '96px', align: 'center', className: 'erp-tnum' },
            {
                key: 'minutes', header: 'الدقائق', type: 'number', sortable: true,
                width: '100px', align: 'end', className: 'erp-tnum',
                value: (row) => (row.minutes === null ? -1 : row.minutes),
                render: (row) => (row.minutes === null
                    ? `<span class="erp-text-muted">—</span>`
                    : `<span class="erp-num" dir="ltr">${esc(row.minutes)}</span>`),
            },
            { key: 'source', header: 'المصدر', sortable: true, filterable: true, width: '120px' },
            {
                key: 'state', header: 'الحالة', sortable: true, filterable: true, width: '150px',
                value: (row) => ATTENDANCE_STATE_AR[row.state] || row.state,
                render: (row) => stateCell(row),
            },
            ...(canWrite ? [{
                key: 'actions', header: 'تصحيح', width: '110px',
                render: (row) => (row.id === undefined || row.id === null ? '—'
                    : `<button type="button" class="erp-btn erp-btn--sm" data-v2-correct="${esc(String(row.id))}" aria-label="تصحيح سجل ${esc(row.date)}">تصحيح</button>`),
            }] : []),
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    /* ── Filters ──────────────────────────────────────────────────────── */
    function deptOptions() {
        const keep = q('[data-v2-dept]').value;
        const list = distinctValues(allRows, 'dept');
        q('[data-v2-dept]').innerHTML = `<option value="all">كل الأقسام</option>`
            + list.map((d) => `<option value="${esc(d)}"${d === keep ? ' selected' : ''}>${esc(d)}</option>`).join('');
    }

    function filters() {
        return { dept: q('[data-v2-dept]').value, state: q('[data-v2-state]').value };
    }

    function filtered() {
        const f = filters();
        return applyAttendanceFilters(allRows, f);
    }

    /* ── Paint ────────────────────────────────────────────────────────── */
    function paint() {
        const from = q('#v2att-from').value;
        const to = q('#v2att-to').value;
        const f = filters();
        const filtering = (f.dept && f.dept !== 'all') || (f.state && f.state !== 'all');
        rows = filtering ? filtered() : allRows;

        const span = spanDays(from, to);
        const scope = filtering ? 'النتيجة المصفّاة' : `الفترة (${formatInt(span)} يومًا)`;
        periodLine.textContent = `${arabicRange(from, to)} · ${formatInt(allRows.length)} سجلًا`;

        kpisHost.innerHTML = kpiStrip(buildAttendanceKpis(rows, { scope }), scope);

        const bars = buildPunchBars(rows);
        barsHost.innerHTML = barsBlock(bars);
        legendHost.innerHTML = legendBlock(buildAttendanceLegend(rows));
        const days = distinctValues(rows, 'date').length;
        daysNote.textContent = bars.length < days ? `آخر ${formatInt(bars.length)} يومًا من ${formatInt(days)}` : '';

        table.setRows(rows);
        countEl.textContent = `(${formatInt(rows.length)})`;

        clearBtn.hidden = !filtering;
        filterNote.hidden = !filtering;
        if (filtering) {
            filterNote.textContent = `التصفية نشطة (${[f.dept !== 'all' && `قسم: ${f.dept}`, f.state !== 'all' && ATTENDANCE_STATE_AR[f.state]]
                .filter(Boolean).join(' · ')}) — المؤشرات والأشرطة محسوبة على ${formatInt(rows.length)} من ${formatInt(allRows.length)} سجلًا.`;
        }
        printNote.textContent = `الحضور ${arabicRange(from, to)} — المطبوعة تعرض الصفحة الحالية من الجدول (${formatInt(rows.length)} سجلًا في الإجمالي).`;
        paintTodayLeaves();
    }

    /* ── Load ─────────────────────────────────────────────────────────── */
    async function ensureRefs() {
        if (refsLoaded || !namesOk) {return;}
        // Two independent joins, both optional for the register: a failed
        // name call shows #id, a failed department call shows the code.
        const [emps, depts] = await Promise.allSettled([fetchEmployees(), fetchDepartments()]);
        if (emps.status === 'fulfilled') {
            empById = employeeMap(emps.value);
        } else {
            namesOk = false;
            namesNote.hidden = false;
            notify(`تعذّر تحميل أسماء الموظفين: ${(emps.reason && emps.reason.message) || 'خطأ'}`, 'error');
        }
        if (depts.status === 'fulfilled' && depts.value.length) {
            deptByCode = departmentMap(depts.value);
        } else {
            deptNote.hidden = false;
        }
        refsLoaded = empById.size > 0 || deptByCode.size > 0;
    }

    async function reload() {
        if (loading) {return;}
        const from = q('#v2att-from').value;
        const to = q('#v2att-to').value;
        loading = true;
        table.setLoading(true);
        try {
            await ensureRefs();
            const res = await fetchAttendanceRange({ from, to });
            if (!el.isConnected) {return;}          // destroyed while in flight
            rawRows = Array.isArray(res.rows) ? res.rows : [];
            allRows = rawRows.map((r) => attendanceToRow(r, empById, deptByCode));
            deptOptions();
            paint();
            if (gapsOpen) {await openGaps();}
            if (!allRows.length) {notify('لا سجلات في هذه الفترة.');}
        } catch (e) {
            if (!el.isConnected) {return;}
            allRows = [];
            rows = [];
            table.setRows([]);
            kpisHost.innerHTML = '';
            barsHost.innerHTML = '';
            const todayHost = q('[data-v2-today]');
            if (todayHost) {todayHost.innerHTML = '';}
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : `تعذّر تحميل الحضور: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading = false;
        }
    }

    function applyPeriod(kind) {
        const r = periodRange(kind, todayIso());
        if (!r) {return;}
        q('#v2att-from').value = r.from;
        q('#v2att-to').value = r.to;
        paintSeg(periodKindFor(r.from, r.to));
        reload();
    }

    function paintSeg(activeKind) {
        q('[data-v2-periodseg]').innerHTML = segBlock(activeKind);
    }

    /* ── Tools: gaps + resolve/excuse/fill + kiosk + export (W2 write) ──
     *  Same doors and sentences as features/hr.js:319-565. Register above
     *  stays read-only; every write travels its own door with a mandatory
     *  reason, and the server re-checks the role. */

    let rawRows = [];
    let leavesCache = null;
    let gapsOpen = false;
    let gapsQuery = '';
    let gapsData = { rows: [], total: 0, counts: {}, truncated: false, cappedAt: GAPS_CAP };
    let saving = false;
    let resolveTarget = null; // {empId, date, rec}

    const toolNotify = (m, k) => notify(m, k);
    const say = (m) => toolNotify(m);

    q('[data-v2-tools]').innerHTML = tools.map((t) =>
        `<button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-tool="${esc(t.id)}" aria-label="${esc(t.label)}">`
        + `<i class="ji" data-i="${esc(t.icon)}" aria-hidden="true"></i><span>${esc(t.label)}</span></button>`).join('')
        + (canWrite ? `<button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-excuse-new aria-label="عذر إداري جديد"><i class="ji" data-i="file-text" aria-hidden="true"></i><span>عذر إداري</span></button>` : '');

    el.addEventListener('input', (event) => {
        if (event.target.matches('[data-v2-gaps-q]')) {
            gapsQuery = event.target.value || '';
            paintGaps();
        }
    });

    async function ensureLeaves() {
        if (!leavesCache) {
            try {leavesCache = await fetchLeaveWorkflow();}
            catch {leavesCache = [];}
            if (!Array.isArray(leavesCache)) {leavesCache = []; }
        }
        return leavesCache;
    }

    function employeesList() {
        return [...empById.values()];
    }

    function paintGaps() {
        const wrap = q('[data-v2-gaps-wrap]');
        if (!gapsOpen) {wrap.hidden = true; return;}
        wrap.hidden = false;
        const list = filterGaps(gapsData.rows, gapsQuery);
        const c = gapsData.counts || {};
        q('[data-v2-gaps-note]').textContent =
            `${formatInt(gapsData.total)} ناقصًا — لم يحضر: ${formatInt(c.absent || 0)} · نسي خروج: ${formatInt(c.missOut || 0)} · نسي دخول: ${formatInt(c.missIn || 0)}`
            + (gapsData.truncated ? ` — أول ${formatInt(gapsData.cappedAt)} معروضة، ضيّق الفترة` : '')
            + (seesFullPeriod(ctx.role) ? '' : ' — سجلاتك المحمّلة وحدها مصدر الحقيقة');
        q('[data-v2-gaps]').innerHTML = `<div class="erp-table__scroll" style="max-height:380px;overflow:auto"><table class="erp-table__grid"><thead><tr><th>التاريخ</th><th>اليوم</th><th>الموظف</th><th>النوع</th><th>الحضور</th><th>الانصراف</th><th></th></tr></thead><tbody>`
            + (list.map((g) => `<tr${g.type === 'absent' ? ' class="erp-tr--danger"' : ''}>`
                + `<td class="erp-td erp-text-muted">${esc(g.date)}</td>`
                + `<td class="erp-td"><b>${esc(g.weekday || '')}</b>${g.weeklyOff ? ' <span class="erp-text-muted">(راحة)</span>' : ''}</td>`
                + `<td class="erp-td"><b>${esc((g.emp && g.emp.name) || '')}</b></td>`
                + `<td class="erp-td"><span class="erp-badge" data-tone="${esc(g.tone || 'neutral')}">${esc(g.label || '')}</span></td>`
                + `<td class="erp-td erp-mono" dir="ltr">${esc((g.rec && g.rec.checkIn) || '—')}</td>`
                + `<td class="erp-td erp-mono" dir="ltr">${esc((g.rec && g.rec.checkOut) || '—')}</td>`
                + `<td class="erp-td">${canWrite ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-resolve="${esc(String((g.emp && g.emp.id) ?? ''))}|${esc(g.date)}">معالجة</button>` : ''}</td></tr>`).join('')
                || '<tr><td class="erp-td" colspan="7">لا نواقص — الفترة مقفلة</td></tr>')
            + `</tbody></table></div>`;
    }

    async function openGaps() {
        gapsOpen = true;
        paintGaps();
        q('[data-v2-gaps]').innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ حساب النواقص…</p>';
        try {
            const leaves = await ensureLeaves();
            if (!el.isConnected) {return;}
            const from = q('#v2att-from').value;
            const to = q('#v2att-to').value;
            gapsData = buildAttendanceGaps({
                records: rawRows, employees: employeesList(), leaves,
                from, to, todayStr: todayIso(), full: seesFullPeriod(ctx.role),
            });
            if (!el.isConnected) {return;}
            paintGaps();
        } catch (e) {
            if (!el.isConnected) {return;}
            q('[data-v2-gaps]').innerHTML = `<p class="erp-text-sm erp-text-muted">تعذّر حساب النواقص: ${esc((e && e.message) || 'خطأ')}</p>`;
        }
    }

    /* ── استثناءات اليوم ────────────────────────────────────────────────
     *  صندوق واحد يجمع غياب/تأخير/انصراف مبكر/بصمة ناقصة لليوم الجاري من
     *  دالة العقد `buildTodayExceptions`. لا يُرسم إلا إذا كانت الفترة
     *  المحمّلة تشمل اليوم — وإلا لبدا كل موظف «غائبًا» عن يومٍ لم نجلبه. */
    let leavesRequested = false;

    function paintToday() {
        const host = q('[data-v2-today]');
        if (!host) {return;}
        const today = todayIso();
        const from = q('#v2att-from').value;
        const to = q('#v2att-to').value;
        if (today < from || today > to) {
            host.innerHTML = `<section class="erp-card erp-no-print"><div class="erp-card__body">`
                + `<p class="erp-text-sm erp-text-muted">استثناءات اليوم خارج الفترة المختارة (<span dir="ltr">${esc(today)}</span>) — وسّع الفترة لتشمل اليوم لعرضها.</p>`
                + `</div></section>`;
            return;
        }
        const now = new Date();
        const data = buildTodayExceptions({
            records: rawRows, employees: employeesList(), leaves: leavesCache || [],
            todayStr: today, full: seesFullPeriod(ctx.role),
            // «حتى الآن» في عمود الساعات لا تعمل بلا الساعة: بغيابها تُقرأ
            // البصمة الناقصة صفرًا بينما صاحبها في دوامه.
            nowMinutes: now.getHours() * 60 + now.getMinutes(),
        });
        host.innerHTML = todayBlock(data, { withAction: canWrite, deptByCode });
    }

    /** الأعذار تُطلب مرة واحدة: العذر يحوّل استثناءً إلى «معذور»، وإلا
     *  عُرض رغم اعتماده. نفس باب الشاشة السابقة (leave-workflow) والمخزّن
     *  مشترك مع صندوق النواقص، فلا نداء ثانٍ. */
    function paintTodayLeaves() {
        paintToday();
        if (leavesCache || leavesRequested) {return;}
        leavesRequested = true;
        ensureLeaves().then(() => {
            if (el.isConnected) {paintToday();}
        }).catch(() => { /* ensureLeaves لا ترفض أصلًا — حزام أمان */ });
    }

    /* الكاميرا ملك اللوحة: أي فتح أو إغلاق يُطفئ الجلسة السابقة، فلا تبقى
       عدسة تعمل تحت لوحة الورديات ولا بعد مغادرة الشاشة. */
    let scanner = null;
    let scanRunning = false;

    function stopScan() {
        const inst = scanner;
        const wasRunning = scanRunning;
        scanner = null;
        scanRunning = false;
        if (!inst) {return;}
        try {
            const p = wasRunning ? inst.stop() : Promise.resolve();
            p.then(() => inst.clear()).catch(() => {});
        } catch { /* إغلاق الكاميرا لا يوقف الشاشة */ }
    }

    function closePanel() {
        stopScan();
        q('[data-v2-toolpanel]').innerHTML = '';
        resolveTarget = null;
    }

    function panelMsg(t) {
        say(t);
    }

    function openResolve(empId, date) {
        stopScan();
        const emp = empById.get(String(empId));
        const rec = rawRows.find((a) => String(a.employeeId) === String(empId) && String(a.date) === String(date));
        resolveTarget = { empId: String(empId), date, rec: rec || null };
        const others = employeesList().filter((e) => e.status === 'active' && String(e.id) !== String(empId))
            .map((e) => `<option value="${esc(String(e.id))}">${esc(e.name)}</option>`).join('');
        q('[data-v2-toolpanel]').innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title">معالجة — ${esc((emp && emp.name) || '')} <span class="erp-text-muted">${esc(date)}</span></h3>`
            + `<span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-x>إغلاق</button></div>`
            + `<div class="erp-card__body erp-stack">`
            + `<p class="erp-text-sm erp-text-muted">الحالي: حضور <b dir="ltr">${esc((rec && rec.checkIn) || '—')}</b> · انصراف <b dir="ltr">${esc((rec && rec.checkOut) || '—')}</b></p>`
            + `<div class="erp-dash-controls"><label class="erp-text-sm erp-text-muted">نوع المعالجة</label>`
            + `<select class="erp-select" data-v2-res-type><option value="fill">تعبئة البصمة الناقصة</option><option value="excuse">عذر معتمد</option><option value="swap">تبديل وردية</option></select></div>`
            + `<div data-v2-res-fill><div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">بصمة الحضور</label><input class="erp-input erp-input--ltr" type="time" data-v2-res-in value="${esc((rec && rec.checkIn) || '')}" dir="ltr">`
            + `<label class="erp-text-sm erp-text-muted">بصمة الانصراف</label><input class="erp-input erp-input--ltr" type="time" data-v2-res-out value="${esc((rec && rec.checkOut) || '')}" dir="ltr">`
            + `</div></div>`
            + `<div data-v2-res-swap hidden><div class="erp-dash-controls"><label class="erp-text-sm erp-text-muted">تبديل مع الموظف</label>`
            + `<select class="erp-select" data-v2-res-with><option value="">اختر...</option>${others}</select></div></div>`
            + `<div class="erp-dash-controls"><label class="erp-text-sm erp-text-muted">السبب (إجباري)</label>`
            + `<input class="erp-input" data-v2-res-reason placeholder="مثال: نسي البصمة — ظرف عائلي — تبديل متفق عليه"></div>`
            + `<div><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-res-go><i class="ji" data-i="save" aria-hidden="true"></i><span>اعتماد المعالجة</span></button></div>`
            + `</div></section>`;
        q('[data-v2-toolpanel]').scrollIntoView({ block: 'nearest' });
    }

    async function submitResolve() {
        if (saving || !resolveTarget) {return;}
        const { empId, date, rec } = resolveTarget;
        const type = el.querySelector('[data-v2-res-type]')?.value || 'fill';
        const reason = (el.querySelector('[data-v2-res-reason]')?.value || '').trim();
        if (!reason) {panelMsg('اكتب السبب'); return;}
        const who = ctx.userName || '';
        const emp = empById.get(String(empId));
        /* تحقق النموذج من دالة العقد وحدها (validatePunchForm) بنفس رسائل
           الشاشة الحالية — بصمة واحدة على الأقل وصيغة HH:MM. الفحص قبل
           الشبكة، فلا طلب يُرسل بنموذج مرفوض. */
        let punch = null;
        if (type === 'fill') {
            punch = validatePunchForm({
                checkIn: el.querySelector('[data-v2-res-in]')?.value || '',
                checkOut: el.querySelector('[data-v2-res-out]')?.value || '',
                reason,
            });
            if (!punch.ok) {panelMsg(punch.message); return;}
        }
        saving = true;
        try {
            if (type === 'fill') {
                const ci = punch.checkIn;
                const co = punch.checkOut;
                const { hour } = await fetchWorkStartHour();
                const calc = calcPunchTimes({ checkIn: ci, checkOut: co, shiftStart: shiftStartFor(emp, hour) });
                const note = auditNote('fill', { who, reason, date });
                if (rec && rec.id !== undefined && rec.id !== null) {
                    await updateAttendance(rec.id, {
                        checkIn: ci || null, checkOut: co || null,
                        workMinutes: calc.workMinutes, late: calc.late,
                        notes: joinNotes(rec.notes, note),
                    });
                } else {
                    await createAttendance(buildAttendanceCreate({
                        employeeId: empId, date, checkIn: ci || null, checkOut: co || null,
                        workMinutes: calc.workMinutes, late: calc.late, notes: note,
                    }));
                }
                panelMsg('تمت تعبئة البصمة');
            } else if (type === 'excuse') {
                await createApprovedLeave(buildExcusePayload({
                    employeeId: empId, date, reason, kind: 'approved',
                    userId: ctx.userId ?? null, todayStr: todayIso(),
                }));
                panelMsg('تم اعتماد العذر');
            } else {
                const withId = el.querySelector('[data-v2-res-with]')?.value;
                if (!withId) {panelMsg('اختر الموظف البديل'); saving = false; return;}
                const other = empById.get(String(withId));
                await createApprovedLeave(buildExcusePayload({
                    employeeId: empId, date, reason, kind: 'swap',
                    withName: (other && other.name) || withId,
                    userId: ctx.userId ?? null, todayStr: todayIso(),
                }));
                if (rec && rec.id !== undefined && rec.id !== null) {
                    await updateAttendance(rec.id, {
                        notes: joinNotes(rec.notes, auditNote('swap', { who, reason, date, withName: (other && other.name) || withId })),
                    });
                }
                panelMsg('تم تسجيل التبديل');
            }
            if (!el.isConnected) {return;}
            closePanel();
            await reload();
            if (gapsOpen) {await openGaps();}
        } catch (e) {
            if (!el.isConnected) {return;}
            panelMsg((e && e.message) || 'تعذر الحفظ');
        } finally {
            saving = false;
        }
    }

    function openExcuse(empId, presetDate) {
        stopScan();
        const emp = empId ? empById.get(String(empId)) : null;
        resolveTarget = { empId: empId ? String(empId) : '', date: presetDate || todayIso(), rec: null, excuseOnly: true };
        const opts = employeesList().filter((e) => e.status === 'active')
            .map((e) => `<option value="${esc(String(e.id))}"${emp && String(e.id) === String(emp.id) ? ' selected' : ''}>${esc(e.name)}</option>`).join('');
        q('[data-v2-toolpanel]').innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title">عذر إداري${emp ? ` — ${esc(emp.name)}` : ''}</h3>`
            + `<span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-x>إغلاق</button></div>`
            + `<div class="erp-card__body erp-stack"><div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">الموظف</label><select class="erp-select" data-v2-exc-emp>${opts}</select>`
            + `<label class="erp-text-sm erp-text-muted">التاريخ</label><input class="erp-input erp-input--ltr" type="date" data-v2-exc-date value="${esc(presetDate || todayIso())}">`
            + `</div><div class="erp-dash-controls"><label class="erp-text-sm erp-text-muted">سبب العذر</label>`
            + `<input class="erp-input" data-v2-exc-reason placeholder="مثال: ظرف عائلي / مأمورية عمل"></div>`
            + `<div><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-exc-go><i class="ji" data-i="save" aria-hidden="true"></i><span>اعتماد العذر</span></button></div>`
            + `</div></section>`;
        q('[data-v2-toolpanel]').scrollIntoView({ block: 'nearest' });
    }

    async function submitExcuse() {
        if (saving) {return;}
        const empId = el.querySelector('[data-v2-exc-emp]')?.value;
        const date = el.querySelector('[data-v2-exc-date]')?.value || todayIso();
        const reason = (el.querySelector('[data-v2-exc-reason]')?.value || '').trim();
        if (!empId) {panelMsg('حدّد الموظف'); return;}
        /* السبب إجباري على كل إجراء كتابي (نص الشاشة نفسه) — نفس تحقق
           hr.js:465 عبر validateReason، فلا عذر بلا سبب. */
        const check = validateReason(reason, 'اكتب سبب العذر');
        if (!check.ok) {panelMsg(check.message); return;}
        saving = true;
        try {
            await createApprovedLeave(buildExcusePayload({
                employeeId: empId, date, reason: check.reason, kind: 'admin',
                userId: ctx.userId ?? null, todayStr: todayIso(),
            }));
            if (!el.isConnected) {return;}
            panelMsg('تم اعتماد العذر');
            closePanel();
            await reload();
            if (gapsOpen) {await openGaps();}
        } catch (e) {
            if (!el.isConnected) {return;}
            panelMsg((e && e.message) || 'تعذر الحفظ');
        } finally {
            saving = false;
        }
    }

    function openCorrect(recordId) {
        stopScan();
        const rec = rawRows.find((a) => String(a.id) === String(recordId));
        if (!rec) {return;}
        const emp = empById.get(String(rec.employeeId));
        resolveTarget = { empId: String(rec.employeeId), date: rec.date, rec };
        q('[data-v2-toolpanel]').innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title">تصحيح بصمة — ${esc((emp && emp.name) || '')} <span class="erp-text-muted">${esc(rec.date || '')}</span></h3>`
            + `<span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-x>إغلاق</button></div>`
            + `<div class="erp-card__body erp-stack">`
            + `<p class="erp-text-sm erp-text-muted">الحالي: حضور <b dir="ltr">${esc(rec.checkIn || '—')}</b> · انصراف <b dir="ltr">${esc(rec.checkOut || '—')}</b> — املأ الخانة الناقصة فقط (أو عدّل الاثنتين).</p>`
            + `<div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">بصمة الحضور${!rec.checkIn ? ' (ناقصة)' : ''}</label><input class="erp-input erp-input--ltr" type="time" data-v2-cor-in value="${esc(rec.checkIn || '')}" dir="ltr">`
            + `<label class="erp-text-sm erp-text-muted">بصمة الانصراف${!rec.checkOut ? ' (ناقصة)' : ''}</label><input class="erp-input erp-input--ltr" type="time" data-v2-cor-out value="${esc(rec.checkOut || '')}" dir="ltr">`
            + `</div><div class="erp-dash-controls"><label class="erp-text-sm erp-text-muted">سبب التصحيح (إجباري)</label>`
            + `<input class="erp-input" data-v2-cor-reason placeholder="مثال: نسي بصمة الدخول — تم التأكد من الكاميرات"></div>`
            + `<div><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-cor-go><i class="ji" data-i="save" aria-hidden="true"></i><span>اعتماد التصحيح</span></button></div>`
            + `</div></section>`;
        q('[data-v2-toolpanel]').scrollIntoView({ block: 'nearest' });
    }

    async function submitCorrect() {
        if (saving || !resolveTarget || !resolveTarget.rec) {return;}
        const { rec } = resolveTarget;
        const reason = (el.querySelector('[data-v2-cor-reason]')?.value || '').trim();
        const punch = validatePunchForm({
            checkIn: el.querySelector('[data-v2-cor-in]')?.value || '',
            checkOut: el.querySelector('[data-v2-cor-out]')?.value || '',
            reason, reasonLabel: 'اكتب سبب التصحيح',
        });
        if (!punch.ok) {panelMsg(punch.message); return;}
        const ci = punch.checkIn;
        const co = punch.checkOut;
        saving = true;
        try {
            const emp = empById.get(String(rec.employeeId));
            const { hour } = await fetchWorkStartHour();
            const calc = calcPunchTimes({ checkIn: ci, checkOut: co, shiftStart: shiftStartFor(emp, hour), keepLate: true });
            const late = ci ? calc.late : !!rec.late;
            await updateAttendance(rec.id, {
                checkIn: ci || null, checkOut: co || null,
                workMinutes: (ci && co) ? calc.workMinutes : rec.workMinutes,
                late,
                notes: joinNotes(rec.notes, auditNote('correct', { who: ctx.userName || '', reason, date: rec.date })),
            });
            if (!el.isConnected) {return;}
            panelMsg('تم اعتماد التصحيح');
            closePanel();
            await reload();
            if (gapsOpen) {await openGaps();}
        } catch (e) {
            if (!el.isConnected) {return;}
            panelMsg((e && e.message) || 'تعذر الحفظ');
        } finally {
            saving = false;
        }
    }

    /* ── كشك البصمة: ماسح V2-native ──────────────────────────────────────
     *  scanner.js القديم غير محمّل في V2 أصلًا، فالماسح هنا يبنى من
     *  Html5Qrcode الذي يُجلب عند أول استخدام (vendor.js) داخل لوحة هذه
     *  الشاشة — لقطة واحدة لكل فتح، ثم زر «مسح بطاقة أخرى». */

    function scanMsg(t) {
        const n = el.querySelector('[data-v2-scan-msg]');
        if (n) {n.textContent = t;}
    }

    async function startCamera() {
        scanMsg('جارٍ تجهيز الكاميرا…');
        const ok = await ensureHtml5Qrcode();
        if (!el.isConnected) {return;}
        if (!ok) {
            scanMsg('تعذّر تحميل قارئ الكاميرا — تحقق من الاتصال ثم أعد المحاولة.');
            return;
        }
        if (!el.querySelector('[data-v2-scan-box]')) {return;}
        try {
            const inst = new window.Html5Qrcode('v2att-scan', { verbose: false });
            scanner = inst;
            await inst.start({ facingMode: 'environment' },
                { fps: 10, qrbox: { width: 220, height: 220 } },
                (text) => { onScanDecoded(text); },
                () => { /* إخفاقات فكٍّ بين الإطارات ضجيجٌ متوقع — لا رسالة لها */ });
            scanRunning = true;
            if (el.isConnected) {scanMsg('وجّه بطاقة الموظف (QR) نحو الكاميرا.');}
        } catch (e) {
            scanMsg(`تعذّر تشغيل الكاميرا: ${(e && e.message) || 'خطأ'} — امنح الإذن ثم أعد المحاولة.`);
        }
    }

    async function onScanDecoded(text) {
        if (saving) {return;}
        saving = true;
        stopScan();
        const parsed = parseScanPayload(text);
        if (!parsed.ok) {
            saving = false;
            scanMsg(parsed.message);
            return;
        }
        try {
            const res = await scanAttendance(parsed.data);
            if (!el.isConnected) {return;}
            const line = scanResultText(res);
            scanMsg(line);
            say(line);
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            scanMsg((e && e.message) || 'تعذّر تسجيل حركة الحضور');
        } finally {
            saving = false;
        }
    }

    function doScan() {
        resolveTarget = null;
        stopScan();
        q('[data-v2-toolpanel]').innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title">مسح بطاقة موظف — تسجيل حضور/انصراف <span class="erp-eyebrow" dir="ltr" lang="en">Kiosk</span></h3>`
            + `<span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-x>إغلاق</button></div>`
            + `<div class="erp-card__body erp-stack">`
            + `<p class="erp-text-sm erp-text-muted">اطلب من الموظف توجيه بطاقته (QR) نحو الكاميرا. الخادم يحدد وحده: حضور أم انصراف، ويرفض البطاقة غير الصالحة أو المكتملة.</p>`
            + `<div class="erp-scan" id="v2att-scan" data-v2-scan-box></div>`
            + `<p class="erp-text-sm" data-v2-scan-msg role="status" aria-live="polite"></p>`
            + `<div><button type="button" class="erp-btn erp-btn--sm" data-v2-scan-again><i class="ji" data-i="camera" aria-hidden="true"></i><span>مسح بطاقة أخرى</span></button></div>`
            + `</div></section>`;
        q('[data-v2-toolpanel]').scrollIntoView({ block: 'nearest' });
        startCamera();
    }

    async function doExport() {
        // xlsx ليس محمَّلًا في v2.html (قرار السرعة في vendor.js) — يُجلب عند أول تصدير.
        const ready = await ensureXlsx();
        if (!ready || typeof window.XLSX === 'undefined') {say('مكتبة Excel غير محمّلة — حدّث الصفحة'); return;}
        const from = q('#v2att-from').value;
        const to = q('#v2att-to').value;
        const matrix = buildExportMatrix(rows);
        const ws = window.XLSX.utils.aoa_to_sheet(matrix);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'الحضور');
        window.XLSX.writeFile(wb, exportFileName(from, to));
        say(`تم تصدير ${formatInt(rows.length)} سجل`);
    }

    async function doRevert() {
        const ok = typeof ctx.confirmFn === 'function'
            ? await ctx.confirmFn(REVERT_INFERRED_CONFIRM)
            : (typeof window !== 'undefined' && window.confirm ? window.confirm(REVERT_INFERRED_CONFIRM) : false);
        if (!ok) {return;}
        try {
            const res = await revertInferred();
            say(revertResultText(res));
            await reload();
        } catch (e) {
            say((e && e.message) || 'تعذر الإلغاء');
        }
    }

    /* ── الورديات: نصٌّ يُطبَّق ويعيد حساب الحضور (hr.js:995-1047) ───────── */

    function shiftMsg(t) {
        const n = el.querySelector('[data-v2-sh-result]');
        if (n) {n.textContent = t;}
    }

    function openShifts() {
        resolveTarget = null;
        stopScan();
        const defMonth = monthOf(q('#v2att-to').value) || monthOf(todayIso()) || '';
        q('[data-v2-toolpanel]').innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title">الورديات — تطبيق من واقع بصماتك <span class="erp-eyebrow" dir="ltr" lang="en">Shifts</span></h3>`
            + `<span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-x>إغلاق</button></div>`
            + `<div class="erp-card__body erp-stack">`
            + `<p class="erp-text-sm erp-text-muted">سطر لكل موظف: <b>EMP-رقم أو اسم الموظف أو بصمة رقم</b> ثم وقت الدخول ثم عدد ساعات الوردية (أو وقت الخروج).<br>`
            + `أمثلة: <code>EMP-019: 16:00 12</code> · <code>بصمة 45: 04:00 - 16:00</code> · <code>احمد السيد العدوي 16:00 12س</code></p>`
            + `<div class="erp-dash-controls"><label class="erp-text-sm erp-text-muted">شهر التحليل المقترح</label>`
            + `<input class="erp-input erp-input--ltr" type="month" data-v2-sh-month value="${esc(defMonth)}"></div>`
            + `<textarea class="erp-input erp-mono" rows="8" data-v2-sh-text dir="ltr" aria-label="نص الورديات" placeholder="EMP-019: 16:00 12"></textarea>`
            + `<label class="erp-row-wrap erp-text-sm"><input type="checkbox" data-v2-sh-suggest checked> أضف تلقائيًا ورديات مقترحة من واقع البصمة للموظفين غير المذكورين (فجوة ≥30 دقيقة)</label>`
            + `<div><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-sh-go><i class="ji" data-i="save" aria-hidden="true"></i><span>تطبيق وإعادة حساب الحضور</span></button></div>`
            + `<div class="erp-shifts-result" data-v2-sh-result role="status" aria-live="polite"></div>`
            + `</div></section>`;
        q('[data-v2-toolpanel]').scrollIntoView({ block: 'nearest' });
    }

    async function submitShifts() {
        if (saving) {return;}
        const first = validateShiftsText(el.querySelector('[data-v2-sh-text]')?.value || '');
        if (!first.ok) {shiftMsg(first.message); return;}
        const useAuto = !!el.querySelector('[data-v2-sh-suggest]')?.checked;
        const month = el.querySelector('[data-v2-sh-month]')?.value || monthOf(todayIso());
        saving = true;
        try {
            let text = first.text;
            let note = '';
            if (useAuto) {
                // التحليل اقتراحٌ لا شرط: إن تعذّر يُطبَّق النص المُدخل وحده
                try {
                    const analysis = await fetchShiftsAnalysis(month);
                    const lines = suggestShiftLines(text, (analysis && analysis.items) || []);
                    text = withSuggestedLines(text, lines);
                    note = lines.length
                        ? `أُضيف ${formatInt(lines.length)} سطرًا مقترحًا من تحليل الشهر.`
                        : 'التحليل لم يجد صفوفًا غير مذكورة تستحق الإضافة.';
                } catch {
                    note = 'تعذّر قراءة تحليل الشهر — يُطبَّق النص المُدخل وحده.';
                }
            }
            const second = validateShiftsText(text);
            if (!second.ok) {shiftMsg(second.message); saving = false; return;}
            const res = await applyShifts(second.text);
            if (!el.isConnected) {return;}
            shiftMsg([...formatShiftsResult(res), note].filter(Boolean).join('\n'));
            say(`تم تطبيق ${formatInt(res && res.applied)} وردية وإعادة حساب الحضور`);
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            shiftMsg(`تعذّر التطبيق: ${(e && e.message) || 'خطأ'}`);
        } finally {
            saving = false;
        }
    }

    /* ── الكشف الشهري المجمع (smart-card.js:701 عبر hr-routes.js:331) ──── */

    function openMonthly() {
        resolveTarget = null;
        stopScan();
        const defMonth = monthOf(q('#v2att-to').value) || monthOf(todayIso()) || '';
        q('[data-v2-toolpanel]').innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title">كشف الحضور والانصراف الشهري المجمع <span class="erp-eyebrow" dir="ltr" lang="en">Monthly Sheet</span></h3>`
            + `<span class="erp-grow"></span>`
            + `<input class="erp-input erp-input--ltr erp-no-print" type="month" data-v2-mo-month value="${esc(defMonth)}" aria-label="شهر الكشف">`
            + `<button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-mo-load><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button>`
            + `<button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-mo-print><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة الكشف</span></button>`
            + `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost erp-no-print" data-v2-panel-x>إغلاق</button></div>`
            + `<div class="erp-card__body"><div data-v2-mo-body class="erp-stack">`
            + `<p class="erp-text-sm erp-text-muted">جارٍ قراءة الكشف…</p>`
            + `</div></div></section>`;
        q('[data-v2-toolpanel]').scrollIntoView({ block: 'nearest' });
        loadMonthly();
    }

    async function loadMonthly() {
        const month = el.querySelector('[data-v2-mo-month]')?.value || monthOf(todayIso());
        const body = q('[data-v2-mo-body]');
        body.innerHTML = `<p class="erp-text-sm erp-text-muted">جارٍ قراءة الكشف…</p>`;
        try {
            const data = await fetchMonthlyAttendance(month);
            if (!el.isConnected || !q('[data-v2-mo-body]')) {return;}
            body.innerHTML = monthlySheetHtml(buildMonthlySheet(data));
        } catch (e) {
            if (!el.isConnected || !q('[data-v2-mo-body]')) {return;}
            body.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذّر قراءة الكشف الشهري: ${esc((e && e.message) || 'خطأ')}</p>`;
        }
    }

    function monthlySheetHtml(sheet) {
        const cards = [
            ['إجمالي أيام الحضور', formatInt(sheet.totals.records)],
            ['أيام مكتملة الدوام ✓', formatInt(sheet.totals.completeWorkDays)],
            ['عجز الساعات (لم يكمل دوامه)', sheet.totals.shortDays > 0
                ? `${formatInt(sheet.totals.shortDays)} يوم • ${minutesToHM(sheet.totals.deficitMinutes)}`
                : '—'],
            ['إجمالي الساعات', String(sheet.totals.karimHours)],
            ['الموظفون', formatInt(sheet.employees)],
        ];
        const rows = sheet.rows.map((r) => `<tr>`
            + `<td class="erp-td"><b>${esc(r.name)}</b><br><span class="erp-text-muted erp-text-sm">${esc(r.employeeId)}`
            + `${r.department && r.department !== '—' ? ` • ${esc(r.department)}` : ''}`
            + `${r.shiftStart ? ` • الوردية <span dir="ltr">${esc(r.shiftStart)}</span>` : ''}</span></td>`
            + `<td class="erp-td erp-tnum">${formatInt(r.records)}</td>`
            + `<td class="erp-td erp-tnum">${formatInt(r.completeWorkDays)}</td>`
            + `<td class="erp-td erp-tnum">${r.shortDays > 0 ? `${formatInt(r.shortDays)} يوم • ${minutesToHM(r.deficitMinutes)}` : '✓ كامل'}</td>`
            + `<td class="erp-td erp-tnum">${r.lateInDays > 0 ? `${formatInt(r.lateInDays)} يوم` : '—'}</td>`
            + `<td class="erp-td erp-tnum">${r.leaveDays > 0 ? `${formatInt(r.leaveDays)} يوم` : '—'}</td>`
            + `<td class="erp-td erp-tnum">${r.reviewDays > 0 ? `${formatInt(r.reviewDays)} يوم` : '—'}</td>`
            + `<td class="erp-td erp-tnum">${esc(String(r.karimHours))}</td></tr>`).join('')
            || `<tr><td class="erp-td" colspan="8">لا توجد سجلات في هذا الشهر</td></tr>`;
        const verify = [
            'المعتمد = إتمام ساعات الوردية: الدخول المبكر يغطي الانصراف المبكر والتأخير يُمتص بالبقاء',
            'عدد أيام التأخير مستقل عن مجموع الدقائق',
            'لا يوجد خلط بين عدد الأيام والساعات',
            'الورديات الليلية تُحسب حسب وقت الوردية',
            'القيم الشاذة تُراجع يدويًا قبل الاعتماد',
        ];
        return `<ul class="erp-kpis" aria-label="إجماليات الكشف">`
            + cards.map(([label, value]) => `<li class="erp-kpi">`
                + `<div class="erp-kpi__top"><span class="erp-kpi__label">${esc(label)}</span></div>`
                + `<div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(value)}</span></div></li>`).join('')
            + `</ul>`
            + `<div class="erp-table__scroll" style="max-height:420px;overflow:auto"><table class="erp-table__grid"><thead><tr>`
            + `<th>الموظف</th><th>أيام الحضور</th><th>مكتملة الدوام</th><th>نقص الدوام (يوم/د)</th>`
            + `<th>أيام بعجز</th><th>إجازات</th><th>بلا بصمة</th><th>الساعات</th>`
            + `</tr></thead><tbody>${rows}</tbody></table></div>`
            + `<div class="erp-mo-verify"><p class="erp-card__title">معيار التحقق الاحترافي</p>`
            + `<ul class="erp-text-sm erp-text-muted">${verify.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`
            + `<p class="erp-print-note">المعتمد = إتمام ساعات الوردية • نقص الدوام: `
            + `${formatInt(sheet.totals.shortDays)} يوم • ${formatInt(sheet.totals.deficitMinutes)} دقيقة — شهر `
            + `${esc(sheet.month || '')} (${formatInt(sheet.employees)} موظفًا)</p>`;
    }

    /* ── التدقيق الصارم (smart-card.js:537-538 عبر hr-routes.js:409) ────── */

    function openAudit() {
        resolveTarget = null;
        stopScan();
        const defMonth = monthOf(q('#v2att-to').value) || monthOf(todayIso()) || '';
        q('[data-v2-toolpanel]').innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title">تدقيق صارم <span class="erp-eyebrow" dir="ltr" lang="en">Strict Audit</span></h3>`
            + `<span class="erp-grow"></span>`
            + `<input class="erp-input erp-input--ltr" type="month" data-v2-au-month value="${esc(defMonth)}" aria-label="شهر التدقيق">`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-au-load><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button>`
            + `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-x>إغلاق</button></div>`
            + `<div class="erp-card__body"><div data-v2-au-body class="erp-stack">`
            + `<p class="erp-text-sm erp-text-muted">جارٍ الفحص…</p>`
            + `</div></div></section>`;
        q('[data-v2-toolpanel]').scrollIntoView({ block: 'nearest' });
        loadAudit();
    }

    async function loadAudit() {
        const month = el.querySelector('[data-v2-au-month]')?.value || monthOf(todayIso());
        const body = q('[data-v2-au-body]');
        body.innerHTML = `<p class="erp-text-sm erp-text-muted">جارٍ الفحص…</p>`;
        try {
            const res = await fetchStrictAudit(month);
            if (!el.isConnected || !q('[data-v2-au-body]')) {return;}
            body.innerHTML = auditHtml(summarizeAudit(res), month);
        } catch (e) {
            if (!el.isConnected || !q('[data-v2-au-body]')) {return;}
            body.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذّر الفحص: ${esc((e && e.message) || 'خطأ')}</p>`;
        }
    }

    function auditHtml(sum, month) {
        const rows = sum.rows.map((r) => `<tr>`
            + `<td class="erp-td"><b>${esc(r.name)}</b>`
            + (r.detail.length
                ? `<br><span class="erp-text-muted erp-text-sm">${esc(r.detail.map((d) => `${d.emp} (${d.lateDays ?? '—'}/${d.days ?? '—'})`).join(' · '))}</span>`
                : '')
            + `</td>`
            + `<td class="erp-td"><span class="erp-badge" data-tone="${esc(r.tone)}"><span class="erp-badge-label">${esc(r.statusAr)}</span></span></td>`
            + `<td class="erp-td erp-tnum">${formatInt(r.count)}</td></tr>`).join('')
            || `<tr><td class="erp-td" colspan="3">لا نتائج</td></tr>`;
        return `<p class="erp-text-sm erp-text-muted">شهر <span dir="ltr">${esc(month)}</span> — الفحص يجري على الخادم، والأرقام كما وردت منه.</p>`
            + `<div class="erp-table__scroll" style="max-height:420px;overflow:auto"><table class="erp-table__grid">`
            + `<thead><tr><th>الفحص</th><th>الحالة</th><th>العدد</th></tr></thead><tbody>${rows}</tbody></table></div>`
            + `<div class="erp-audit-verdict" data-tone="${sum.ok ? 'success' : 'danger'}">`
            + (sum.ok ? 'كل الفحوصات سليمة — البيانات معتمدة' : 'يوجد فشل — راجع البنود أعلاه قبل الاعتماد')
            + `</div>`;
    }

    /* نداء طباعة واحد في الشاشة كلها؛ الكشف الشهري يركب شارة body قبله
       وتُنزع بعده (afterprint + مهلة أمان) — نفس حركة بطاقة QR في W2-2. */
    function printNow(monthly) {
        if (monthly) {
            document.body.classList.add('erp-v2-print-monthly');
            const cleanup = () => {
                document.body.classList.remove('erp-v2-print-monthly');
                window.removeEventListener('afterprint', cleanup);
            };
            window.addEventListener('afterprint', cleanup);
            setTimeout(cleanup, 4000);
        }
        window.print();
    }

    /* ── Wiring (delegated; no inline handlers) ───────────────────────── */
    el.addEventListener('click', async (event) => {
        const seg = event.target.closest('[data-v2-period]');
        if (seg) {applyPeriod(seg.dataset.v2Period); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-clear]')) {
            q('[data-v2-dept]').value = 'all';
            q('[data-v2-state]').value = 'all';
            paint();
            return;
        }
        if (event.target.closest('[data-v2-print]')) {printNow(false); return;}
        const tool = event.target.closest('[data-v2-tool]');
        if (tool) {
            const id = tool.dataset.v2Tool;
            if (id === 'gaps') {
                gapsOpen = !gapsOpen;
                if (!gapsOpen) {q('[data-v2-gaps-wrap]').hidden = true;}
                else {await openGaps();}
                return;
            }
            if (id === 'scan') {doScan(); return;}
            if (id === 'export') {doExport(); return;}
            if (id === 'revert') {doRevert(); return;}
            if (id === 'shifts') {openShifts(); return;}
            if (id === 'monthly') {openMonthly(); return;}
            if (id === 'audit') {openAudit(); return;}
            return;
        }
        if (event.target.closest('[data-v2-gaps-x]')) {
            gapsOpen = false;
            q('[data-v2-gaps-wrap]').hidden = true;
            return;
        }
        const cor = event.target.closest('[data-v2-correct]');
        if (cor) {openCorrect(cor.dataset.v2Correct); return;}
        const res = event.target.closest('[data-v2-resolve]');
        if (res) {
            const [empId, date] = String(res.dataset.v2Resolve).split('|');
            openResolve(empId, date);
            return;
        }
        if (event.target.closest('[data-v2-panel-x]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-res-go]')) {submitResolve(); return;}
        if (event.target.closest('[data-v2-exc-go]')) {submitExcuse(); return;}
        if (event.target.closest('[data-v2-cor-go]')) {submitCorrect(); return;}
        if (event.target.closest('[data-v2-excuse-new]')) {openExcuse(''); return;}
        if (event.target.closest('[data-v2-scan-again]')) {startCamera(); return;}
        if (event.target.closest('[data-v2-sh-go]')) {submitShifts(); return;}
        if (event.target.closest('[data-v2-mo-load]')) {loadMonthly(); return;}
        if (event.target.closest('[data-v2-mo-print]')) {printNow(true); return;}
        if (event.target.closest('[data-v2-au-load]')) {loadAudit(); return;}
        // The table's own retry button clears the error but cannot refetch in
        // client mode — the host owns the data, so the refetch lives here.
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-dept], [data-v2-state]')) {paint(); return;}
        if (event.target.matches('[data-v2-mo-month]')) {loadMonthly(); return;}
        if (event.target.matches('[data-v2-au-month]')) {loadAudit(); return;}
        if (event.target.matches('[data-v2-res-type]')) {
            const v = event.target.value;
            const f = el.querySelector('[data-v2-res-fill]');
            const s = el.querySelector('[data-v2-res-swap]');
            if (f) {f.hidden = v !== 'fill';}
            if (s) {s.hidden = v !== 'swap';}
            return;
        }
        if (event.target.matches('#v2att-from, #v2att-to')) {
            paintSeg(periodKindFor(q('#v2att-from').value, q('#v2att-to').value));
            reload();
        }
    });
    el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.matches('#v2att-from, #v2att-to')) {reload();}
    });

    paint();
    reload();

    return {
        el,
        reload,
        getRows: () => rows,
        destroy() {
            stopScan();
            table.destroy();
            el.remove();
        },
    };
}
