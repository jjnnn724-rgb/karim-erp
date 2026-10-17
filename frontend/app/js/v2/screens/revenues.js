/**
 * V2 — Revenues screen · شاشة 15 (قراءة + تعديل/حذف finance.edit)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Same per-screen contract as 01-14: delegated listeners on a per-mount
 * root, loading guards, isConnected checks, destroy() on nav — وبابان
 * بدل واحد: القراءة من finance-repo.js والكتابة من finance-write-repo.js
 * (لا fetch ولا apiFetch في نص الشاشة أصلًا).
 *
 * LEGACY PARITY (features/finance.js:9-32 · :135-164)
 *   Default lens = current month (owner request 2026-10-08, finance.js:35);
 *   filters: dept (code), from, to, free search; net-shown total card;
 *   print. Newest first. The walk cap (newest 8,000 rows) is stated in
 *   the UI. التعديل والحذف ببوابة finance.edit (أدناه)، والإنشاء ليس هنا.
 *
 * P1-2 (عقد الإكمال بند ٢ — «4 كتابات + تصحيح أدوار»):
 *   عمود إجراءات يُرسم فقط لدور FINANCE_WRITE_ROLES =
 *   admin|manager|accountant (مرآة schema-registry:772-773، الخادم يعيد
 *   الفحص على app.put/app.delete). الحذف يسأل confirmFn أولًا (مرآة
 *   legacy confirm في finance.js:157) والرفض لا يرسل نداءً. الإضافة
 *   ليست في هذا الملف: POST /revenues بابه dept-detail.js (زر «إيراد +»
 *   في تفاصيل القسم — شاشة 10)، فلا يملك هذا السجل POST.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.147';
import { fetchRevenues, fetchDepartments, isoDay, firstOfMonth } from '../data/finance-repo.js?v=4.9.147';
import { FINANCE_WRITE_ROLES, validateRevenueForm, updateRevenue, deleteRevenue } from '../data/finance-write-repo.js?v=4.9.147';
import { fetchCurrency, formatMoney, formatInt } from '../data/reports-repo.js?v=4.9.147';
import { canWrite } from '../session.js?v=4.9.147';
import { financeWriteEnabled } from '../write-flags.js?v=4.9.147';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

function moneyCell(v, currency) {
    const m = formatMoney(v, currency);
    return `<span class="erp-num" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
}

function template(from, to) {
    return `
      <section class="erp-card erp-v2-revenues">
        <div class="erp-card__head">
          <h3 class="erp-card__title">الإيرادات
            <span class="erp-eyebrow" dir="ltr" lang="en">Revenues</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <label class="erp-text-sm erp-text-muted" for="v2rev-dept">القسم</label>
          <select class="erp-input" id="v2rev-dept"><option value="all">كل الأقسام</option></select>
          <label class="erp-text-sm erp-text-muted" for="v2rev-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2rev-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2rev-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2rev-to" type="date" value="${esc(to)}" max="${esc(isoDay(0))}">
          <label class="erp-text-sm erp-text-muted" for="v2rev-search">بحث</label>
          <input class="erp-input" id="v2rev-search" type="search" placeholder="المصدر أو ملاحظات…">
          <button type="button" class="erp-btn erp-btn--sm" data-v2-clear hidden>عرض الكل</button>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-print aria-label="طباعة الكشف">
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
          </button>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
          <p class="erp-text-sm erp-text-muted">
            سجل الإيرادات (<span class="erp-addr" dir="ltr">/api/revenues</span>) —
            والصلاحية قررها الخادم وحده. عمود الإجراءات (تعديل/حذف) لا يُرسم
            إلا لدور <span class="erp-addr" dir="ltr">finance.edit</span>
            (admin|manager|accountant) والخادم يعيد فحص كل نداء؛ الإضافة من
            زر «إيراد +» في تفاصيل القسم (10) لأن إنشاء الإيراد بابٌ آخر.
            الافتراضي الشهر الحالي؛ إفراغ التاريخين يعرض الكل. يُقرأ الأحدث
            حتى 8,000 حركة ثم تُطبَّق الفرزات محليًا.
          </p>
          <div data-v2-form hidden></div>
          <div data-v2-table></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, confirmFn?: (message:string)=>boolean, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountRevenuesScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 revenues]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    /* P1-2 والعقد: الرسم يحتاج الدور **وعلم الكتابة** (OFF افتراضيًا)،
       والخادم يبقى الحاكم في كل PUT/DELETE. */
    const writable = canWrite(ctx.role, FINANCE_WRITE_ROLES) && financeWriteEnabled();

    let allRows = [];
    let depts = [];
    let currency = '';
    let loading = false;
    let queued = false;          // a refresh asked for while one was running
    let deptCode = 'all';
    let saving = false;
    let editing = null;          // raw row whose form is open (null when closed)

    host.insertAdjacentHTML('beforeend', template(firstOfMonth(), isoDay(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');
    const clearBtn = q('[data-v2-clear]');
    const searchEl = q('#v2rev-search');
    const formHost = q('[data-v2-form]');

    const table = createDataTable({
        caption: 'سجل الإيرادات — بيانات حية',
        mode: 'client',
        pageSize: 50,
        stickyHeader: true,
        emptyMessage: 'لا توجد إيرادات في الفترة المحددة',
        emptyHint: 'وسّع الفترة أو اعرض الكل.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'source', header: 'المصدر', sortable: true, filterable: true,
                render: (row) => (row.source ? esc(row.source) : `<span class="erp-text-muted">—</span>`),
            },
            { key: 'deptName', header: 'القسم', sortable: true, filterable: true, width: '150px' },
            {
                key: 'amount', header: 'المبلغ', type: 'number', sortable: true,
                width: '150px', align: 'end', value: (row) => row.amount,
                render: (row) => moneyCell(row.amount, currency),
            },
            {
                key: 'date', header: 'التاريخ', sortable: true, filterable: true,
                width: '120px', align: 'center', className: 'erp-tnum',
            },
            {
                key: 'notes', header: 'ملاحظات',
                render: (row) => (row.notes ? esc(row.notes) : `<span class="erp-text-muted">—</span>`),
            },
            ...(writable ? [{
                key: 'actions',
                header: 'إجراءات',
                width: '170px',
                align: 'end',
                value: () => '',
                render: (row) => `
                  <span class="erp-row-wrap">
                    <button type="button" class="erp-btn erp-btn--sm" data-v2-act="edit" data-id="${esc(row.id)}" data-name="${esc(row.source || '')}">
                      <i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span>
                    </button>
                    <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-act="delete" data-id="${esc(row.id)}" data-name="${esc(row.source || '')}">
                      <i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span>
                    </button>
                  </span>`,
            }] : []),
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    /** deptId stores the CODE — matched against departments.code (legacy parity). */
    function deptNameOf(code) {
        const d = depts.find((x) => String(x.code) === String(code));
        return d ? String(d.name) : (code ? String(code) : '—');
    }

    function viewRows() {
        const from = q('#v2rev-from').value;
        const to = q('#v2rev-to').value;
        const query = searchEl.value.trim().toLowerCase();
        const rows = allRows.filter((r) => {
            if (deptCode !== 'all' && String(r.deptId) !== deptCode) {return false;}
            if (from && r.date < from) {return false;}
            if (to && r.date > to) {return false;}
            if (query && !`${r.source || ''} ${r.notes || ''} ${r.deptId || ''}`.toLowerCase().includes(query)) {return false;}
            return true;
        }).map((r) => ({ ...r, deptName: deptNameOf(r.deptId) }));
        return { rows, filtered: !!(from || to || deptCode !== 'all' || query) };
    }

    function paint() {
        const { rows, filtered } = viewRows();
        const total = rows.reduce((s, r) => s + num(r.amount), 0);
        summaryEl.textContent = `إجمالي المعروض ${formatMoney(total, currency).amount}`
            + (currency ? ` ${currency}` : '')
            + ` · ${formatInt(rows.length)} إيرادًا`;
        countEl.textContent = rows.length ? `(${formatInt(rows.length)})` : '';
        clearBtn.hidden = !filtered;
        table.setRows(rows);
    }

    async function reload() {
        if (loading) {queued = true; return;}
        loading = true;
        table.setLoading(true);
        try {
            const [revs, deptList, cur] = await Promise.all([
                fetchRevenues(),
                fetchDepartments().catch(() => []),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            currency = String(cur ?? '');
            depts = deptList;
            allRows = revs;
            const sel = q('#v2rev-dept');
            if (sel) {
                sel.innerHTML = `<option value="all">كل الأقسام</option>`
                    + depts.map((d) => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('');
                sel.value = deptCode;
            }
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            allRows = [];
            table.setRows([]);
            summaryEl.textContent = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض الإيرادات بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل الإيرادات: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
            if (queued && el.isConnected) {
                queued = false;
                reload();                            // the newest read wins
            }
        }
    }

    /* ── Form (in-card edit panel — no legacy modal, no inline handler) ─ */
    const REV_FIELDS = ['source', 'deptId', 'amount', 'date', 'notes'];

    /** قسم غائب من الدليل (محذوف أو رمز غريب) يُعرض كما هو — لا يُخترع اسم بديل. */
    function deptOptions(selected) {
        const cur = String(selected ?? '');
        const known = depts.map((d) => `<option value="${esc(d.code)}"${String(d.code) === cur ? ' selected' : ''}>${esc(d.name)}</option>`).join('');
        if (cur && depts.some((d) => String(d.code) === cur)) {return known;}
        return (cur ? '' : '<option value="" selected>— بلا قسم —</option>')
            + known + (cur ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '');
    }

    function formHtml() {
        const row = editing || {};
        const val = (k) => (row[k] !== undefined && row[k] !== null ? String(row[k]) : '');
        return `
          <form class="erp-stack" data-v2-form-el novalidate>
            <h4 class="erp-card__title">تعديل إيراد</h4>
            <div class="erp-field">
              <label class="erp-label" for="v2rev-f-source">المصدر *</label>
              <input class="erp-input" id="v2rev-f-source" name="source" value="${esc(val('source'))}">
            </div>
            <div class="erp-row-wrap">
              <div class="erp-grow">
                <label class="erp-label" for="v2rev-f-dept">القسم *</label>
                <select class="erp-select" id="v2rev-f-dept" name="deptId">${deptOptions(val('deptId'))}</select>
              </div>
              <div class="erp-grow">
                <label class="erp-label" for="v2rev-f-amount">المبلغ *</label>
                <input class="erp-input erp-input--ltr" id="v2rev-f-amount" name="amount" type="number" step="0.01" value="${esc(val('amount'))}">
              </div>
            </div>
            <div class="erp-field">
              <label class="erp-label" for="v2rev-f-date">التاريخ *</label>
              <input class="erp-input erp-input--ltr" id="v2rev-f-date" name="date" type="date" value="${esc(val('date'))}">
            </div>
            <div class="erp-field">
              <label class="erp-label" for="v2rev-f-notes">ملاحظات</label>
              <input class="erp-input" id="v2rev-f-notes" name="notes" value="${esc(val('notes'))}">
            </div>
            <p class="erp-text-sm erp-text-muted">التعديل يمسّ سجلًا ماليًا حقيقيًا؛ حقول خارج قائمة الكتابة لا تُرسل أصلًا، ورفض الخادم يظهر حرفيًا هنا.</p>
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

    function openForm(id) {
        if (!writable) {return;}
        const row = allRows.find((r) => String(r.id) === String(id));   // raw record
        if (!row) {return;}
        editing = { ...row };
        formHost.innerHTML = formHtml();
        formHost.hidden = false;
        formHost.querySelector('[name="source"]')?.focus();
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
        for (const key of REV_FIELDS) {
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
        for (const key of REV_FIELDS) {
            const input = form.querySelector(`[name="${key}"]`);
            if (input) {input.setAttribute('aria-invalid', errors.some((e) => e.field === key) ? 'true' : 'false');}
        }
    }

    async function submitForm(event) {
        event.preventDefault();
        if (saving || !editing || editing.id == null) {return;}
        const form = readForm();
        const errors = validateRevenueForm(form);
        if (errors.length) {
            showFormErrors(errors);
            return;
        }
        showFormErrors([]);
        saving = true;
        const saveBtn = formHost.querySelector('[data-v2-form-save]');
        if (saveBtn) {saveBtn.disabled = true;}
        try {
            await updateRevenue(editing.id, form);
            if (!el.isConnected) {return;}           // navigated away mid-save
            notify(`تم تعديل إيراد «${String(form.source).trim()}»`);
            closeForm();
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            // The server's sentence stays verbatim — refusal is the operator's
            // to fix, not ours to re-word.
            showFormErrors([{ field: '', message: (e && e.message) || 'فشل الحفظ' }]);
        } finally {
            saving = false;
            const btn = formHost.querySelector('[data-v2-form-save]');
            if (btn) {btn.disabled = false;}
        }
    }

    /** الحذف يسأل أولًا (مرآة legacy finance.js:157) — الرفض لا يرسل نداءً. */
    async function runDelete(id, name) {
        if (saving) {return;}
        if (!confirmFn(`حذف إيراد «${name || `#${id}`}»؟ لا رجعة بعد الحذف.`)) {return;}
        saving = true;
        try {
            await deleteRevenue(id);
            if (!el.isConnected) {return;}           // navigated away mid-write
            notify(`تم حذف إيراد «${name || `#${id}`}»`);
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify(`فشلت العملية: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
        }
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-clear]')) {
            q('#v2rev-from').value = '';
            q('#v2rev-to').value = '';
            searchEl.value = '';
            deptCode = 'all';
            const sel = q('#v2rev-dept');
            if (sel) {sel.value = 'all';}
            paint();
            return;
        }
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-form-cancel]')) {closeForm(); return;}
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            if (actBtn.disabled) {return;}
            if (actBtn.dataset.v2Act === 'edit') {openForm(actBtn.dataset.id); return;}
            runDelete(actBtn.dataset.id, actBtn.dataset.name || '');
            return;
        }
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    el.addEventListener('change', (event) => {
        if (event.target.id === 'v2rev-dept') {deptCode = event.target.value; paint(); return;}
        if (event.target.matches('#v2rev-from, #v2rev-to')) {paint();}
    });
    el.addEventListener('input', (event) => {
        if (event.target.id === 'v2rev-search') {paint();}
    });

    formHost.addEventListener('submit', submitForm);

    reload();

    return {
        el,
        reload,
        getRows: () => viewRows().rows,
        destroy() {
            table.destroy();
            el.remove();
        },
    };
}
