/**
 * V2 — Users screen · إدارة حسابات الدخول والربط (أدمن فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * Behavior mirror of the users half of features/settings-users.js:596-716
 * (read fully): admin gate · cards→table · search · add/edit panel (role
 * select, dept_head multi-dept mandatory, employee link, active flag,
 * password required+strong on create, optional on edit, username frozen) ·
 * delete (never self) · password vault view · reset-code issue · employee
 * link kept through edit. The server re-checks everything (PASSWORD_REQUIRED
 * / PASSWORD_TOO_WEAK / ROLE_ASSIGNMENT_FORBIDDEN / dept-head link).
 *
 * World-class deltas (no behavior change): EnterpriseDataTable instead of
 * cards (search/sort built in) · inline panels instead of modals · no
 * blocking dialogs · bulk import (26د) mounted inline behind the admin role
 * and the independent `v2bulkimport` flag (OFF by default).
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.130';
import { canWrite } from '../session.js?v=4.9.130';
import { bulkImportWriteEnabled } from '../write-flags.js?v=4.9.130';
import { mountBulkImportWizard } from '../bulk-import-wizard.js?v=4.9.130';
import { formatInt } from '../data/reports-repo.js?v=4.9.130';
import { ROLES } from '../../core/config.js?v=4.9.130';
import {
    USERS_WRITE_ROLES, validateUserForm, createUser, updateUser, deleteUser,
    linkUserEmployee, fetchUserPassword, issueUserResetCode, fetchUserLinkData,
} from '../data/users-repo.js?v=4.9.130';
import { fetchUsers, userToRow } from '../data/portal-repo.js?v=4.9.130';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function template(canAdmin, canBulk) {
    return `
      <div class="erp-v2-users">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">المستخدمون
              <span class="erp-eyebrow" dir="ltr" lang="en">Users</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite" data-v2-note>الحساب للدخول والصلاحيات، والموظف للسجل الوظيفي والحضور والراتب.</div>
          </div>
          <div class="erp-dash-controls">
            ${canAdmin ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm erp-no-print" data-v2-add>
              <i class="ji" data-i="plus" aria-hidden="true"></i><span>مستخدم جديد</span>
            </button>` : ''}
            ${canBulk ? `<button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-bulk>
              <i class="ji" data-i="users" aria-hidden="true"></i><span>استيراد جماعي</span>
            </button>` : ''}
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>
        <div data-v2-body></div>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, userId?: number|string|null, notify?: (message:string, kind?:string)=>void, confirmFn?: (m:string)=>boolean|Promise<boolean>}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountUsersScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 users]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const canAdmin = canWrite(ctx.role, USERS_WRITE_ROLES) && ctx.role === 'admin';
    const canBulk = canAdmin && bulkImportWriteEnabled();
    const selfId = ctx.userId !== null && ctx.userId !== undefined ? String(ctx.userId) : null;

    let rows = [];
    let employees = [];
    let departments = [];
    let loading = false;
    let saving = false;
    let panelUser = null; // null = إضافة، صف = تعديل
    let bulkWizard = null;

    host.insertAdjacentHTML('beforeend', template(canAdmin, canBulk));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const body = q('[data-v2-body]');
    const noteEl = q('[data-v2-note]');

    const say = (m, kind) => { if (noteEl) {noteEl.textContent = m;} notify(m, kind); };

    const table = createDataTable({
        caption: 'المستخدمون — بيانات حية', mode: 'client', pageSize: 50,
        stickyHeader: true, emptyMessage: 'لا يوجد مستخدمون',
        rowKey: (r) => r.id,
        columns: [
            { key: 'username', header: 'اسم المستخدم', sortable: true, filterable: true, className: 'erp-mono', render: (r) => `<span dir="ltr">@${esc(r.username)}</span>` },
            { key: 'name', header: 'الاسم', sortable: true, filterable: true },
            {
                key: 'role', header: 'الدور', sortable: true, filterable: true, width: '150px',
                render: (r) => (r.role ? `<span class="erp-badge" data-tone="brand">${esc((ROLES[r.role] && ROLES[r.role].name) || r.role)}</span>` : '—'),
            },
            { key: 'dept_code', header: 'القسم', width: '120px', render: (r) => (r.dept_code ? esc(r.dept_code) : '<span class="erp-text-muted">—</span>') },
            {
                key: 'active', header: 'الحالة', width: '100px', align: 'center',
                render: (r) => (r.active ? '<span class="erp-badge" data-tone="success">نشط</span>' : '<span class="erp-badge" data-tone="neutral">موقوف</span>'),
            },
            { key: 'employeeName', header: 'موظف مرتبط', width: '160px', render: (r) => (r.employeeName ? esc(String(r.employeeName)) : '<span class="erp-text-muted">غير مربوط</span>') },
            ...(canAdmin ? [{
                key: 'actions', header: 'إجراءات', width: '230px',
                render: (r) => {
                    const isSelf = selfId !== null && String(r.id) === selfId;
                    return `<span class="erp-row-wrap">`
                    + `<button type="button" class="erp-btn erp-btn--sm" data-v2-edit="${esc(String(r.id))}" aria-label="تعديل ${esc(r.name)}"><i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span></button>`
                    + `<button type="button" class="erp-btn erp-btn--sm" data-v2-pw="${esc(String(r.id))}" aria-label="عرض كلمة المرور"><i class="ji" data-i="eye" aria-hidden="true"></i></button>`
                    + (!isSelf && r.active ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-reset="${esc(String(r.id))}" aria-label="رمز استعادة" title="رمز استعادة (10 دقائق، استخدام واحد)"><i class="ji" data-i="key" aria-hidden="true"></i></button>` : '')
                    + (!isSelf ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-del="${esc(String(r.id))}" aria-label="حذف ${esc(r.name)}"><i class="ji" data-i="trash" aria-hidden="true"></i></button>` : '')
                    + `</span>`;
                },
            }] : []),
        ],
    });

    function paintShell() {
        body.innerHTML = `<section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">دليل الحسابات <span class="erp-text-muted erp-text-sm">(${formatInt(rows.length)})</span></h3>
        </div><div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted">السجل يمر عبر publicEntityRow (بلا كلمات مرور) — الخزنة والرموز بأزرار الصف.</p>
          <div data-v2-table></div>
        </div></section><div data-v2-panel></div>`;
        body.querySelector('[data-v2-table]').appendChild(table.el);
        table.setRows(rows);
    }

    function empOptions(selectedId, userId) {
        return `<option value="">بدون موظف</option>` + employees
            .filter((e) => !e.userId || String(e.userId) === String(userId || ''))
            .map((e) => `<option value="${esc(String(e.id))}"${String(e.id) === String(selectedId || '') ? ' selected' : ''}>${esc(e.name)} — ${esc(e.employeeId || '')}</option>`).join('');
    }

    function deptBoxes(selected) {
        const current = String(selected || '').split(',').map((x) => x.trim()).filter(Boolean);
        return departments.map((d) => {
            const code = d.code || d.id;
            const label = d.name || d.name_ar || code;
            return `<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-radius:8px">`
                + `<input type="checkbox" data-v2-deptbox value="${esc(String(code))}"${current.includes(String(code)) ? ' checked' : ''}> <span>${esc(String(label))}</span></label>`;
        }).join('');
    }

    function roleOptions(selected) {
        return Object.keys(ROLES).map((k) => `<option value="${esc(k)}"${k === selected ? ' selected' : ''}>${esc(ROLES[k].name)}</option>`).join('');
    }

    function linkedEmpName(userId) {
        const e = employees.find((x) => String(x.userId) === String(userId));
        return e ? `${e.name} — ${e.employeeId || ''}` : '';
    }

    function closeBulkPanel() {
        if (bulkWizard && typeof bulkWizard.destroy === 'function') {bulkWizard.destroy();}
        bulkWizard = null;
    }

    /** معالج الاستيراد الجماعي داخل البطاقة نفسها — لا شاشة جديدة ولا تنقّل. */
    function openBulkPanel() {
        if (!canBulk) {return;}
        if (loading) {say('جارٍ تحميل البيانات — انتظر لحظة ثم أعد فتح الاستيراد'); return;}
        let holder = body.querySelector('[data-v2-panel]');
        if (!holder) {paintShell(); holder = body.querySelector('[data-v2-panel]');}
        if (!holder) {say('تعذّر فتح معالج الاستيراد — أعد تحميل الشاشة'); return;}
        closeBulkPanel();
        holder.innerHTML = '';
        const mount = document.createElement('div');
        holder.appendChild(mount);
        bulkWizard = mountBulkImportWizard(mount, {
            notify: say,
            confirmFn,
            onDone: async () => {
                closeBulkPanel();
                holder.innerHTML = '';
                if (el.isConnected) {await reload();}
            },
            onCancel: () => {
                closeBulkPanel();
                holder.innerHTML = '';
            },
        });
        holder.scrollIntoView({ block: 'nearest' });
    }

    function openPanel(user) {
        closeBulkPanel();
        panelUser = user || null;
        const holder = body.querySelector('[data-v2-panel]');
        const isEdit = !!user;
        holder.innerHTML = `<section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">${isEdit ? `تعديل حساب: ${esc(user.name)}` : 'مستخدم جديد وربطه بموظف'}</h3>
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-x>إغلاق</button>
        </div><div class="erp-card__body erp-stack">
          ${isEdit ? '' : '<p class="erp-text-sm erp-text-muted">الحساب يحدد تسجيل الدخول والصلاحيات، والربط يوصله بالسجل الوظيفي والحضور والراتب.</p>'}
          ${isEdit ? '<p class="erp-text-sm erp-text-muted">اسم المستخدم ثابت كمعرّف دخول. اترك كلمة المرور فارغة دون تغيير.</p>' : ''}
          <div class="erp-dash-controls">
            <label class="erp-text-sm erp-text-muted">الاسم</label>
            <input class="erp-input" data-v2-f="name" value="${isEdit ? esc(user.name) : ''}" autocomplete="off">
            <label class="erp-text-sm erp-text-muted">اسم المستخدم</label>
            <input class="erp-input erp-input--ltr" data-v2-f="username" value="${isEdit ? esc(user.username) : ''}" ${isEdit ? 'readonly aria-readonly="true"' : ''} autocomplete="off" dir="ltr">
          </div>
          <div class="erp-dash-controls">
            <label class="erp-text-sm erp-text-muted">كلمة المرور${isEdit ? ' الجديدة' : ''}</label>
            <input class="erp-input" data-v2-f="password" type="password" placeholder="${isEdit ? 'فارغة = دون تغيير' : '8 حروف على الأقل مع حرف ورقم'}" autocomplete="new-password">
            <label class="erp-text-sm erp-text-muted">الدور</label>
            <select class="erp-select" data-v2-f="role">${roleOptions(isEdit ? user.role : '')}</select>
          </div>
          <div data-v2-deptwrap>
            <label class="erp-text-sm erp-text-muted">قسم الرئيس <small>(إجباري لرئيس القسم — أكثر من قسم مدعوم)</small></label>
            <div style="max-height:200px;overflow-y:auto;border:1px solid var(--erp-border);border-radius:10px;padding:10px">${deptBoxes(isEdit ? user.dept_code : '')}</div>
          </div>
          <div class="erp-dash-controls">
            <label class="erp-text-sm erp-text-muted">الموظف المرتبط</label>
            <select class="erp-select" data-v2-f="employee">${empOptions(isEdit ? (employees.find((x) => String(x.userId) === String(user.id)) || {}).id : '', isEdit ? user.id : null)}</select>
            <label class="erp-text-sm erp-text-muted">الحالة</label>
            <select class="erp-select" data-v2-f="active">
              <option value="true"${!isEdit || user.active !== false ? ' selected' : ''}>نشط</option>
              <option value="false"${isEdit && user.active === false ? ' selected' : ''}>موقوف</option>
            </select>
          </div>
          <div data-v2-form-err role="alert" class="erp-text-sm" style="color:var(--erp-danger-text)"></div>
          <div class="erp-dash-controls">
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-save><i class="ji" data-i="save" aria-hidden="true"></i><span>${isEdit ? 'حفظ التعديل' : 'حفظ وربط الحساب'}</span></button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-panel-x>إلغاء</button>
          </div>
        </div></section>`;
        syncDeptWrap();
        holder.scrollIntoView({ block: 'nearest' });
    }

    function syncDeptWrap() {
        const role = body.querySelector('[data-v2-f="role"]')?.value;
        const wrap = body.querySelector('[data-v2-deptwrap]');
        if (wrap) {wrap.style.display = role === 'dept_head' ? '' : 'none';}
    }

    function closePanel() {
        const holder = body.querySelector('[data-v2-panel]');
        if (holder) {holder.innerHTML = '';}
        panelUser = null;
    }

    function formErr(t) {
        const box = body.querySelector('[data-v2-form-err]');
        if (box) {box.textContent = t || '';}
        if (t) {say(t);}
    }

    function readForm(isEdit) {
        const v = (n) => body.querySelector(`[data-v2-f="${n}"]`)?.value ?? '';
        const role = v('role');
        const dept_code = role === 'dept_head'
            ? [...body.querySelectorAll('[data-v2-deptbox]:checked')].map((x) => x.value).join(',') || null
            : null;
        return {
            name: v('name').trim(),
            username: v('username').trim(),
            password: v('password'),
            role,
            dept_code,
            employeeId: v('employee') || null,
            active: v('active') !== 'false',
            isEdit,
        };
    }

    async function savePanel() {
        if (saving) {return;}
        const isEdit = !!panelUser;
        const f = readForm(isEdit);
        const chk = validateUserForm(f, { isEdit });
        if (!chk.ok) {formErr(chk.errors.join(' · ')); return;}
        saving = true;
        try {
            if (!isEdit) {
                const payload = { username: f.username, password: f.password, role: f.role, name: f.name, active: f.active };
                if (f.role === 'dept_head') {payload.dept_code = f.dept_code;}
                if (hasDuplicateUsername(rows, f.username)) {formErr('اسم المستخدم موجود بالفعل'); saving = false; return;}
                const saved = await createUser(payload);
                if (f.employeeId) {
                    try {await linkUserEmployee(saved.id, f.employeeId);}
                    catch (e) {say(`أُنشئ الحساب وفشل الربط: ${(e && e.message) || 'خطأ'}`);}
                }
                say(f.employeeId ? 'تم إنشاء الحساب وربطه بالموظف بنجاح' : 'تم إنشاء الحساب ويمكن ربطه بموظف من التعديل');
            } else {
                const payload = { name: f.name, role: f.role, active: f.active };
                if (f.role === 'dept_head') {payload.dept_code = f.dept_code;}
                if (f.password) {payload.password = f.password;}
                await updateUser(panelUser.id, payload);
                try {await linkUserEmployee(panelUser.id, f.employeeId);}
                catch (e) {say(`حُفظ الحساب وفشل الربط: ${(e && e.message) || 'خطأ'}`);}
                say('تم حفظ تعديل الحساب وربط الموظف في قاعدة البيانات');
            }
            if (!el.isConnected) {return;}
            closePanel();
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            formErr((e && e.message) || 'تعذر الحفظ');
        } finally {
            saving = false;
        }
    }

    function hasDuplicateUsername(list, username) {
        return (list || []).some((u) => String(u.username) === String(username));
    }

    async function confirmDelete(user) {
        if (selfId !== null && String(user.id) === selfId) {say('لا يمكن حذف حسابك'); return;}
        if (!await confirmFn('حذف هذا المستخدم؟')) {return;}
        try {
            await deleteUser(user.id);
            if (!el.isConnected) {return;}
            say('تم حذف المستخدم من قاعدة البيانات');
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            say((e && e.message) || 'تعذر حذف المستخدم');
        }
    }

    function showSecret(title, sub, value, copyLabel) {
        closeBulkPanel();
        const holder = body.querySelector('[data-v2-panel]');
        holder.innerHTML = `<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">${esc(title)}</h3>`
            + `<span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-x>إغلاق</button></div>`
            + `<div class="erp-card__body erp-stack"><p class="erp-text-sm erp-text-muted">${sub}</p>`
            + `<div class="erp-mono" dir="ltr" style="text-align:center;font-size:26px;font-weight:800;letter-spacing:2px" data-v2-secret>${esc(value)}</div>`
            + `<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--sm" data-v2-copy>${esc(copyLabel)}</button></div>`
            + `</div></section>`;
        holder.scrollIntoView({ block: 'nearest' });
    }

    async function viewPassword(user) {
        try {
            const r = await fetchUserPassword(user.id);
            if (!el.isConnected) {return;}
            if (!r.available) {
                showSecret(`كلمة مرور ${user.name}`, 'لا توجد نسخة محفوظة لهذا الحساب (أُنشئ قبل تفعيل الخزنة). افتح «تعديل» وحدد كلمة مرور جديدة وستُسجَّل تلقائيًا وتظهر هنا بعدها.', '—', 'إغلاق');
                return;
            }
            showSecret(`كلمة مرور ${user.name}`, `اسم المستخدم: @${user.username} — هذه النسخة تُحدَّث تلقائيًا مع كل تعيين كلمة مرور لهذا الحساب.`, r.password, 'نسخ');
        } catch {
            if (!el.isConnected) {return;}
            say('تعذر جلب كلمة المرور — حاول مرة أخرى');
        }
    }

    async function resetCode(user) {
        try {
            const data = await issueUserResetCode(user.username);
            if (!el.isConnected) {return;}
            showSecret('رمز استعادة لكلمة المرور',
                `أعطِ هذا الرمز للموظف ${data.user_name || user.name} (@${data.username || user.username}) ليغيّر كلمة مروره بنفسه من شاشة الدخول عبر زر «نسيت كلمة المرور؟». صالح 10 دقائق · استخدام واحد فقط · إصدار رمز جديد يُبطل هذا الرمز.`,
                data.code, 'نسخ الرمز');
        } catch (e) {
            if (!el.isConnected) {return;}
            say((e && e.message) || 'تعذر إصدار رمز الاستعادة');
        }
    }

    async function reload() {
        if (loading) {return;}
        closeBulkPanel();
        if (!paintShellGate()) {return;}
        loading = true;
        try {
            const [us, link] = await Promise.all([fetchUsers(), fetchUserLinkData().catch(() => ({ employees: [], departments: [] }))]);
            if (!el.isConnected) {return;}
            rows = (Array.isArray(us) ? us : []).map(userToRow);
            employees = link.employees || [];
            departments = link.departments || [];
            for (const r of rows) {r.employeeName = linkedEmpName(r.id) || r.employeeName;}
            paintShell();
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = [];
            paintShell();
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض المستخدمين بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل المستخدمين: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
        }
    }

    function paintShellGate() {
        if (!canAdmin) {
            body.innerHTML = `<div class="erp-card"><div class="erp-card__body"><p><i class="ji" data-i="lock" aria-hidden="true"></i> هذه الصفحة للمدير فقط</p></div></div>`;
            return false;
        }
        return true;
    }

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-f="role"]')) {syncDeptWrap();}
    });

    el.addEventListener('click', async (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-bulk]')) {openBulkPanel(); return;}
        if (event.target.closest('[data-v2-add]')) {openPanel(null); return;}
        if (event.target.closest('[data-v2-panel-x]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-save]')) {savePanel(); return;}
        if (event.target.closest('[data-v2-copy]')) {
            const v = body.querySelector('[data-v2-secret]')?.textContent || '';
            if (v && v !== '—' && navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(v).then(() => say('نُسخ')).catch(() => {});
            } else {closePanel();}
            return;
        }
        const eb = event.target.closest('[data-v2-edit]');
        if (eb) {
            const u = rows.find((r) => String(r.id) === String(eb.dataset.v2Edit));
            if (u) {openPanel(u);}
            return;
        }
        const db = event.target.closest('[data-v2-del]');
        if (db) {
            const u = rows.find((r) => String(r.id) === String(db.dataset.v2Del));
            if (u) {confirmDelete(u);}
            return;
        }
        const pb = event.target.closest('[data-v2-pw]');
        if (pb) {
            const u = rows.find((r) => String(r.id) === String(pb.dataset.v2Pw));
            if (u) {viewPassword(u);}
            return;
        }
        const rb = event.target.closest('[data-v2-reset]');
        if (rb) {
            const u = rows.find((r) => String(r.id) === String(rb.dataset.v2Reset));
            if (u) {resetCode(u);}
        }
    });

    if (paintShellGate()) {reload();}

    return {
        el, reload, getRows: () => rows,
        destroy() { table.destroy(); el.remove(); },
    };
}
