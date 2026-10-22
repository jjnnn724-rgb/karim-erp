/**
 * V2 — شاشة الدوام · شبكة دوامات القسم (W2-1)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * This file used to be dead on arrival: it called createDataTable() at mount
 * without importing it — a ReferenceError the moment the screen rendered, and
 * the only screen in V2 with that class of bug. W2-1 rebuilds it as the
 * editable week matrix whose contract is hr-routes.js:
 *
 *   • GET /dept-roster-week (:1327) carries the whole week: days with the
 *     server's own isPast/isToday/editable flags, the approval row, and the
 *     last 15 shift changes. One read paints everything.
 *   • POST /dept-roster-week (:1519) saves ONLY the cells the user edited.
 *     The legacy chart pushed all seven days of any touched row
 *     (features/roster.js:287) and ate a 422 on locked past days mid-week.
 *     The server still refuses a past date, a bad time, hours outside 1-24
 *     and out-of-scope employees — its words are what the user reads.
 *   • A save deletes this week's print approval server-side (:1636); the
 *     confirm sentence says so before the click, not after.
 *   • The week starts Saturday (owner request 2026-10-04); the server snaps
 *     any sent date to its week's Saturday and this screen shows the
 *     weekStart the server answered with, never one it computed.
 *
 * Same per-screen contract as 01-10: one network door (v2/data/roster-repo.js),
 * delegated listeners on the mounted root, busy and loading guards
 * (loading → queued → newest read wins), isConnected after every await,
 * destroy() on nav, no invented values, no inline handlers.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.193';
import { formatInt } from '../data/reports-repo.js?v=4.9.193';
import {
    ROSTER_DAY_LABELS, ROSTER_MAX_CELLS, canApproveRoster, canPickDept,
    canRosterWrite, fetchRosterWeek, fetchRosterPending, saveRosterWeek,
    requestRosterApproval, approveRoster, rosterApprovalKey, rosterApprovalState,
    cellEdit, cellKey, dirtyToCells, weekOf,
} from '../data/roster-repo.js?v=4.9.193';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function clockNow() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function template() {
    return `
      <div class="erp-v2-roster">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">الدوام
              <span class="erp-eyebrow" dir="ltr" lang="en">Dept Roster</span>
            </h2>
            <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls erp-no-print">
            <span data-v2-dept-picker></span>
            <span class="erp-row-wrap">
              <button type="button" class="erp-btn erp-btn--sm" data-v2-weeknav data-delta="-1" aria-label="الأسبوع السابق">
                <i class="ji" data-i="arrow-right" aria-hidden="true"></i>
              </button>
              <b class="erp-text-sm erp-num" data-v2-week-label dir="ltr"></b>
              <button type="button" class="erp-btn erp-btn--sm" data-v2-weeknav data-delta="1" aria-label="الأسبوع التالي">
                <i class="ji" data-i="arrow-left" aria-hidden="true"></i>
              </button>
              <button type="button" class="erp-btn erp-btn--sm" data-v2-weeknav data-delta="0">هذا الأسبوع</button>
            </span>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-copy-prev>
              <i class="ji" data-i="copy" aria-hidden="true"></i><span>نسخ الأسبوع السابق</span>
            </button>
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-save aria-label="حفظ التغييرات" disabled>
              <i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ التغييرات</span> <span class="erp-num" dir="ltr" data-v2-dirty-count></span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-print aria-label="طباعة">
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">شبكة الأسبوع
              <span class="erp-eyebrow" dir="ltr" lang="en">Week Grid</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted" data-v2-grid-note></span>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted erp-no-print">
              قراءة وحفظ وفق دورك — النظام يقصّ النطاق وفق صلاحيتك، ولا يقبل
              تعديل الأسابيع الماضية، وأي حفظ يُلغي اعتماد هذا الأسبوع المسجَّل.
            </p>
            <div class="erp-error" data-v2-form-error role="alert"></div>
            <div data-v2-grid></div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">اعتماد الطباعة
              <span class="erp-eyebrow" dir="ltr" lang="en">Print Approval</span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted" data-v2-apr-note></span>
          </div>
          <div class="erp-card__body">
            <div data-v2-approval></div>
          </div>
        </section>

        <section class="erp-card" data-v2-pending-card hidden>
          <div class="erp-card__head">
            <h3 class="erp-card__title">طلبات اعتماد بانتظار توقيع شؤون العاملين
              <span class="erp-eyebrow" dir="ltr" lang="en">Pending Signatures</span>
            </h3>
          </div>
          <div class="erp-card__body">
            <div data-v2-pending></div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">آخر تغييرات الدوام
              <span class="erp-eyebrow" dir="ltr" lang="en">Shift History</span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted">كل خلية محفوظة = تغيير مجدول بتاريخ سريانه (آخر 15)</span>
          </div>
          <div class="erp-card__body">
            <div data-v2-log></div>
          </div>
        </section>

        <div class="erp-ros-signs" data-v2-signs>
          <span>مسؤول القسم: ____________________</span>
          <span>شؤون العاملين: ____________________</span>
        </div>
        <p class="erp-print-note" data-v2-print-note></p>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, userName?: string, notify?: (message:string, kind?:string)=>void, confirmFn?: (message:string)=>boolean}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], getDirty: ()=>any[], destroy: ()=>void}}
 */
