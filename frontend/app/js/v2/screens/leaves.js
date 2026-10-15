/**
 * V2 — Leave requests screen · شاشة 10 في سجل الترحيل (قراءة + قرار مرحلي)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Same per-screen contract as 01-09: one network door per read
 * (v2/data/leaves-repo.js), delegated listeners on a per-mount root,
 * loading guards (loading → queued → newest read wins), isConnected checks,
 * destroy() on nav, no invented values.
 *
 * WHAT THIS PAGE ANSWERS
 *   «أين توقفت طلبات الإجازة، ومن يملك القرار فيها الآن؟» — the chain state,
 *   the current stage, the note each stage left, and the audit trail behind
 *   it. Creating a request is a POST door with its own form (features/hr.js:588
 *   is the legacy modal) and stays a separate screen; so do return/resubmit,
 *   which the door supports (:179) but this screen does not offer.
 *
 * THE LIST YOU SEE IS NOT THE LIST YOUR COLLEAGUE SEES
 *   The door scopes by role server-side (leave-workflow-routes.js:100-112)
 *   and sends no LIMIT. The scope line therefore prints the reader's own
 *   scope, from the mirrored contract, so nobody reads an empty list as
 *   «لا إجازات في الشركة».
 *
 * AN APPROVE IS NOT A SIGNATURE — IT IS A HAND-OFF, UNTIL IT ISN'T
 *   The server moves the request to the NEXT stage and answers with
 *   stage_label/event_label (:226). The notification quotes those words, so a
 *   mid-chain click never reads «تم اعتماد الإجازة» while the general manager
 *   still holds it. But a reject leaves the stage where it was written (:216)
 *   and the last approve closes the chain (:214) — for those two the request
 *   has no next holder, so the sentence follows the status the server sent,
 *   never the button that was pressed. The row itself repaints from a fresh
 *   read, not optimism.
 *
 * A REJECTION NEEDS A REASON WRITTEN BY A HUMAN
 *   The server stores its own fallback text if the note is empty (:220), and
 *   the legacy page refuses an empty prompt (features/hr.js:624). This screen
 *   opens a note panel instead of window.prompt (CSP-safe, no inline
 *   handlers) and refuses to send an empty reason.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.131';
import { statusBadge, resolveStatus } from '../status.js?v=4.9.131';
import {
    fetchLeaveWorkflow, fetchLeaveTypes, leaveToRow, leaveStateOf, leaveTypeMap,
    summarizeLeaves, buildLeavesKpis, topRequesters, flattenEvents, typeToRow,
    doorScopeNote, canActOnStage, decideLeave, approveOutcome, STAGE_LABELS_AR,
    LEAVES_TYPE_PAGE, LEAVES_TYPE_PAGES, createLeaveRequest, isPrivilegedLeaveRole,
} from '../data/leaves-repo.js?v=4.9.131';
import { fetchEmployees } from '../data/employees-repo.js?v=4.9.131';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const TOP_PORTLET = 6;

/** The chain states the door can send (:211-221). Words and tones come from
 *  the shared registry (status.js:88-97 → features/hr.js:573), so a chip and
 *  its badge can never disagree. */
const STATES = [
    { key: 'all', label: 'الكل' },
    { key: 'in_progress' },
    { key: 'returned' },
    { key: 'completed' },
    { key: 'rejected' },
];

const stateWord = (key) => (key === 'all' ? 'الكل' : resolveStatus('leave_workflow', key).label);

/** Local HH:MM — an approver needs to know how old the list in front of them is. */
function clockNow() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function daysCell(v) {
    return v === null
        ? '<span class="erp-text-muted" title="تاريخان ناقصان أو معكوسان — لا مدة تُختراع">—</span>'
        : `<span class="erp-num" dir="ltr">${esc(v)}</span>`;
}

function stateCell(row) {
    const st = leaveStateOf(row);
    const s = resolveStatus(st.domain, st.key);
    if (!s.known) {
        return `<span class="erp-text-muted" title="حالة مخزنة غير متوقعة — تُعرض خامًا">${esc(st.key || '—')}</span>`;
    }
    return statusBadge(st.domain, st.key, {
        title: row.hasChain
            ? ''
            : 'لا سجل سلسلة اعتماد لهذا الطلب — تُعرض حالة الكيان المخزنة',
    });
}

/** Stage word from the server's own map; an unmirrored stage shows the stored
 *  key rather than borrowing someone else's label. */
function stageCell(row) {
    if (!row.stage) {
        return '<span class="erp-text-muted" title="لا مرحلة مخزنة">—</span>';
    }
    return row.stageKnown
        ? esc(row.stageAr)
        : `<span class="erp-text-muted" title="مرحلة مخزنة غير متوقعة — تُعرض خامًا">${esc(row.stage)}</span>`;
}

