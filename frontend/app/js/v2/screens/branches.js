/**
 * V2 — Branches screen (أول شاشة تقرأ بيانات حقيقية)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHY BRANCHES FIRST
 *   Smallest surface in the app that has a real API and a real contract:
 *   five endpoints, one table, no accounting. If V2 is going to read live
 *   data, this is where a mistake costs the least.
 *
 * RULES THIS FILE FOLLOWS
 *   • No network of its own — every call goes through v2/data/branches-repo.js.
 *   • No inline handlers (onclick=, oninput=): the origin sends a CSP
 *     *nonce*, which makes 'unsafe-inline' inert for scripts, so inline
 *     handlers never run. Every listener here is addEventListener, most of
 *     them delegated on this screen's own root — which is also why the root
 *     is created per mount: re-mounting into the same host must not leave a
 *     second copy of these listeners behind.
 *   • Read-only when the role is not admin, and that is a UI convenience
 *     only — backend/branch-routes.js#requireRole is what actually decides.
 *   • It never deletes. `deactivate` is the server's soft stop
 *     (is_active = FALSE); historical rows keep pointing at the branch.
 *   • A click cannot start two of the same operation: `saving` / `loading`
 *     guards, because this app has already been hurt by a repeat-click
 *     convoy (dispatch approvals, 2026-10-13).
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.152';
import { statusBadge } from '../status.js?v=4.9.152';
import { canWrite } from '../session.js?v=4.9.152';
import {
    fetchBranches,
    createBranch,
    updateBranch,
    deactivateBranch,
    reactivateBranch,
    validateBranch,
} from '../data/branches-repo.js?v=4.9.152';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const FIELDS = ['code', 'name_ar', 'name_en', 'currency', 'timezone', 'phone', 'address'];

function template(writable) {
    return `
      <section class="erp-card erp-v2-branches">
        <div class="erp-card__head">
          <h3 class="erp-card__title">فروع المنشأة
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <label class="erp-row erp-text-sm"${writable ? '' : ' hidden'}>
            <input type="checkbox" data-v2-all>
            <span>إظهار المعطّلة</span>
          </label>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm"${writable ? '' : ' hidden'} data-v2-add>
            <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة فرع</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <div data-v2-form hidden></div>
          <div data-v2-table></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void,
 *          confirmFn?: (message:string)=>boolean}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountBranchesScreen(host, ctx = {}) {
    const writable = canWrite(ctx.role);
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 branches]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);

    let rows = [];
    let showAll = false;
    let loading = false;
    let saving = false;
    let editing = null;          // row being edited; null while creating

    host.insertAdjacentHTML('beforeend', template(writable));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const countEl = q('[data-v2-count]');
    const formHost = q('[data-v2-form]');

    const table = createDataTable({
        caption: 'فروع المنشأة',
        mode: 'client',
        pageSize: 25,
        stickyHeader: true,
        emptyMessage: 'لا توجد فروع',
        emptyHint: 'أضف فرعًا جديدًا أو فعّل «إظهار المعطّلة».',
        rowKey: (row) => row.id,
        onRowActivate: writable ? (row) => openForm(row) : null,
        columns: [
            { key: 'id', header: '#', type: 'number', sortable: true, width: '70px', align: 'end' },
            { key: 'code', header: 'الكود', sortable: true, filterable: true, width: '130px', className: 'erp-addr' },
            { key: 'name_ar', header: 'الاسم (عربي)', sortable: true, filterable: true },
            { key: 'name_en', header: 'الاسم (إنجليزي)', filterable: true, hidden: true },
            { key: 'currency', header: 'العملة', sortable: true, width: '90px', align: 'center', className: 'erp-addr' },
            { key: 'timezone', header: 'المنطقة الزمنية', sortable: true, filterable: true, width: '170px' },
            { key: 'phone', header: 'الهاتف', width: '140px', className: 'erp-addr', hidden: true },
            { key: 'address', header: 'العنوان', filterable: true, hidden: true },
            {
                key: 'status',
                header: 'الحالة',
                sortable: true,
                filterable: true,
                width: '120px',
                value: (row) => row.status,
                render: (row) => statusBadge('branches', row.status),
            },
            ...(writable ? [{
                key: 'actions',
                header: 'إجراءات',
                width: '190px',
                align: 'end',
                value: () => '',
                render: (row) => `
                  <span class="erp-row-wrap">
                    <button type="button" class="erp-btn erp-btn--sm" data-v2-act="edit" data-id="${esc(row.id)}">
                      <i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span>
                    </button>
                    ${row.status === 'active'
                        ? `<button type="button" class="erp-btn erp-btn--sm"${row.is_main ? ' disabled title="الفرع الرئيسي لا يُوقف"' : ''}
                             data-v2-act="deactivate" data-id="${esc(row.id)}" data-name="${esc(row.name_ar)}">
                           <i class="ji" data-i="circle-x" aria-hidden="true"></i><span>إيقاف</span>
                         </button>`
                        : `<button type="button" class="erp-btn erp-btn--sm" data-v2-act="reactivate" data-id="${esc(row.id)}">
                           <i class="ji" data-i="circle-check" aria-hidden="true"></i><span>تفعيل</span>
                         </button>`}
                  </span>`,
            }] : []),
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    /* ── Data ─────────────────────────────────────────────────────────── */
    async function reload() {
        if (loading) {return;}
        loading = true;
        table.setLoading(true);
        try {
            rows = await fetchBranches({ showAll });
            if (!el.isConnected) {return;}          // destroyed while in flight
            table.setRows(rows);
            countEl.textContent = `(${rows.length})`;
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = [];
            table.setRows([]);
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — أعد تحميل الصفحة بعد تسجيل الدخول.'
                : `تعذّر تحميل الفروع: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading = false;
        }
    }

    /* ── Form (in-card panel — no legacy modal, no inline handler) ───── */
    function fieldHtml(key, label, opts = {}) {
        const value = editing ? (editing[key] ?? '') : (opts.default ?? '');
        return `
          <div class="erp-field">
            <label class="erp-label" for="v2br-${key}">${esc(label)}${opts.required ? ' *' : ''}</label>
            <input class="erp-input${opts.ltr ? ' erp-input--ltr' : ''}" id="v2br-${key}" name="${key}"
                   value="${esc(value)}"
                   ${opts.maxlength ? `maxlength="${opts.maxlength}"` : ''}
                   ${key === 'code' && editing ? 'readonly' : ''}
                   placeholder="${esc(opts.placeholder || '')}">
          </div>`;
    }

    function formHtml() {
        return `
          <form class="erp-stack" data-v2-form-el novalidate>
            <h4 class="erp-card__title">${editing ? 'تعديل الفرع' : 'فرع جديد'}</h4>
            <div class="erp-row-wrap">
              <div class="erp-grow">${fieldHtml('code', 'الكود', { required: true, ltr: true, maxlength: 20, placeholder: 'BR-2' })}</div>
              <div class="erp-grow">${fieldHtml('currency', 'العملة', { ltr: true, maxlength: 3, default: 'SAR', placeholder: 'SAR / EGP / AED' })}</div>
            </div>
            ${fieldHtml('name_ar', 'الاسم بالعربية', { required: true })}
            ${fieldHtml('name_en', 'الاسم بالإنجليزية')}
            <div class="erp-row-wrap">
              <div class="erp-grow">${fieldHtml('timezone', 'المنطقة الزمنية', { ltr: true, default: 'Asia/Riyadh', placeholder: 'Asia/Riyadh' })}</div>
              <div class="erp-grow">${fieldHtml('phone', 'الهاتف', { ltr: true })}</div>
            </div>
            ${fieldHtml('address', 'العنوان')}
            <p class="erp-text-sm erp-text-muted">${editing
                ? 'الكود معرّف ثابت لا يتغيّر بعد الإنشاء — السجلات المرتبطة به تبقى سليمة.'
                : 'الكود معرّف خارجي للسجلات، ولا يمكن تعديله بعد الإنشاء.'}</p>
            <div class="erp-error" data-v2-form-error role="alert"></div>
            <div class="erp-row-wrap">
              <span class="erp-grow"></span>
              <button type="button" class="erp-btn" data-v2-form-cancel>إلغاء</button>
              <button type="submit" class="erp-btn erp-btn--primary" data-v2-form-save>
                <i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ</span>
              </button>
            </div>
          </form>`;
    }

    function openForm(row) {
        if (!writable) {return;}
        editing = row || null;
        formHost.innerHTML = formHtml();
        formHost.hidden = false;
        const first = editing ? '[name="name_ar"]' : '[name="code"]';
        formHost.querySelector(first)?.focus();
    }

    function closeForm() {
        editing = null;
        formHost.hidden = true;
        formHost.innerHTML = '';
    }

    function readForm() {
        const out = {};
        const form = formHost.querySelector('[data-v2-form-el]');
        if (!form) {return out;}
        for (const key of FIELDS) {
            const input = form.querySelector(`[name="${key}"]`);
            out[key] = input ? input.value : '';
        }
        return out;
    }

    function showFormErrors(errors) {
        const box = formHost.querySelector('[data-v2-form-error]');
        if (!box) {return;}
        box.textContent = errors.map((e) => e.message).join(' · ');
        const form = formHost.querySelector('[data-v2-form-el]');
        if (!form) {return;}
        for (const key of FIELDS) {
            const input = form.querySelector(`[name="${key}"]`);
            if (input) {input.setAttribute('aria-invalid', errors.some((e) => e.field === key) ? 'true' : 'false');}
        }
    }

    async function submitForm(event) {
        event.preventDefault();
        if (saving) {return;}
        const form = readForm();
        const errors = validateBranch(form, { editing: !!editing });
        if (errors.length) {
            showFormErrors(errors);
            return;
        }
        showFormErrors([]);
        saving = true;
        const saveBtn = formHost.querySelector('[data-v2-form-save]');
        if (saveBtn) {saveBtn.disabled = true;}
        try {
            if (editing) {
                await updateBranch(editing.id, form);
                notify(`تم تعديل الفرع «${form.name_ar.trim()}»`);
            } else {
                await createBranch(form);
                notify(`تم إنشاء الفرع «${form.name_ar.trim()}»`);
            }
            closeForm();
            await reload();
        } catch (e) {
            // The server's rule wins — show its reason verbatim, never a
            // paraphrase that could hide what actually failed.
            showFormErrors([{ field: '', message: (e && e.message) || 'فشل الحفظ' }]);
        } finally {
            saving = false;
            const btn = formHost.querySelector('[data-v2-form-save]');
            if (btn) {btn.disabled = false;}
        }
    }

    /* ── Actions ──────────────────────────────────────────────────────── */
    async function runAction(action, id, name) {
        if (saving) {return;}
        if (action === 'deactivate' && !confirmFn(
            `إيقاف الفرع «${name}»؟ يُخفى من القوائم، وسجلاته التاريخية تبقى كما هي.`)) {return;}
        saving = true;
        try {
            if (action === 'deactivate') {
                await deactivateBranch(id);
                notify(`تم إيقاف الفرع «${name}»`);
            } else if (action === 'reactivate') {
                await reactivateBranch(id);
                notify('تمت إعادة تفعيل الفرع');
            }
            await reload();
        } catch (e) {
            notify(`فشلت العملية: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
        }
    }

    /* ── Wiring (delegated: one listener for the whole table) ────────── */
    table.el.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-v2-act]');
        if (btn) {
            if (btn.disabled) {return;}
            const row = rows.find((r) => String(r.id) === btn.dataset.id);
            runAction(btn.dataset.v2Act, btn.dataset.id, row ? row.name_ar : '');
            return;
        }
        // The table's own retry button clears the error but cannot refetch in
        // client mode — the host owns the data, so the refetch lives here.
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-add]')) {openForm(null); return;}
        if (event.target.closest('[data-v2-form-cancel]')) {closeForm();}
    });

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-all]')) {
            showAll = event.target.checked;
            reload();
        }
    });

    formHost.addEventListener('submit', submitForm);

    reload();

    return {
        el,
        reload,
        getRows: () => rows,
        destroy() {
            closeForm();
            table.destroy();
            el.remove();
        },
    };
}