export function mountRosterScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 roster]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const role = ctx.role || null;
    const userName = String(ctx.userName || '');

    let data = null;          // last good read — the server's words
    let weekSel = '';         // '' = let the server pick today's week; else YYYY-MM-DD
    let deptSel = '';         // '' = the role's own scope (a privileged picker picks)
    let readAt = '';
    let loading = false;
    let queued = false;       // a refresh asked for while one was running
    let saving = false;       // one write at a time
    let pickerBuilt = '';     // depts signature — an open dropdown is never rebuilt
    const dirty = new Map();  // cellKey → edited cell (the only cells a save sends)

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeEl = q('[data-v2-scope-line]');
    const weekLabelEl = q('[data-v2-week-label]');
    const countEl = q('[data-v2-count]');
    const gridNoteEl = q('[data-v2-grid-note]');
    const gridHolder = q('[data-v2-grid]');
    const formErrorEl = q('[data-v2-form-error]');
    const pickerHolder = q('[data-v2-dept-picker]');
    const saveBtn = q('[data-v2-save]');
    const dirtyCountEl = q('[data-v2-dirty-count]');
    const copyPrevBtn = q('[data-v2-copy-prev]');
    const approvalEl = q('[data-v2-approval]');
    const aprNoteEl = q('[data-v2-apr-note]');
    const pendingCard = q('[data-v2-pending-card]');
    const pendingEl = q('[data-v2-pending]');
    const printNote = q('[data-v2-print-note]');

    const logTable = createDataTable({
        caption: 'آخر تغييرات الدوام — كل سطر تغيير مجدول بتاريخ سريانه',
        mode: 'client',
        pageSize: 10,
        stickyHeader: true,
        emptyMessage: 'لا تغييرات مسجّلة في نطاق هذا القسم',
        emptyHint: 'أول حفظ لأي خلية سيظهر هنا بتاريخ سريانه ومن سجّله.',
        rowKey: (r) => `${r.empNo}:${r.effectiveFrom}:${r.at}`,
        columns: [
            {
                key: 'employee', header: 'الموظف', sortable: true, filterable: true,
                render: (row) => esc(row.employee)
                    + (row.empNo ? ` <small class="erp-text-muted" dir="ltr">${esc(row.empNo)}</small>` : ''),
            },
            {
                key: 'shift', header: 'الدوام', width: '150px', align: 'center',
                render: (row) => `<span class="erp-num" dir="ltr">${esc(row.start)}</span> <span class="erp-text-sm erp-text-muted">${esc(row.hours)}س</span>`,
            },
            {
                key: 'effectiveFrom', header: 'يسري من', sortable: true, width: '120px', align: 'center',
                render: (row) => `<span class="erp-num" dir="ltr">${esc(row.effectiveFrom)}</span>`,
            },
            {
                key: 'by', header: 'بواسطة', sortable: true, filterable: true, width: '150px',
                render: (row) => esc(row.by),
            },
            {
                key: 'at', header: 'وقت التسجيل', sortable: true, width: '150px', align: 'center',
                render: (row) => `<span class="erp-num" dir="ltr">${esc(row.at)}</span>`,
            },
        ],
    });
    q('[data-v2-log]').appendChild(logTable.el);

    function logRow(r) {
        return {
            employee: r.name || `#${r.employee_id}`,
            empNo: r.emp_no || '',
            start: String(r.shift_start || '—'),
            hours: String(r.shift_karim ?? '—'),
            effectiveFrom: String(r.effective_from || '—'),
            by: String(r.by_name || '—'),
            at: r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 16) : '—',
        };
    }

    function cellHtml(row, i, day) {
        const c = (Array.isArray(row.cells) ? row.cells[i] : null) || {};
        const label = `${row.name || ('#' + row.id)} — ${ROSTER_DAY_LABELS[i] || ''} ${day.date || ''}`;
        if (c.onLeave) {
            return `<td class="erp-ros-cell" data-state="leave" title="إجازة معتمدة تغطي هذا اليوم — الخادم يقفل التعديل">
              <div class="erp-ros-static"><span class="erp-ros-leave">إجازة</span>${c.leaveType ? `<small>${esc(c.leaveType)}</small>` : ''}</div>
            </td>`;
        }
        if (!c.editable) {
            const off = c.day_off != null;
            return `<td class="erp-ros-cell" data-state="past" title="الماضي محمي — الخادم يرفض أي تعديل فيه">
              <div class="erp-ros-static">${off
                ? '<span class="erp-text-muted">راحة</span>'
                : `<span class="erp-num" dir="ltr">${esc(c.shift_start || '—')}</span><small class="erp-text-muted">${esc(String(c.shift_hours ?? ''))}س</small>`}</div>
            </td>`;
        }
        const off = c.day_off != null;
        return `<td class="erp-ros-cell" data-v2-cell data-id="${esc(row.id)}" data-day="${esc(i)}" data-date="${esc(day.date)}" data-weekday="${esc(day.weekday)}" data-orig-start="${esc(c.shift_start || '09:00')}" data-orig-hours="${esc(String(c.shift_hours ?? 10))}">
          <div class="erp-ros-inputs">
            <input class="erp-input erp-ros-time" type="time" value="${esc(c.shift_start || '09:00')}" data-v2-edit="start" aria-label="بداية دوام ${esc(label)}"${off ? ' disabled' : ''}>
            <input class="erp-input erp-ros-hours erp-num" type="number" value="${esc(String(c.shift_hours ?? 10))}" min="1" max="24" step="0.5" inputmode="decimal" data-v2-edit="hours" aria-label="ساعات دوام ${esc(label)}"${off ? ' disabled' : ''}>
            <label class="erp-ros-off"><input type="checkbox" data-v2-edit="off"${off ? ' checked' : ''}> <span>راحة</span></label>
          </div>
        </td>`;
    }

    function renderGrid(d) {
        const days = Array.isArray(d.days) ? d.days : [];
        const grid = Array.isArray(d.grid) ? d.grid : [];
        countEl.textContent = grid.length ? `(${formatInt(grid.length)})` : '';
        if (!days.length || !grid.length) {
            gridHolder.innerHTML = `<div class="erp-state" role="status">
              <span class="erp-state__title">لا موظفون في نطاق هذا القسم</span>
              <span>الخادم أرسل شبكة فارغة لهذا النطاق — الصف لا يُختلق.</span>
            </div>`;
            gridNoteEl.textContent = '';
            return;
        }
        const head = '<tr><th class="erp-th erp-ros-emp" scope="col">الموظف</th>'
            + days.map((day, i) => {
                const tags = (day.isToday || day.isPast)
                    ? `<span class="erp-ros-tags">${day.isToday ? '<span class="erp-ros-tag" title="اليوم — التعديل الحيّ هنا">اليوم</span>' : ''}${day.isPast ? '<span class="erp-ros-tag erp-text-muted" title="الماضي محمي عند الخادم">مقفل</span>' : ''}</span>`
                    : '';
                return `<th class="erp-th erp-ros-day${day.isToday ? ' is-today' : ''}" scope="col">${esc(ROSTER_DAY_LABELS[i] || '')}<br><small class="erp-num" dir="ltr">${esc(day.date || '')}</small>${tags}</th>`;
            }).join('')
            + '<th class="erp-th erp-ros-tools" scope="col">أدوات</th></tr>';
        const body = grid.map((row) => `<tr>
            <td class="erp-td erp-ros-emp">
              <div class="erp-ros-name">${esc(row.name || ('#' + row.id))}</div>
              <small class="erp-text-sm erp-text-muted" dir="ltr">${esc(row.employeeId || '')}</small>
              ${row.position ? `<small class="erp-text-sm erp-text-muted"> · ${esc(row.position)}</small>` : ''}
            </td>
            ${days.map((day, i) => cellHtml(row, i, day)).join('')}
            <td class="erp-td erp-ros-tools">
              <button type="button" class="erp-btn erp-btn--sm" data-v2-copy-row data-emp="${esc(row.id)}" title="انسخ قيم أول يوم قابل للتعديل إلى بقية أيام الصف">
                <i class="ji" data-i="copy" aria-hidden="true"></i><span>نسخ الصف</span>
              </button>
            </td>
          </tr>`).join('');
        gridHolder.innerHTML = `<div class="erp-table__scroll" tabindex="0">
          <table class="erp-table__grid erp-ros-grid">
            <caption class="erp-sr-only">شبكة دوام الأسبوع — كل خلية محفوظة تُطبق في تاريخها عبر مجدول المحرك</caption>
            <thead>${head}</thead><tbody>${body}</tbody>
          </table></div>`;
        gridNoteEl.textContent = 'الأيام المقفلة والمظللة بالإجازة لا تُعدَّل — القرار للخادم';
    }

    function buildPicker(d) {
        if (d.fixed || !canPickDept(role)) {
            pickerHolder.innerHTML = d.fixed
                ? `<span class="erp-badge" data-tone="info" title="نطاق القراءة والكتابة يحدده الخادم من دورك">القسم: ${esc((Array.isArray(d.depts) ? d.depts.join(', ') : '') || 'بلا قسم مسجَّل')}</span>`
                : '';
            return;
        }
        const valid = Array.isArray(d.validDepts) ? d.validDepts.map((x) => String(x)) : [];
        const sig = valid.join('|');
        if (pickerBuilt === sig) {return;}
        pickerBuilt = sig;
        const list = deptSel && !valid.includes(deptSel) ? valid.concat([deptSel]) : valid;
        const opts = ['<option value="">كل الأقسام</option>']
            .concat(list.map((c) => `<option value="${esc(c)}"${c === deptSel ? ' selected' : ''}>${esc(c)}</option>`))
            .join('');
        pickerHolder.innerHTML = `<label class="erp-text-sm erp-text-muted" for="v2ros-dept">القسم</label>
          <select class="erp-select" id="v2ros-dept" data-v2-dept title="أكواد الأقسام كما أرسلها الخادم — بلا قسم = كل الأقسام">${opts}</select>`;
    }

    function renderApproval(d) {
        const st = rosterApprovalState(d.approval);
        const key = rosterApprovalKey(d.depts);
        aprNoteEl.textContent = `مفتاح الأسبوع: ${key} · ${d.weekStart || ''}`;
        if (st.key === 'approved') {
            approvalEl.innerHTML = `<div class="erp-flow-note" data-tone="success">
              <i class="ji" data-i="circle-check" aria-hidden="true"></i>
              معتمد من شؤون العاملين: <strong>${esc(st.by)}</strong>${st.at ? ` — ${esc(st.at)}` : ''} · الطباعة تخرج معتمدة لهذا الأسبوع.</div>`;
            return;
        }
        if (st.key === 'pending') {
            approvalEl.innerHTML = `<div class="erp-flow-note" data-tone="info">
              <i class="ji" data-i="hourglass" aria-hidden="true"></i>
              أُرسل لاعتماد شؤون العاملين — <strong>${esc(st.by)}</strong>${st.at ? ` (${esc(st.at)})` : ''}، بانتظار التوقيع.
              ${canApproveRoster(role) ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-apr-approve data-key="${esc(key)}"><i class="ji" data-i="pen-line" aria-hidden="true"></i><span>توقيع واعتماد الآن</span></button>` : ''}
            </div>`;
            return;
        }
        if (!canRosterWrite(role)) {
            approvalEl.innerHTML = '<p class="erp-text-sm erp-text-muted">لا اعتماد مسجَّل لهذا الأسبوع.</p>';
            return;
        }
        approvalEl.innerHTML = `<div class="erp-row-wrap">
          <button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-apr-request><i class="ji" data-i="pen-line" aria-hidden="true"></i><span>إرسال لاعتماد شؤون العاملين</span></button>
          <span class="erp-text-sm erp-text-muted">بعد توقيعهم تُطبع النسخة معتمدة — وأي حفظ لاحق يُلغي الاعتماد.</span>
        </div>`;
    }

    function paint() {
        const d = data || {};
        const days = Array.isArray(d.days) ? d.days : [];
        const grid = Array.isArray(d.grid) ? d.grid : [];
        weekLabelEl.textContent = days.length >= 7 ? `${d.weekStart} — ${days[6].date}` : String(d.weekStart || '');
        const depts = Array.isArray(d.depts) ? d.depts : [];
        const scopeNote = d.fixed
            ? `دورك مقصور على قسمك (${depts.join(', ') || 'بلا قسم مسجَّل'} — الخادم يحدده)`
            : (deptSel ? `نطاق مختار: ${deptSel}` : 'دور مخوّل: كل الأقسام');
        scopeEl.textContent = `${scopeNote} · ${formatInt(grid.length)} موظفًا · آخر قراءة ${readAt}`;
        buildPicker(d);
        renderGrid(d);
        renderApproval(d);
        const log = Array.isArray(d.recentLog) ? d.recentLog : [];
        logTable.setRows(log.map(logRow));
        printNote.textContent = `شبكة دوام ${d.weekStart || ''} — ${days.length >= 7 ? days[6].date : ''} · ${grid.length} موظفًا · ${scopeNote} · آخر قراءة ${readAt}. المطبوعة تعرض الأسبوع الظاهر بكل أيامه — المقفلة تطبع قيمها كما هي.`;
        refreshDirtyUi();
    }

    function paintError(e) {
        const message = (e && e.message === 'UNAUTHORIZED')
            ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
            : (e && e.code === 'FORBIDDEN'
                ? 'لا صلاحية لعرض الدوام بهذا الحساب — القرار للخادم وحده.'
                : `تعذّر تحميل شبكة الدوام: ${(e && e.message) || 'خطأ'}`);
        scopeEl.textContent = '';
        weekLabelEl.textContent = '';
        countEl.textContent = '';
        gridNoteEl.textContent = '';
        gridHolder.innerHTML = `<div class="erp-state" role="status">
          <span class="erp-state__title">تعذّر قراءة الشبكة</span>
          <span>${esc(message)}</span>
          <button type="button" class="erp-btn erp-btn--sm" data-erp-retry>إعادة المحاولة</button>
        </div>`;
        approvalEl.innerHTML = '';
        aprNoteEl.textContent = '';
        pendingCard.hidden = true;
        pendingEl.innerHTML = '';
        logTable.setError(message);
        printNote.textContent = `شبكة الدوام — ${message}`;
    }

    function refreshDirtyUi() {
        const n = dirty.size;
        dirtyCountEl.textContent = n ? `(${formatInt(n)})` : '';
        saveBtn.disabled = saving || loading || n === 0;
    }

    function confirmDiscard(what) {
        if (!dirty.size) {return true;}
        return confirmFn(`لديك ${formatInt(dirty.size)} خلية غير محفوظة — ${what}. متابعة؟`);
    }

    /** One read paints everything; the server's weekStart is the only week
     *  this screen ever speaks in. */
    async function reload() {
        if (loading) {queued = true; return;}
        loading = true;
        copyPrevBtn.disabled = true;
        saveBtn.disabled = true;
        gridNoteEl.textContent = 'جارٍ قراءة الشبكة…';
        try {
            const res = await fetchRosterWeek(weekSel || '', deptSel || undefined);
            if (!el.isConnected) {return;}          // destroyed while in flight
            data = res || {};
            dirty.clear();
            readAt = clockNow();
            paint();
            renderPending(data);
        } catch (e) {
            if (!el.isConnected) {return;}
            data = null;
            dirty.clear();
            paintError(e);
        } finally {
            loading = false;
            if (el.isConnected) {
                copyPrevBtn.disabled = false;
                refreshDirtyUi();
            }
            if (queued && el.isConnected) {
                queued = false;
                reload();                            // the newest read wins
            }
        }
    }

    async function renderPending(d) {
        if (!canApproveRoster(role)) {pendingCard.hidden = true; return;}
        pendingCard.hidden = false;
        pendingEl.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ قراءة طلبات الاعتماد…</p>';
        try {
            const rows = await fetchRosterPending(d.weekStart);
            if (!el.isConnected || d !== data) {return;}
            pendingEl.innerHTML = rows.length
                ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
                     <caption class="erp-sr-only">طلبات اعتماد دوامات بانتظار توقيع شؤون العاملين</caption>
                     <thead><tr>
                       <th class="erp-th" scope="col">القسم</th><th class="erp-th" scope="col">الطالب</th>
                       <th class="erp-th" scope="col">وقت الطلب</th><th class="erp-th" scope="col">إجراء</th>
                     </tr></thead>
                     <tbody>${rows.map((r) => `<tr>
                       <td class="erp-td" title="كود القسم كما خزنه الخادم"><span class="erp-addr" dir="ltr">${esc(r.dept_key)}</span></td>
                       <td class="erp-td">${esc(r.requested_name || '—')}</td>
                       <td class="erp-td erp-num" dir="ltr">${esc(r.requested_at ? String(r.requested_at).replace('T', ' ').slice(0, 16) : '—')}</td>
                       <td class="erp-td"><button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-pending-approve data-key="${esc(r.dept_key)}"><i class="ji" data-i="pen-line" aria-hidden="true"></i><span>توقيع واعتماد</span></button></td>
                     </tr>`).join('')}</tbody>
                   </table></div>`
                : '<p class="erp-text-sm erp-text-muted">لا طلبات اعتماد مفتوحة لهذا الأسبوع.</p>';
        } catch (err) {
            if (!el.isConnected || d !== data) {return;}
            pendingEl.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذّر قراءة طلبات الاعتماد: ${esc((err && err.message) || 'خطأ')}</p>`;
        }
    }

    /** A change inside an editable cell validates immediately and stages the
     *  cell — the save then sends exactly these cells (dirtyToCells). */
    function markCellChange(td) {
        const start = td.querySelector('[data-v2-edit="start"]');
        const hours = td.querySelector('[data-v2-edit="hours"]');
        const off = td.querySelector('[data-v2-edit="off"]');
        if (!start || !hours || !off) {return;}
        const isOff = !!off.checked;
        start.disabled = isOff;
        hours.disabled = isOff;
        const v = cellEdit(start.value, hours.value);
        const entry = {
            id: Number(td.dataset.id),
            date: td.dataset.date,
            shift_start: v.ok ? v.shiftStart : td.dataset.origStart,
            shift_hours: v.ok ? v.shiftHours : Number(td.dataset.origHours),
            day_off: isOff ? Number(td.dataset.weekday) : null,
        };
        if (v.ok) {
            start.value = v.shiftStart;
            hours.value = String(v.shiftHours);
            delete td.dataset.error;
        } else if (isOff) {
            // A rest day hides its inputs: send the stored-good values, not a
            // half-typed number the user cannot even see.
            start.value = td.dataset.origStart;
            hours.value = td.dataset.origHours;
            delete td.dataset.error;
        } else {
            entry.error = v.error;
            td.dataset.error = '1';
        }
        dirty.set(cellKey(entry.id, entry.date), entry);
        td.dataset.dirty = '1';
        refreshDirtyUi();
    }

    function copyRow(btn) {
        if (saving) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const tr = btn.closest('tr');
        if (!tr) {return;}
        const tds = Array.from(tr.querySelectorAll('td[data-v2-cell]'));
        const first = tds.find((td) => {
            const s = td.querySelector('[data-v2-edit="start"]');
            return s && !s.disabled;
        });
        if (!first) {notify('لا يوم قابل للتعديل في هذا الصف — المقفل والإجازات خارج النسخ', 'warning'); return;}
        const sStart = first.querySelector('[data-v2-edit="start"]').value;
        const sHours = first.querySelector('[data-v2-edit="hours"]').value;
        const sOff = !!first.querySelector('[data-v2-edit="off"]').checked;
        let n = 0;
        for (const td of tds) {
            if (td === first) {continue;}
            const start = td.querySelector('[data-v2-edit="start"]');
            if (!start || start.disabled) {continue;}
            start.value = sStart;
            td.querySelector('[data-v2-edit="hours"]').value = sHours;
            td.querySelector('[data-v2-edit="off"]').checked = sOff;
            markCellChange(td);
            n += 1;
        }
        notify(n ? `نُسخت قيم أول يوم قابل للتعديل إلى ${formatInt(n)} يومًا — راجع ثم احفظ` : 'لا أيام أخرى قابلة للتعديل في هذا الصف', n ? undefined : 'warning');
    }

    async function copyPrevWeek() {
        if (saving) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (loading || !data) {return;}
        if (!confirmDiscard('نسخ الأسبوع السابق سيستبدلها')) {return;}
        const prevWs = weekOf(data.weekStart, -1);
        if (!prevWs) {return;}
        saving = true;
        saveBtn.disabled = true;
        try {
            const prev = await fetchRosterWeek(prevWs, deptSel || undefined);
            if (!el.isConnected) {return;}
            const pGrid = Array.isArray(prev.grid) ? prev.grid : [];
            if (!pGrid.length) {notify(`لا بيانات في الأسبوع السابق (${prevWs}) لهذا النطاق`, 'warning'); return;}
            const byId = new Map(pGrid.map((g) => [String(g.id), g]));
            let n = 0;
            el.querySelectorAll('td[data-v2-cell]').forEach((td) => {
                const src = byId.get(String(td.dataset.id));
                const c = src && Array.isArray(src.cells) ? src.cells[Number(td.dataset.day)] : null;
                if (!c) {return;}
                const start = td.querySelector('[data-v2-edit="start"]');
                const hours = td.querySelector('[data-v2-edit="hours"]');
                const off = td.querySelector('[data-v2-edit="off"]');
                if (!start || !hours || !off) {return;}
                start.value = String(c.shift_start || td.dataset.origStart);
                hours.value = String(c.shift_hours ?? td.dataset.origHours);
                off.checked = c.day_off != null;
                markCellChange(td);
                n += 1;
            });
            notify(n ? `نُسخت ${formatInt(n)} خلية من أسبوع ${prevWs} — راجع ثم احفظ` : 'لا خلايا قابلة للتعديل لهذا النسخ', n ? undefined : 'warning');
        } catch (e) {
            if (!el.isConnected) {return;}
            notify(`تعذّر نسخ الأسبوع السابق: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
            if (el.isConnected) {refreshDirtyUi();}
        }
    }

    async function save() {
        if (saving) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (loading || !data) {return;}
        if (!dirty.size) {notify('لا تعديلات للحفظ'); return;}
        const bad = [...dirty.values()].find((e) => e.error);
        if (bad) {
            formErrorEl.textContent = `خلية غير صالحة (${bad.date} — موظف #${bad.id}): ${bad.error} — صحّحها ثم أعد الحفظ`;
            notify('خلية غير صالحة — راجع الرسالة تحت الشبكة');
            const td = el.querySelector(`td[data-v2-cell][data-id="${bad.id}"][data-date="${bad.date}"]`);
            if (td) {td.querySelector('[data-v2-edit="start"]')?.focus();}
            return;
        }
        const cells = dirtyToCells(dirty);
        if (cells.length > ROSTER_MAX_CELLS) {
            formErrorEl.textContent = `حد الحفظة الواحدة ${ROSTER_MAX_CELLS} خلية — احفظ الأسبوع على دفعتين`;
            return;
        }
        const empCount = new Set(cells.map((c) => c.id)).size;
        const hadApproval = rosterApprovalState(data.approval).key !== 'none';
        const note = hadApproval ? ' والاعتماد المسجَّل لهذا الأسبوع سيُلغى — السلامة أولًا.' : '';
        const who = userName ? ` تُسجَّل باسمك: ${userName}.` : '';
        if (!confirmFn(`حفظ ${formatInt(cells.length)} خلية دوام (${formatInt(empCount)} موظفًا) في أسبوع ${data.weekStart}؟${note}${who}`)) {return;}
        saving = true;
        saveBtn.disabled = true;
        formErrorEl.textContent = '';
        try {
            const res = await saveRosterWeek({ dept: deptSel || undefined, weekStart: data.weekStart, cells });
            if (!el.isConnected) {return;}
            const updated = res && res.updated != null ? Number(res.updated) : cells.length;
            dirty.clear();
            notify(`حُفظت ${formatInt(updated)} خلية دوام${hadApproval ? ' — وأُلغي اعتماد هذا الأسبوع المسجَّل (الخادم يصفّره مع أي تعديل)' : ''}. كل خلية تُطبَّق في تاريخها عبر مجدول المحرك.`);
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            const msg = (e && e.message) || 'خطأ';
            formErrorEl.textContent = `حفظ غير مُنفَّذ: ${msg}`;
            notify(`حفظ غير منفّذ: ${msg}`, 'error');
        } finally {
            saving = false;
            if (el.isConnected) {refreshDirtyUi();}
        }
    }

    async function requestApproval() {
        if (saving) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (!data) {return;}
        if (dirty.size && !confirmFn('لديك تعديلات غير محفوظة — الاعتماد يُرسل لشبكة الخادم المحفوظة دونها. متابعة؟')) {return;}
        saving = true;
        try {
            await requestRosterApproval({ dept: deptSel || undefined, weekStart: data.weekStart });
            if (!el.isConnected) {return;}
            notify('أُرسل طلب الاعتماد إلى شؤون العاملين — أي حفظ لاحق يُلغيه.');
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify(`إرسال الاعتماد غير منفّذ: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
            if (el.isConnected) {refreshDirtyUi();}
        }
    }

    async function approve(deptKey) {
        if (saving) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        if (!data) {return;}
        if (!confirmFn(`اعتماد طباعة دوامات «${deptKey}» لأسبوع ${data.weekStart}؟ يُسجَّل باسمك${userName ? ': ' + userName : ''}.`)) {return;}
        saving = true;
        try {
            const res = await approveRoster({ deptKey, weekStart: data.weekStart });
            if (!el.isConnected) {return;}
            const by = res && res.approval && res.approval.approved_name ? String(res.approval.approved_name) : userName;
            notify(`اعتُمدت طباعة هذا الأسبوع — التوقيع: ${by}`);
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify(`اعتماد غير منفّذ: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
            if (el.isConnected) {refreshDirtyUi();}
        }
    }

    el.addEventListener('click', (event) => {
        const t = event.target;
        const nav = t.closest('[data-v2-weeknav]');
        if (nav) {
            if (saving) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
            const delta = Number(nav.dataset.delta) || 0;
            if (!confirmDiscard(delta === 0 ? 'العودة لأسبوع اليوم ستتجاهلها' : 'تبديل الأسبوع سيتجاهلها')) {return;}
            weekSel = delta === 0 ? '' : weekOf((data && data.weekStart) || weekSel, delta);
            if (delta !== 0 && !weekSel) {return;}
            reload();
            return;
        }
        if (t.closest('[data-v2-reload]')) {
            if (saving) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
            if (!confirmDiscard('التحديث سيتجاهلها')) {return;}
            reload();
            return;
        }
        if (t.closest('[data-v2-print]')) {window.print(); return;}
        if (t.closest('[data-v2-save]')) {save(); return;}
        if (t.closest('[data-v2-copy-prev]')) {copyPrevWeek(); return;}
        const rowBtn = t.closest('[data-v2-copy-row]');
        if (rowBtn) {copyRow(rowBtn); return;}
        if (t.closest('[data-v2-apr-request]')) {requestApproval(); return;}
        const aprBtn = t.closest('[data-v2-apr-approve]');
        if (aprBtn) {approve(aprBtn.dataset.key); return;}
        const pendBtn = t.closest('[data-v2-pending-approve]');
        if (pendBtn) {approve(pendBtn.dataset.key); return;}
        if (t.closest('[data-erp-retry]')) {reload();}
    });

    el.addEventListener('change', (event) => {
        const t = event.target;
        if (t.matches('[data-v2-dept]')) {
            const next = String(t.value || '');
            if (next === deptSel) {return;}
            if (!confirmDiscard('تبديل القسم سيتجاهلها')) {t.value = deptSel; return;}
            deptSel = next;
            reload();
            return;
        }
        if (t.matches('[data-v2-edit]')) {
            const td = t.closest('td[data-v2-cell]');
            if (td) {markCellChange(td);}
        }
    });

    reload();

    return {
        el,
        reload,
        getRows: () => (data && Array.isArray(data.grid) ? data.grid : []),
        getDirty: () => Array.from(dirty.values()),
        destroy() {
            logTable.destroy();
            el.remove();
        },
    };
}