/** NetSuite's rule: six in the portlet, the rest stay in the register. */
function topPortlet(items, max) {
    if (!items.length) {
        return `<div class="erp-state" role="status">
          <span class="erp-state__title">لا طلبات في نطاقك</span>
          <span>لم يُرسل الباب أي طلب لهذا الحساب — لا رقم يُختلق لصف غائب.</span>
        </div>`;
    }
    return `<ul class="erp-tops" role="list" aria-label="أكثر الموظفين طلبًا في السجل المُرسل">`
        + items.map((p) => `
          <li class="erp-top__row">
            <span class="erp-top__name${p.resolved ? '' : ' erp-text-muted'}" title="${esc(`${p.name}: ${p.count} طلبًا، منها ${p.open} قيد الاعتماد`)}">${esc(p.name)}</span>
            <span class="erp-top__track"><span class="erp-top__fill" style="inline-size:${max > 0 ? Math.round((p.count / max) * 100) : 0}%"></span></span>
            <span class="erp-top__val"><span class="erp-num" dir="ltr">${esc(p.count)}</span> <span class="erp-text-sm erp-text-muted">طلب</span></span>
          </li>`).join('')
        + `</ul>`;
}

function stateSeg(active, counts) {
    return `<div class="erp-seg" role="group" aria-label="حالة سلسلة الاعتماد">`
        + `<span class="erp-seg__label">الحالة</span>`
        + STATES.map((s) => `<button type="button" data-v2-state="${esc(s.key)}"${s.key === active ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(stateWord(s.key))} <span class="erp-num" dir="ltr">${esc(counts[s.key])}</span></button>`).join('')
        + `</div>`;
}

function template() {
    return `
      <div class="erp-v2-leaves">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">الإجازات
              <span class="erp-eyebrow" dir="ltr" lang="en">Leave Requests</span>
            </h2>
            <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <span data-v2-stateseg>${stateSeg('all', { all: '—', in_progress: '—', returned: '—', completed: '—', rejected: '—' })}</span>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-new>
              <i class="ji" data-i="plus" aria-hidden="true"></i><span>طلب إجازة</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-print aria-label="طباعة السجل">
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--primary erp-no-print" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>

        <div data-v2-kpis></div>
        <p class="erp-text-sm erp-text-muted" data-v2-window-note role="status" aria-live="polite"></p>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">طلبات الإجازة
              <span class="erp-eyebrow" dir="ltr" lang="en">The Chain</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted" data-v2-chain-note></span>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted erp-no-print">
              قراءة من <span class="erp-addr" dir="ltr">/api/hr/leave-workflow</span>
              (leave-workflow-routes.js:97) — الخادم يقرر نطاق القراءة وحده. مسار الاعتماد:
              الموظف ← المدير المباشر ← المدير العام ← شؤون العاملين، والتعديل المباشر
              للطلب مرفوض من الخادم (405، server.js:2056). الإنشاء من الزر أعلاه،
              والطلب العائد يُعاد إرساله من صاحبه.
            </p>
            <div data-v2-requests></div>
            <div class="erp-stack erp-no-print" data-v2-create hidden>
              <div class="erp-field">
                <label class="erp-label" for="v2leave-new-emp">الموظف</label>
                <select class="erp-input" id="v2leave-new-emp" data-v2-new-emp></select>
              </div>
              <div class="erp-field">
                <label class="erp-label" for="v2leave-new-type">نوع الإجازة</label>
                <select class="erp-input" id="v2leave-new-type" data-v2-new-type></select>
              </div>
              <div class="erp-row-wrap">
                <div class="erp-field">
                  <label class="erp-label" for="v2leave-new-from">من تاريخ</label>
                  <input class="erp-input" id="v2leave-new-from" data-v2-new-from type="date">
                </div>
                <div class="erp-field">
                  <label class="erp-label" for="v2leave-new-to">إلى تاريخ</label>
                  <input class="erp-input" id="v2leave-new-to" data-v2-new-to type="date">
                </div>
              </div>
              <div class="erp-field">
                <label class="erp-label" for="v2leave-new-reason">السبب</label>
                <textarea class="erp-input" id="v2leave-new-reason" data-v2-new-reason rows="2" maxlength="500"></textarea>
              </div>
              <div class="erp-row-wrap">
                <button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-new-send>
                  <i class="ji" data-i="send" aria-hidden="true"></i><span>إرسال الطلب</span>
                </button>
                <button type="button" class="erp-btn erp-btn--sm" data-v2-new-cancel>
                  <i class="ji" data-i="x" aria-hidden="true"></i><span>إلغاء</span>
                </button>
              </div>
              <div class="erp-error" data-v2-new-error role="alert"></div>
            </div>
            <div class="erp-stack erp-no-print" data-v2-return hidden>
              <div class="erp-field">
                <label class="erp-label" for="v2leave-return-note">الملاحظة المطلوبة من الموظف — تُخزَّن كما تكتبها</label>
                <textarea class="erp-input" id="v2leave-return-note" data-v2-return-note rows="2" maxlength="500"
                  placeholder="مثال: أرفق تقرير الإجازة المرضية ثم أعد الإرسال."></textarea>
              </div>
              <div class="erp-row-wrap">
                <button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-return-send>
                  <i class="ji" data-i="undo" aria-hidden="true"></i><span>إعادة للموظف</span>
                </button>
                <button type="button" class="erp-btn erp-btn--sm" data-v2-return-cancel>
                  <i class="ji" data-i="x" aria-hidden="true"></i><span>إلغاء</span>
                </button>
                <span class="erp-text-sm erp-text-muted" data-v2-return-target></span>
              </div>
              <div class="erp-error" data-v2-return-error role="alert"></div>
            </div>
            <div class="erp-stack erp-no-print" data-v2-reject hidden>
              <div class="erp-field">
                <label class="erp-label" for="v2leave-reject-note">سبب الرفض — يُخزَّن كما تكتبه ويظهر للموظف</label>
                <textarea class="erp-input" id="v2leave-reject-note" data-v2-reject-note rows="2" maxlength="500"
                  placeholder="مثال: الرصيد المستنفد؛ أعد الطلب بعد ترتيب مواعيد الغلة."></textarea>
              </div>
              <div class="erp-row-wrap">
                <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-reject-send>
                  <i class="ji" data-i="circle-x" aria-hidden="true"></i><span>تأكيد الرفض</span>
                </button>
                <button type="button" class="erp-btn erp-btn--sm" data-v2-reject-cancel>
                  <i class="ji" data-i="x" aria-hidden="true"></i><span>إلغاء</span>
                </button>
                <span class="erp-text-sm erp-text-muted" data-v2-reject-target></span>
              </div>
              <div class="erp-error" data-v2-form-error role="alert"></div>
            </div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">أكثر الموظفين طلبًا
              <span class="erp-eyebrow" dir="ltr" lang="en">Top Requesters</span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted" data-v2-top-note></span>
          </div>
          <div class="erp-card__body">
            <div data-v2-top></div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">سجل الاعتماد
              <span class="erp-eyebrow" dir="ltr" lang="en">Approval Events</span>
              <span class="erp-text-muted erp-text-sm" data-v2-evccount></span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted">أحداث السلسلة كما أرسلها الباب، الأحدث أولًا</span>
          </div>
          <div class="erp-card__body">
            <div data-v2-events></div>
          </div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">أنواع الإجازات
              <span class="erp-eyebrow" dir="ltr" lang="en">Leave Types</span>
              <span class="erp-text-muted erp-text-sm" data-v2-typecount></span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted">مرجع مخزّن؛ «الأيام» رصد الخادم لا حساب هذه الشاشة</span>
          </div>
          <div class="erp-card__body">
            <div data-v2-types></div>
          </div>
        </section>

        <p class="erp-print-note" data-v2-print-note></p>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void, confirmFn?: (message:string)=>boolean}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], getState: ()=>string, destroy: ()=>void}}
 */
export function mountLeavesScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 leaves]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const role = ctx.role || null;

    let rows = [];
    let types = [];
    let typeInfo = { total: 0, capped: false };
    let events = [];
    let stateFilter = 'all';
    let readAt = '';
    let loading = false;
    let queued = false;          // a refresh asked for while one was running
    let saving = false;          // one decision at a time
    let rejectTarget = null;     // row id the open note panel speaks about

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const kpisEl = q('[data-v2-kpis]');
    const scopeEl = q('[data-v2-scope-line]');
    const windowNoteEl = q('[data-v2-window-note]');
    const countEl = q('[data-v2-count]');
    const chainNoteEl = q('[data-v2-chain-note]');
    const evCountEl = q('[data-v2-evccount]');
    const typeCountEl = q('[data-v2-typecount]');
    const topNoteEl = q('[data-v2-top-note]');
    const segHolder = q('[data-v2-stateseg]');
    const printNote = q('[data-v2-print-note]');
    const rejectPanel = q('[data-v2-reject]');
    const rejectNoteEl = q('[data-v2-reject-note]');
    const rejectTargetEl = q('[data-v2-reject-target]');
    const formErrorEl = q('[data-v2-form-error]');
    const returnPanel = q('[data-v2-return]');
    const returnNoteEl = q('[data-v2-return-note]');
    const returnTargetEl = q('[data-v2-return-target]');
    const returnErrorEl = q('[data-v2-return-error]');
    const createPanel = q('[data-v2-create]');
    let returnTarget = null;     // row id the return panel speaks about
    let employeesCache = null;   // active employees for the create form

    function closeReturn() {
        returnTarget = null;
        if (returnPanel) {returnPanel.hidden = true;}
        if (returnNoteEl) {returnNoteEl.value = '';}
        if (returnErrorEl) {returnErrorEl.textContent = '';}
    }

    function closeCreate() {
        if (createPanel) {createPanel.hidden = true;}
        const err = q('[data-v2-new-error]');
        if (err) {err.textContent = '';}
    }

    async function openCreate() {
        closeReject();
        closeReturn();
        createPanel.hidden = false;
        const empSel = q('[data-v2-new-emp]');
        const typeSel = q('[data-v2-new-type]');
        typeSel.innerHTML = (types || []).map((t) => `<option value="${esc(String(t.id))}">${esc(t.icon || '')} ${esc(t.name)}${t.days ? ` (${esc(String(t.days))} يوم)` : ''}</option>`).join('');
        if (isPrivilegedLeaveRole(role)) {
            try {
                if (!employeesCache) {
                    const list = await fetchEmployees();
                    employeesCache = (Array.isArray(list) ? list : []).filter((e) => e.status === 'active');
                }
                if (!el.isConnected) {return;}
                empSel.innerHTML = employeesCache.map((e) => `<option value="${esc(String(e.id))}">${esc(e.name)}</option>`).join('');
            } catch {
                if (!el.isConnected) {return;}
                empSel.innerHTML = '<option value="">تعذّر تحميل الموظفين</option>';
            }
        } else {
            empSel.innerHTML = '<option value="">طلبك (يشتقه الخادم من حسابك)</option>';
        }
        const today = new Date().toISOString().slice(0, 10);
        q('[data-v2-new-from]').value = today;
        q('[data-v2-new-to]').value = today;
        q('[data-v2-new-reason]').value = '';
        empSel.focus();
    }

    async function submitCreate() {
        if (saving) {return;}
        const err = q('[data-v2-new-error]');
        const employeeId = q('[data-v2-new-emp]')?.value || '';
        const leaveTypeId = q('[data-v2-new-type]')?.value || '';
        const startDate = q('[data-v2-new-from]')?.value || '';
        const endDate = q('[data-v2-new-to]')?.value || '';
        const reason = (q('[data-v2-new-reason]')?.value || '').trim();
        if (!leaveTypeId || !startDate || !endDate) {
            err.textContent = 'أكمل النوع والتواريخ المطلوبة';
            return;
        }
        if (endDate < startDate) {
            err.textContent = 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية';
            return;
        }
        saving = true;
        try {
            const res = await createLeaveRequest({
                employeeId: isPrivilegedLeaveRole(role) ? (employeeId || undefined) : undefined,
                leaveTypeId: Number(leaveTypeId), startDate, endDate, reason,
            });
            if (!el.isConnected) {return;}
            closeCreate();
            const stage = res && res.stage_label ? String(res.stage_label) : 'المدير المباشر';
            notify(`تم إرسال الطلب، وهو الآن لدى ${stage}`);
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            err.textContent = (e && e.message) || 'تعذر إرسال طلب الإجازة';
        } finally {
            saving = false;
        }
    }

    const table = createDataTable({
        caption: 'طلبات الإجازة في نطاق هذا الحساب — الأحدث أولًا كما رتّبها الباب',
        mode: 'client',
        pageSize: 15,
        stickyHeader: true,
        emptyMessage: 'لا طلبات في هذه الحالة',
        emptyHint: 'غيّر شريط الحالة أو حدّث؛ القائمة محصورة فيما أرسله الخادم لدورك.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'employee', header: 'الموظف', sortable: true, filterable: true,
                render: (row) => (row.employeeResolved ? esc(row.employee)
                    : `<span class="erp-text-muted" title="لا اسم موظف في الربط — يُعرض رقم السجل">${esc(row.employee)}</span>`),
            },
            {
                key: 'type', header: 'النوع', sortable: true, filterable: true, width: '150px',
                render: (row) => (row.typeResolved ? esc(row.type)
                    : `<span class="erp-text-muted" title="لا اسم نوع في الربط — يُعرض رقم السجل">${esc(row.type)}</span>`),
            },
            {
                key: 'start', header: 'من', sortable: true, width: '118px', align: 'center',
                render: (row) => (row.start
                    ? `<span class="erp-num" dir="ltr">${esc(row.start)}</span>`
                    : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'end', header: 'إلى', sortable: true, width: '118px', align: 'center',
                render: (row) => (row.end
                    ? `<span class="erp-num" dir="ltr">${esc(row.end)}</span>`
                    : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'days', header: 'المدة (يوم)', sortable: true, type: 'number',
                width: '110px', align: 'end', value: (row) => (row.days === null ? -1 : row.days),
                render: (row) => daysCell(row.days),
            },
            {
                key: 'stageAr', header: 'لدى من الآن', sortable: true, filterable: true, width: '150px',
                value: (row) => (row.stageKnown ? row.stageAr : row.stage),
                render: stageCell,
            },
            {
                key: 'wfStatus', header: 'الحالة', sortable: true, width: '170px',
                value: (row) => leaveStateOf(row).key,
                render: stateCell,
            },
            {
                key: 'note', header: 'الملاحظة/السبب', filterable: true,
                render: (row) => (row.note ? esc(row.note) : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'decidedAt', header: 'تاريخ القرار', sortable: true, width: '118px', align: 'center',
                render: (row) => (row.decidedAt
                    ? `<span class="erp-num" dir="ltr">${esc(row.decidedAt)}</span>`
                    : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'actions', header: 'القرار', width: '250px', align: 'end', value: () => '',
                render: (row) => {
                    const parts = [];
                    if (canActOnStage(role, row.stage, row.wfStatus)) {
                        parts.push(`<button type="button" class="erp-btn erp-btn--sm" data-v2-act="approve" data-id="${esc(row.id)}">`
                            + `<i class="ji" data-i="circle-check" aria-hidden="true"></i><span>اعتماد</span></button>`);
                        parts.push(`<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-act="reject" data-id="${esc(row.id)}">`
                            + `<i class="ji" data-i="circle-x" aria-hidden="true"></i><span>رفض</span></button>`);
                        parts.push(`<button type="button" class="erp-btn erp-btn--sm" data-v2-act="return" data-id="${esc(row.id)}">`
                            + `<i class="ji" data-i="undo" aria-hidden="true"></i><span>إعادة للموظف</span></button>`);
                    }
                    if (row.wfStatus === 'returned') {
                        parts.push(`<button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-act="resubmit" data-id="${esc(row.id)}">`
                            + `<i class="ji" data-i="send" aria-hidden="true"></i><span>إعادة إرسال</span></button>`);
                    }
                    return parts.length ? `<span class="erp-row-wrap">${parts.join('')}</span>`
                        : '<span class="erp-text-muted" title="القرار هنا لدى مرحلة أخرى أو السلسلة مقفولة — الخادم هو صاحب الكلمة">—</span>';
                },
            },
        ],
    });

    const evTable = createDataTable({
        caption: 'أحداث سلسلة الاعتماد — من فعل ماذا ومتى',
        mode: 'client',
        pageSize: 10,
        stickyHeader: true,
        emptyMessage: 'لا أحداث بعد',
        emptyHint: 'الباب يرسل أحداث كل طلب معه؛ طلب بلا حدث يعني أنه لم يدخل السلسلة بعد.',
        rowKey: (row) => row.key,
        columns: [
            { key: 'employee', header: 'الموظف', sortable: true, filterable: true },
            {
                key: 'requestId', header: 'الطلب', width: '150px', align: 'center',
                className: 'erp-mono', sortable: true,
                render: (row) => `<span class="erp-num" dir="ltr">${esc(row.requestId)}</span>`,
            },
            {
                key: 'stageAr', header: 'المرحلة', sortable: true, filterable: true, width: '150px',
                value: (row) => (row.stageKnown ? row.stageAr : row.stage),
                render: (row) => (row.stage
                    ? (row.stageKnown ? esc(row.stageAr)
                        : `<span class="erp-text-muted" title="مرحلة مخزنة غير متوقعة — تُعرض خامًا">${esc(row.stage)}</span>`)
                    : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'actionAr', header: 'الحدث', sortable: true, filterable: true, width: '190px',
                value: (row) => (row.actionKnown ? row.actionAr : row.action),
                render: (row) => (row.action
                    ? (row.actionKnown ? esc(row.actionAr)
                        : `<span class="erp-text-muted" title="إجراء مخزن غير متوقع — يُعرض خامًا">${esc(row.action)}</span>`)
                    : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'note', header: 'الملاحظة', filterable: true,
                render: (row) => (row.note ? esc(row.note) : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'actorRole', header: 'دور الفاعل', sortable: true, width: '130px',
                render: (row) => (row.actorRole
                    ? `<span class="erp-addr" dir="ltr">${esc(row.actorRole)}</span>`
                    : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'at', header: 'التوقيت', sortable: true, width: '150px', align: 'center', className: 'erp-tnum',
                render: (row) => (row.at
                    ? `<span class="erp-num" dir="ltr">${esc(row.at)}</span>`
                    : '<span class="erp-text-muted">—</span>'),
            },
        ],
    });

    const typeTable = createDataTable({
        caption: 'أنواع الإجازات المخزنة — المرجع الذي يقرأه نموذج الطلب',
        mode: 'client',
        pageSize: 10,
        stickyHeader: true,
        emptyMessage: 'لا أنواع مخزنة',
        emptyHint: 'بلا نوع لا يُنشأ طلب: الخادم يرفض بـ LEAVE_REFERENCE_NOT_FOUND (:162).',
        rowKey: (row) => row.id,
        columns: [
            { key: 'name', header: 'النوع', sortable: true, filterable: true },
            {
                key: 'days', header: 'الأيام المرصودة', sortable: true, type: 'number',
                width: '140px', align: 'end', value: (row) => (row.days === null ? -1 : row.days),
                render: (row) => daysCell(row.days),
            },
            {
                key: 'paid', header: 'مدفوعة الأجر', sortable: true, type: 'number',
                width: '130px', align: 'center', value: (row) => (row.paid ? 1 : 0),
                render: (row) => `<span class="erp-row-wrap"><span class="erp-dot ${row.paid ? 'erp-dot--success' : 'erp-dot--warning'}" aria-hidden="true"></span><span>${row.paid ? 'نعم' : 'لا'}</span></span>`,
            },
            {
                key: 'requests', header: 'طلباتها في السجل', sortable: true, type: 'number',
                width: '150px', align: 'end', value: (row) => row.requests,
                render: (row) => `<span class="erp-num" dir="ltr">${esc(row.requests)}</span>`,
            },
            {
                key: 'icon', header: 'الأيقونة', width: '140px',
                render: (row) => (row.icon
                    ? `<span class="erp-addr" dir="ltr" title="مفتاح أيقونة مخزّن">${esc(row.icon)}</span>`
                    : '<span class="erp-text-muted">—</span>'),
            },
        ],
    });

    q('[data-v2-requests]').appendChild(table.el);
    q('[data-v2-events]').appendChild(evTable.el);
    q('[data-v2-types]').appendChild(typeTable.el);

    const counts = () => {
        const s = summarizeLeaves(rows);
        return {
            all: s.total,
            in_progress: s.inProgress,
            returned: s.returned,
            completed: s.completed,
            rejected: s.rejected,
        };
    };

    function closeReject() {
        rejectTarget = null;
        rejectPanel.hidden = true;
        rejectNoteEl.value = '';
        rejectTargetEl.textContent = '';
        formErrorEl.textContent = '';
    }

    /** One read paints everything; the state filter is a client slice of the
     *  sent register, so changing it never costs a request. */
    function paint() {
        const c = counts();
        const s = summarizeLeaves(rows);
        segHolder.innerHTML = stateSeg(stateFilter, c);
        const shown = stateFilter === 'all' ? rows
            : rows.filter((r) => r.wfStatus === stateFilter);
        table.setRows(shown);

        const byType = new Map();
        for (const r of rows) {
            if (r.typeId) {byType.set(r.typeId, (byType.get(r.typeId) || 0) + 1);}
        }
        typeTable.setRows(types.map((t) => typeToRow(t, byType.get(String(t.id ?? '')) || 0)));

        events = flattenEvents(rows);
        evTable.setRows(events);

        const paidTypes = types.filter((t) => t.paid).length;
        kpisEl.innerHTML = `<ul class="erp-kpis" aria-label="مؤشرات الإجازات — كل رقم معدود على السجل الذي أرسله الخادم لهذا الحساب">`
            + buildLeavesKpis(s, types.length, paidTypes).map((k) => `
          <li class="erp-kpi">
            <div class="erp-kpi__top">
              <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon)}"></i></span>
              <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
            </div>
            <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value.toLocaleString('en-US'))}</span>${k.unit ? ` <span class="erp-kpi__unit">${esc(k.unit)}</span>` : ''}</div>
            <div class="erp-kpi__foot"><span class="erp-kpi__hint">${esc(k.hint)}</span></div>
          </li>`).join('')
            + `</ul>`;

        const top = topRequesters(rows, TOP_PORTLET);
        const max = top.length ? top[0].count : 0;
        q('[data-v2-top]').innerHTML = topPortlet(top, max);
        topNoteEl.textContent = top.length > 1
            ? `أكبر ${Math.min(TOP_PORTLET, top.length)} من ${s.employees} موظفًا في السجل — ترتيبٌ محسوب هنا`
            : `${top.length} من ${s.employees} موظفًا في السجل`;

        countEl.textContent = shown.length ? `(${shown.length})` : '';
        chainNoteEl.textContent = stateFilter === 'all'
            ? `${c.all} طلبًا · ${s.employees} موظفًا · آخر قراءة ${readAt}`
            : `${shown.length} من ${c.all} في هذه الحالة`;
        evCountEl.textContent = events.length ? `(${events.length})` : '';
        typeCountEl.textContent = types.length ? `(${types.length})` : '';

        windowNoteEl.textContent = typeInfo.capped
            ? `مرجع الأنواع توقّف عند ${LEAVES_TYPE_PAGE * LEAVES_TYPE_PAGES} نوعًا من ${typeInfo.total} — الأنواع الأقدم خارج هذه الطبقة`
            : (typeInfo.total > types.length
                ? `أُرسل ${types.length} من ${typeInfo.total} نوعًا — الباقي وراء نهاية المشي`
                : '');

        scopeEl.textContent = rows.length
            ? `${doorScopeNote(role)} · ${c.all} طلبًا محمّل (${c.in_progress} قيد الاعتماد، ${c.completed} معتمدة نهائيًا، ${c.rejected} مرفوضة${c.returned ? `، ${c.returned} أعيدت` : ''}) · ${types.length} نوعًا مخزّنًا · آخر قراءة ${readAt}`
            : `${doorScopeNote(role)} · لا طلبات في هذا النطاق عند آخر قراءة (${readAt})`;
        printNote.textContent = `الإجازات — ${c.all} طلبًا (${c.in_progress} قيد الاعتماد، ${c.completed} معتمدة نهائيًا، ${c.rejected} مرفوضة${c.returned ? `، ${c.returned} أعيدت` : ''}) · ${events.length} حدثًا · ${types.length} نوعًا · ${doorScopeNote(role)} · آخر قراءة ${readAt}. المطبوعة تعرض الصفحة الحالية من كل جدول، لا السجل كاملًا.`;
    }

    function paintError(message) {
        rows = [];
        types = [];
        events = [];
        closeReject();
        kpisEl.innerHTML = '';
        segHolder.innerHTML = stateSeg(stateFilter, { all: '—', in_progress: '—', returned: '—', completed: '—', rejected: '—' });
        windowNoteEl.textContent = '';
        scopeEl.textContent = '';
        countEl.textContent = '';
        chainNoteEl.textContent = '';
        evCountEl.textContent = '';
        typeCountEl.textContent = '';
        topNoteEl.textContent = '';
        q('[data-v2-top]').innerHTML = '';
        printNote.textContent = `الإجازات — ${message}`;
        table.setError(message);
        evTable.setError(message);
        typeTable.setError(message);
    }

    async function reload() {
        if (loading) {queued = true; return;}
        loading = true;
        table.setLoading(true);
        evTable.setLoading(true);
        typeTable.setLoading(true);
        try {
            const [wf, tp] = await Promise.all([
                fetchLeaveWorkflow(),
                fetchLeaveTypes().catch(() => ({ rows: [], total: 0, capped: false })),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            const typeById = leaveTypeMap(tp.rows);
            rows = wf.map((l) => leaveToRow(l, typeById));
            types = tp.rows;
            typeInfo = { total: tp.total, capped: tp.capped };
            readAt = clockNow();
            if (rejectTarget && !rows.some((r) => String(r.id) === String(rejectTarget))) {closeReject();}
            paint();
            if (!rows.length) {
                notify('لا طلبات في نطاق هذا الحساب — الباب يرسل ما يراه دورك فقط، فلا يُقرأ الفراغ «لا إجازات في الشركة».');
            }
        } catch (e) {
            if (!el.isConnected) {return;}
            paintError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض الإجازات بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل طلبات الإجازة: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
            if (queued && el.isConnected) {
                queued = false;
                reload();                            // the newest read wins
            }
        }
    }

    /** Server words for the answer (:226). The hand-off phrasing is only true
     *  while the chain still has a next holder: a reject parks the request at
     *  the stage that rejected it (:216) and the last approve closes it (:214),
     *  so «الطلب الآن لدى» would promise a handler that does not exist. The
     *  status in the server's own workflow row — not the button pressed —
     *  decides which sentence is honest. */
    function decisionMessage(res, verb) {
        const label = res && res.event_label ? String(res.event_label) : `تم ${verb}`;
        const stage = res && res.stage_label ? String(res.stage_label) : '';
        const status = res && res.workflow && res.workflow.status ? String(res.workflow.status) : '';
        if (!stage) {return `${label} — أُعيدت قراءة السجل`;}
        if (status === 'rejected') {return `${label} — سُجّل الرفض لدى ${stage}، ولا مرحلة تالية بعد الرفض`;}
        if (status === 'completed') {return `${label} — اكتملت السلسلة، والقفل لدى ${stage}`;}
        if (status === 'returned') {return `${label} — عاد الطلب إلى ${stage} ليعدّلَه الموظف`;}
        if (status === 'in_progress') {return `${label} — الطلب الآن لدى ${stage}`;}
        return `${label} — المرحلة ${stage} كما أرسلها الخادم`;
    }

    async function sendDecision(action, id, note) {
        if (saving) {return;}
        const row = rows.find((r) => String(r.id) === String(id));
        if (!row) {
            notify('الطلب لم يعد في متناول هذا القرار — أعِد التحديث؛ الخادم هو صاحب الكلمة.');
            return;
        }
        if (action !== 'resubmit' && !canActOnStage(role, row.stage, row.wfStatus)) {
            notify('الطلب لم يعد في متناول هذا القرار — أعِد التحديث؛ الخادم هو صاحب الكلمة.');
            return;
        }
        if (action === 'resubmit' && row.wfStatus !== 'returned') {
            notify('إعادة الإرسال للطلب العائد فقط — الخادم هو صاحب الكلمة.');
            return;
        }
        saving = true;
        try {
            const res = await decideLeave(id, action, note);
            if (action === 'reject') {closeReject();}
            if (action === 'return') {closeReturn();}
            const verbs = { approve: 'اعتماد المرحلة', reject: 'رفض الطلب', return: 'إعادة الطلب للموظف', resubmit: 'إعادة إرسال الطلب' };
            notify(decisionMessage(res, verbs[action] || action));
            await reload();
        } catch (e) {
            const msg = (e && e.message) || 'خطأ';
            if (action === 'reject') {formErrorEl.textContent = `رفضٌ غير مُنفَّذ: ${msg}`;}
            else if (action === 'return') {
                const re = q('[data-v2-return-error]');
                if (re) {re.textContent = `إعادة غير منفَّذة: ${msg}`;}
                else {notify(`قرار غير منفّذ: ${msg}`, 'error');}
            } else {notify(`قرار غير منفّذ: ${msg}`, 'error');}
        } finally {
            saving = false;
            paint();
        }
    }

    function askApprove(row) {
        const period = row.days === null
            ? `${row.start || '؟'} ← ${row.end || '؟'} (مدة غير محسوبة)`
            : `${row.start} ← ${row.end} (${row.days} يومًا)`;
        const stageWord = row.stageKnown ? row.stageAr : (row.stage || '؟');
        const outcome = approveOutcome(row.stage);
        const move = outcome.known
            ? (outcome.final ? 'وبهذا الاعتماد تُقفل السلسلة' : `نقلٌ من مرحلة ${stageWord} إلى مرحلة ${STAGE_LABELS_AR[outcome.next] || outcome.next}`)
            : 'ونقلٌ في السلسلة يحدده الخادم';
        if (!confirmFn(`اعتماد إجازة ${row.employee} — ${period}؟ ${move}، ويسجَّل باسمك بدور ${role || 'غير معروف'}.`)) {return;}
        sendDecision('approve', row.id, '');
    }

    el.addEventListener('click', (event) => {
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            if (saving) {return;}
            const row = rows.find((r) => String(r.id) === String(actBtn.dataset.id));
            if (!row) {return;}
            if (actBtn.dataset.v2Act === 'reject') {
                rejectTarget = row.id;
                rejectPanel.hidden = false;
                formErrorEl.textContent = '';
                rejectTargetEl.textContent = `مرفوض باسمك: ${row.employee} — ${row.type}`;
                rejectNoteEl.focus();
                return;
            }
            if (actBtn.dataset.v2Act === 'return') {
                returnTarget = row.id;
                closeReject();
                returnPanel.hidden = false;
                if (returnErrorEl) {returnErrorEl.textContent = '';}
                returnTargetEl.textContent = `عائد باسمك: ${row.employee} — ${row.type}`;
                returnNoteEl.focus();
                return;
            }
            if (actBtn.dataset.v2Act === 'resubmit') {
                if (!confirmFn(`إعادة إرسال طلب إجازة ${row.employee} — ${row.type}؟ يعود للمدير المباشر من جديد.`)) {return;}
                sendDecision('resubmit', row.id, '');
                return;
            }
            askApprove(row);
            return;
        }
        if (event.target.closest('[data-v2-reject-send]')) {
            if (saving || !rejectTarget) {return;}
            const reason = String(rejectNoteEl.value || '').trim();
            if (!reason) {
                formErrorEl.textContent = 'الرفض بلا سبب مكتوب مرفوض هنا — الخادم يخزّن عندئذٍ نصه الافتراضي، ويكون سببًا لم يكتبه أحد.';
                rejectNoteEl.focus();
                return;
            }
            sendDecision('reject', rejectTarget, reason);
            return;
        }
        if (event.target.closest('[data-v2-reject-cancel]')) {closeReject(); return;}
        if (event.target.closest('[data-v2-return-send]')) {
            if (saving || !returnTarget) {return;}
            const note = String(returnNoteEl.value || '').trim();
            if (!note) {
                returnErrorEl.textContent = 'الإعادة بلا ملاحظة مرفوضة — اكتب ما تطلبه من الموظف.';
                returnNoteEl.focus();
                return;
            }
            sendDecision('return', returnTarget, note);
            return;
        }
        if (event.target.closest('[data-v2-return-cancel]')) {closeReturn(); return;}
        if (event.target.closest('[data-v2-new]')) {openCreate(); return;}
        if (event.target.closest('[data-v2-new-cancel]')) {closeCreate(); return;}
        if (event.target.closest('[data-v2-new-send]')) {submitCreate(); return;}
        const stateBtn = event.target.closest('[data-v2-state]');
        if (stateBtn) {
            if (stateBtn.dataset.v2State === stateFilter) {return;}
            stateFilter = stateBtn.dataset.v2State;
            paint();
            return;
        }
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    reload();

    return {
        el,
        reload,
        getRows: () => rows,
        getState: () => stateFilter,
        destroy() {
            table.destroy();
            evTable.destroy();
            typeTable.destroy();
            el.remove();
        },
    };
}
