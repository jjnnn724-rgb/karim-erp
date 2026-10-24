/**
 * V2 — معالج الاستيراد الجماعي للموظفين والمستخدمين (26د)
 * ═══════════════════════════════════════════════════════════════════════
 * مرآة `features/bulk-import.js` خطوة بخطوة: إدخال الأسماء (كتابة أو ملف
 * XLSX/XLS/CSV/TXT) → الإعدادات (صيغة اليوزر، الدور، البادئة، بداية
 * البصمات) → المعاينة → الإضافة → النتائج (تصدير Excel/CSV/JSON، نسخ
 * الباسوردات، طباعة جدول وقصاصات).
 *
 * لا شبكة هنا: كل قراءة/كتابة عبر `data/bulk-import-repo.js`. والواجهة
 * لا تفعّل نفسها: الشاشتان تستدعيانها فقط بعد دور الأدمن + علم
 * `v2bulkimport` (OFF). الخادم يعيد فحص كل صف على أي حال.
 */

import { CONFIG, ROLES } from '../core/config.js?v=4.9.151';
import { ensureXlsx } from './vendor.js?v=4.9.151';
import { openInAppReport } from './report-viewer.js?v=4.9.151';
import { loadBulkImportContext, createBulkAccount } from './data/bulk-import-repo.js?v=4.9.151';
import {
    BULK_DEFAULT_ROLE, BULK_PASSWORD_LENGTH,
    buildBulkRows, bulkPreviewStats, bulkToCopyText, bulkToCsv, bulkToJson,
    bulkToExcelAoa, bulkPrintTableHtml, bulkPrintSlipsHtml,
    fingerprintForms, generateBulkPassword, parseBulkFileText, parseBulkNames,
    usedFingerprintSet,
} from './bulk-import.js?v=4.9.151';

const ROLE_NAMES = Object.keys(ROLES).reduce((map, key) => {
    map[key] = ROLES[key].name;
    return map;
}, {});

const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function deptCodeOf(dept) {
    return String((dept && (dept.code || dept.id)) || '');
}

function deptLabelOf(dept) {
    const code = deptCodeOf(dept);
    return String((dept && (dept.name || dept.name_ar)) || code);
}

function localToday() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function displayDate() {
    try {
        return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    } catch (_) {
        return new Date().toLocaleString();
    }
}

/**
 * @param {HTMLElement} host
 * @param {{notify?:Function, confirmFn?:Function, orgName?:string, showHeader?:boolean,
 *          onDone?:Function, onCancel?:Function}} [ctx]
 */
export function mountBulkImportWizard(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 bulk import]', m);
    const confirmFn = typeof ctx.confirmFn === 'function'
        ? ctx.confirmFn
        : (message) => (typeof window !== 'undefined' && window.confirm ? window.confirm(message) : false);
    const orgName = String(ctx.orgName || CONFIG.APP_NAME || '');
    const showHeader = ctx.showHeader !== false;

    let destroyed = false;
    const state = {
        step: 1,
        loading: true,
        loadError: '',
        context: null,
        namesText: '',
        format: 'first_num',
        role: BULK_DEFAULT_ROLE,
        prefix: '',
        fpStart: '1',
        deptCode: '',
        rows: [],
        busy: false,
        note: { message: '', kind: '' },
        results: null,
    };

    host.insertAdjacentHTML('beforeend', '<div class="erp-bulk" data-v2-bulk-root></div>');
    const el = host.lastElementChild;

    function noteMarkup() {
        // العنصر دائمًا موجود: flash قد يسبق أي paint (رفض الفراغ، فشل ملف)،
        // وبدونه تصل الرسالة للشاشة الأم ولا تظهر داخل المعالج.
        const message = state.note.message;
        return `<p class="erp-bulk__note" data-v2-bulk-note data-tone="${esc(state.note.kind)}" role="status" aria-live="polite"${message ? '' : ' hidden'}>${esc(message)}</p>`;
    }

    function flash(message, kind = '') {
        state.note = { message: String(message || ''), kind: String(kind || '') };
        const box = el.querySelector('[data-v2-bulk-note]');
        if (box) {
            box.textContent = state.note.message;
            box.dataset.tone = state.note.kind;
            box.hidden = !state.note.message;
        }
        if (state.note.message) {notify(state.note.message, state.note.kind || undefined);}
    }

    function stepsMarkup() {
        const labels = ['إدخال الأسماء', 'الإعدادات', 'المراجعة والتصدير'];
        return `<ol class="erp-bulk__steps" aria-label="خطوات الاستيراد">`
            + labels.map((label, index) => {
                const n = index + 1;
                const cls = state.step === n ? ' is-active' : (state.step > n ? ' is-completed' : '');
                return `<li class="erp-bulk__step${cls}" data-v2-bulk-step="${n}"`
                    + `${state.step === n ? ' aria-current="step"' : ''}>`
                    + `<span class="erp-bulk__step-num">${state.step > n ? '<i class="ji" data-i="check" aria-hidden="true"></i>' : n}</span>`
                    + `<span class="erp-bulk__step-title">${esc(label)}</span></li>`;
            }).join('')
            + `</ol>`;
    }

    function roleOptions() {
        return Object.keys(ROLES).map((key) => `<option value="${esc(key)}"${key === state.role ? ' selected' : ''}>${esc(ROLES[key].name)}</option>`).join('');
    }

    function deptOptions() {
        const departments = (state.context && state.context.departments) || [];
        return `<option value="" disabled${state.deptCode ? '' : ' selected'}>اختر القسم</option>`
            + departments.map((dept) => {
                const code = deptCodeOf(dept);
                return `<option value="${esc(code)}"${code === state.deptCode ? ' selected' : ''}>${esc(deptLabelOf(dept))}</option>`;
            }).join('');
    }

    function formatCards() {
        const formats = [
            ['first_num', 'الاسم الأول + رقم', 'ahmed1'],
            ['full_dot', 'الاسم كامل بنقطة', 'ahmed.ali'],
            ['initials_num', 'أول حرف + رقم', 'a001'],
            ['emp_num', 'emp + رقم', 'emp001'],
        ];
        return formats.map(([key, label, example]) => `<button type="button"`
            + ` class="erp-bulk__fmt${state.format === key ? ' is-selected' : ''}"`
            + ` data-v2-bulk-fmt="${key}" aria-pressed="${state.format === key ? 'true' : 'false'}">`
            + `<span>${esc(label)}</span><small class="erp-mono" dir="ltr">${esc(example)}</small></button>`).join('');
    }

    function stepOne() {
        return `<div class="erp-bulk__body" data-v2-bulk-body="1">
          <div class="erp-bulk__dropwrap">
            <button type="button" class="erp-bulk__drop" data-v2-bulk-pick>
              <span class="erp-bulk__drop-icon"><i class="ji" data-i="folder-open" aria-hidden="true"></i></span>
              <strong>اسحب الملف هنا أو اضغط للاختيار</strong>
              <span class="erp-bulk__drop-sub">Excel (.xlsx) • CSV • TXT — عمود واحد بالأسماء</span>
              <span class="erp-bulk__formats"><span>XLSX</span><span>XLS</span><span>CSV</span><span>TXT</span></span>
            </button>
            <input class="erp-bulk__file" type="file" accept=".xlsx,.xls,.csv,.txt" data-v2-bulk-file hidden aria-label="اختيار ملف الأسماء">
          </div>
          <div class="erp-bulk__divider"><span>أو اكتب الأسماء يدويًا</span></div>
          <label class="erp-bulk__field">
            <span>الأسماء — اسم واحد في كل سطر</span>
            <textarea class="erp-input" rows="6" data-v2-bulk-names
              placeholder="أحمد محمد&#10;فاطمة علي&#10;محمود حسن&#10;…">${esc(state.namesText)}</textarea>
          </label>
          ${state.loading ? '<p class="erp-text-sm erp-text-muted" role="status">جارٍ تحميل دليل المستخدمين والموظفين…</p>' : ''}
          ${state.loadError ? `<div class="erp-bulk__loaderr" role="alert"><span>${esc(state.loadError)}</span>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-bulk-retry>إعادة المحاولة</button></div>` : ''}
          ${noteMarkup()}
        </div>`;
    }

    function stepTwo() {
        const names = parseBulkNames(state.namesText);
        return `<div class="erp-bulk__body" data-v2-bulk-body="2">
          <p class="erp-text-sm erp-text-muted">${names.length ? `${names.length} اسمًا جاهزًا للتوليد — راجع الصيغة والدور.` : 'عد إلى الخطوة الأولى وأضف اسمًا واحدًا على الأقل.'}</p>
          <div class="erp-bulk__options">
            <fieldset class="erp-bulk__card erp-bulk__card--wide">
              <legend>تنسيق اسم المستخدم</legend>
              <div class="erp-bulk__fmts">${formatCards()}</div>
            </fieldset>
            <label class="erp-bulk__card"><span>الدور الافتراضي</span>
              <select class="erp-select" data-v2-bulk-role>${roleOptions()}</select>
            </label>
            <label class="erp-bulk__card"><span>بادئة اسم المستخدم (اختياري)</span>
              <input class="erp-input erp-input--ltr" type="text" data-v2-bulk-prefix dir="ltr" value="${esc(state.prefix)}" placeholder="مثال: gv_" autocomplete="off">
            </label>
            <div class="erp-bulk__card erp-bulk__fixed">
              <span>طول كلمة المرور</span>
              <div class="erp-bulk__callout"><b>${BULK_PASSWORD_LENGTH} خانات</b><small>حرف + أرقام — شرط الخادم</small></div>
            </div>
            <label class="erp-bulk__card"><span>رقم البصمة الأول</span>
              <input class="erp-input erp-input--ltr" type="number" min="1" step="1" data-v2-bulk-fp dir="ltr" value="${esc(state.fpStart)}">
              <small class="erp-text-muted">الرقم الوظيفي = رقم البصمة — يتخطى الأرقام المستخدمة تلقائيًا لمنع التعارض.</small>
            </label>
            <label class="erp-bulk__card" data-v2-bulk-deptwrap${state.role === 'dept_head' ? '' : ' hidden'}><span>قسم رئيس القسم</span>
              <select class="erp-select" data-v2-bulk-dept>${deptOptions()}</select>
              <small class="erp-text-muted">إجباري لرئيس القسم (server)، ويُطبَّق على كل الصفوف.</small>
            </label>
          </div>
          ${noteMarkup()}
        </div>`;
    }

    function rowsTable(rows, withDelete) {
        const roleOf = (row) => ROLE_NAMES[row.role] || row.role;
        return `<div class="erp-bulk__scroll"><table class="erp-bulk__table">
          <thead><tr><th style="width:44px">#</th><th>الاسم</th><th>اسم المستخدم</th><th>كلمة المرور</th><th>رقم البصمة</th><th>الدور</th>${withDelete ? '<th style="width:64px">حذف</th>' : ''}</tr></thead>
          <tbody>${rows.map((row, index) => `<tr>
            <td class="erp-tnum">${index + 1}</td>
            <td><strong>${esc(row.name)}</strong></td>
            <td class="erp-mono" dir="ltr">${esc(row.username)}</td>
            <td><span class="erp-bulk__pass erp-mono" dir="ltr">${esc(row.password)}</span></td>
            <td><span class="erp-badge" data-tone="success">${esc(row.fp || '—')}</span></td>
            <td><span class="erp-badge" data-tone="brand">${esc(roleOf(row))}</span></td>
            ${withDelete ? `<td><button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-bulk-del="${index}" aria-label="حذف ${esc(row.name)}"><i class="ji" data-i="trash" aria-hidden="true"></i></button></td>` : ''}
          </tr>`).join('')}</tbody>
        </table></div>`;
    }

    function stepThree() {
        const stats = bulkPreviewStats(state.rows);
        return `<div class="erp-bulk__body" data-v2-bulk-body="3">
          <div class="erp-bulk__stats">
            <div class="erp-bulk__stat"><b>${stats.total}</b><span>إجمالي المستخدمين</span></div>
            <div class="erp-bulk__stat"><b>${stats.roles}</b><span>عدد الأدوار</span></div>
            <div class="erp-bulk__stat"><b>${stats.passwordLength}</b><span>خانات كلمة المرور</span></div>
            <div class="erp-bulk__stat"><b>${stats.uniqueUsernames}</b><span>أسماء مستخدمين فريدة</span></div>
          </div>
          ${rowsTable(state.rows, true)}
          <p class="erp-text-sm erp-text-muted">لم يُحفظ شيء بعد — راجع الصفوف ثم «إضافة الكل للنظام». كلمة المرور المولدة لا تُعرض مرة أخرى بعد الإغلاق.</p>
          <p class="erp-bulk__progress" data-v2-bulk-progress role="status" aria-live="polite" hidden></p>
          ${noteMarkup()}
        </div>`;
    }

    function resultTitle(result) {
        if (result.added > 0) {return `تم استيراد ${result.added} حسابًا بنجاح`;}
        if (result.failed > 0 && result.skipped === 0) {return 'لم يُضف أي حساب — راجع الأخطاء أدناه';}
        if (result.skipped > 0) {return 'لم يُضف حساب جديد — الصفوف كلها مسجلة مسبقًا';}
        return 'لم تتم الإضافة';
    }

    function stepFour() {
        const result = state.results || { rows: state.rows, added: 0, skipped: 0, failed: 0, errors: [] };
        return `<div class="erp-bulk__body" data-v2-bulk-body="4">
          <h3 class="erp-bulk__result-title">${esc(resultTitle(result))}</h3>
          <div class="erp-bulk__warn" role="note">
            <i class="ji" data-i="alert-triangle" aria-hidden="true"></i>
            <strong>تنبيه مهم:</strong> احفظ نسخة من بيانات الدخول الآن — كلمات المرور لن تظهر مرة أخرى بنفس الشكل.
          </div>
          <p class="erp-text-sm">أُضيف <b>${result.added}</b> — تُخطي <b>${result.skipped}</b> مكرر — فشل <b>${result.failed}</b>.</p>
          ${result.errors && result.errors.length ? `<ul class="erp-bulk__errors">${result.errors.slice(0, 12).map((message) => `<li>${esc(message)}</li>`).join('')}</ul>` : ''}
          ${rowsTable(result.rows, false)}
          <div class="erp-bulk__exports erp-no-print">
            <button type="button" class="erp-btn erp-btn--sm" data-v2-bulk-export="xlsx"><i class="ji" data-i="inbox" aria-hidden="true"></i><span>تحميل Excel</span></button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-bulk-export="csv"><i class="ji" data-i="file-text" aria-hidden="true"></i><span>تحميل CSV</span></button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-bulk-export="json"><i class="ji" data-i="file-text" aria-hidden="true"></i><span>JSON</span></button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-bulk-export="copy"><i class="ji" data-i="clipboard-list" aria-hidden="true"></i><span>نسخ كل الباسوردات</span></button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-bulk-print="table"><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة جدول</span></button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-bulk-print="slips"><i class="ji" data-i="ticket" aria-hidden="true"></i><span>طباعة قصاصات</span></button>
          </div>
          <p class="erp-text-sm erp-text-muted">التصدير يحمل كل الصفوف المولدة، بما فيها المتخطى والفاشل — راجع عدادات النتيجة أعلاه.</p>
          ${noteMarkup()}
        </div>`;
    }

    function footerMarkup() {
        if (state.step === 1) {
            return `<button type="button" class="erp-btn erp-btn--primary" data-v2-bulk-next${state.loading || state.loadError ? ' disabled' : ''}>
              <i class="ji" data-i="zap" aria-hidden="true"></i><span>توليد المعاينة</span></button>`;
        }
        if (state.step === 2) {
            return `<button type="button" class="erp-btn erp-btn--danger" data-v2-bulk-clear${state.busy ? ' disabled' : ''}>
              <i class="ji" data-i="trash" aria-hidden="true"></i><span>مسح الكل</span></button>
              <span class="erp-grow"></span>
              <button type="button" class="erp-btn erp-btn--primary" data-v2-bulk-next><i class="ji" data-i="zap" aria-hidden="true"></i><span>توليد البيانات</span></button>`;
        }
        if (state.step === 3) {
            return `<button type="button" class="erp-btn" data-v2-bulk-clear${state.busy ? ' disabled' : ''}>
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>إعادة توليد</span></button>
              <span class="erp-grow"></span>
              <button type="button" class="erp-btn erp-btn--primary" data-v2-bulk-confirm${state.busy ? ' disabled' : ''}>
                <i class="ji" data-i="circle-check" aria-hidden="true"></i><span>إضافة الكل للنظام</span></button>`;
        }
        return `<span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--primary" data-v2-bulk-done>
          <i class="ji" data-i="circle-check" aria-hidden="true"></i><span>تم</span></button>`;
    }

    function paint(options = {}) {
        if (destroyed) {return;}
        const body = state.step === 1 ? stepOne()
            : state.step === 2 ? stepTwo()
                : state.step === 3 ? stepThree() : stepFour();
        el.innerHTML = `<section class="erp-bulk__shell"${showHeader ? ' aria-labelledby="erp-bulk-title"' : ' aria-label="استيراد موظفين جماعي"'}>
          ${showHeader ? `<header class="erp-bulk__head">
            <h2 class="erp-bulk__title" id="erp-bulk-title"><i class="ji" data-i="user" aria-hidden="true"></i> استيراد موظفين جماعي</h2>
            <p class="erp-bulk__intro">ارفع ملف Excel/CSV أو اكتب الأسماء مباشرة — النظام يولّد يوزر وباسورد آمنين تلقائيًا.</p>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-bulk-close${state.busy ? ' disabled' : ''} aria-label="إغلاق معالج الاستيراد"><i class="ji" data-i="x" aria-hidden="true"></i></button>
          </header>` : `<header class="erp-bulk__head erp-bulk__head--slim">
            <p class="erp-bulk__intro">ارفع ملف Excel/CSV أو اكتب الأسماء مباشرة — النظام يولّد يوزر وباسورد آمنين تلقائيًا.</p>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-bulk-close${state.busy ? ' disabled' : ''} aria-label="إغلاق معالج الاستيراد"><i class="ji" data-i="x" aria-hidden="true"></i></button>
          </header>`}
          ${stepsMarkup()}
          ${body}
          <footer class="erp-bulk__actions">${footerMarkup()}</footer>
        </section>`;
        if (options.focus) {
            const target = el.querySelector(options.focus);
            if (target && typeof target.focus === 'function') {
                try {target.focus({ preventScroll: true});} catch (_) { /* older browsers */ }
            }
        }
    }

    async function loadContext() {
        state.loading = true;
        state.loadError = '';
        paint();
        try {
            const data = await loadBulkImportContext();
            if (destroyed) {return;}
            state.context = {
                usernames: Array.isArray(data.usernames) ? data.usernames : [],
                employees: Array.isArray(data.employees) ? data.employees : [],
                departments: Array.isArray(data.departments) ? data.departments : [],
            };
            state.loading = false;
            paint();
        } catch (error) {
            if (destroyed) {return;}
            state.loading = false;
            state.loadError = (error && error.message) || 'تعذّر تحميل دليل المستخدمين والموظفين';
            paint();
        }
    }

    function resetAll() {
        state.step = 1;
        state.namesText = '';
        state.format = 'first_num';
        state.role = BULK_DEFAULT_ROLE;
        state.prefix = '';
        state.fpStart = '1';
        state.deptCode = '';
        state.rows = [];
        state.results = null;
        state.note = { message: '', kind: '' };
        paint({ focus: '[data-v2-bulk-names]' });
    }

    function goStepTwo() {
        if (state.loading || state.loadError) {
            flash(state.loadError || 'جارٍ تحميل دليل المستخدمين والموظفين — انتظر لحظة', 'warning');
            return;
        }
        const text = String(state.namesText || '').trim();
        if (!text) {flash('أدخل أسماء الموظفين أولاً', 'error'); return;}
        const names = parseBulkNames(text);
        if (!names.length) {flash('لم يتم العثور على أسماء صالحة', 'error'); return;}
        state.step = 2;
        state.note = { message: '', kind: '' };
        paint({ focus: '[data-v2-bulk-fmt]' });
    }

    function readOptions() {
        const roleEl = el.querySelector('[data-v2-bulk-role]');
        const prefixEl = el.querySelector('[data-v2-bulk-prefix]');
        const fpEl = el.querySelector('[data-v2-bulk-fp]');
        const deptEl = el.querySelector('[data-v2-bulk-dept]');
        if (roleEl) {state.role = roleEl.value;}
        if (prefixEl) {state.prefix = prefixEl.value;}
        if (fpEl) {state.fpStart = fpEl.value;}
        if (deptEl) {state.deptCode = deptEl.value;}
    }

    function goStepThree() {
        if (!state.context) {flash('دليل المستخدمين والموظفين غير محمّل — أعد المحاولة', 'error'); return;}
        readOptions();
        const names = parseBulkNames(state.namesText);
        if (!names.length) {flash('لم يتم العثور على أسماء صالحة', 'error'); return;}
        if (state.role === 'dept_head' && !state.deptCode) {
            flash('اختر قسمًا واحدًا على الأقل لرئيس القسم', 'error');
            return;
        }
        state.rows = buildBulkRows(names, {
            format: state.format,
            prefix: state.prefix,
            role: state.role,
            deptCode: state.deptCode,
            fpStart: state.fpStart,
            usedUsernames: new Set(state.context.usernames),
            usedFingerprints: usedFingerprintSet(state.context.employees),
            passwordFactory: generateBulkPassword,
        });
        state.step = 3;
        state.note = { message: '', kind: '' };
        paint({ focus: '[data-v2-bulk-confirm]' });
    }

    function deleteRow(index) {
        if (state.busy) {return;}
        state.rows.splice(index, 1);
        if (!state.rows.length) {resetAll(); return;}
        paint();
    }

    function setBusyUi() {
        [ '[data-v2-bulk-clear]', '[data-v2-bulk-confirm]', '[data-v2-bulk-close]' ]
            .forEach((selector) => {
                const button = el.querySelector(selector);
                if (button) {button.disabled = true;}
            });
        el.querySelectorAll('[data-v2-bulk-del]').forEach((button) => {button.disabled = true;});
        const progress = el.querySelector('[data-v2-bulk-progress]');
        if (progress) {progress.hidden = false;}
    }

    function progressText(done, total) {
        const progress = el.querySelector('[data-v2-bulk-progress]');
        if (progress) {
            progress.hidden = false;
            progress.textContent = `جارٍ الاستيراد… ${done} من ${total}`;
        }
    }

    async function confirmImport() {
        if (state.busy) {return;}
        if (!state.rows.length) {flash('لا توجد بيانات', 'error'); return;}
        if (!state.context) {flash('دليل المستخدمين والموظفين غير محمّل — أعد المحاولة', 'error'); return;}
        const ok = await confirmFn(`سيتم إضافة ${state.rows.length} من المستخدمين إلى النظام. هل تريد المتابعة؟`);
        if (destroyed || !ok) {return;}
        readOptions();
        const usedUsernames = new Set(state.context.usernames);
        const usedFingerprints = usedFingerprintSet(state.context.employees);
        const firstDept = (state.context.departments || [])[0];
        const department = state.role === 'dept_head' && state.deptCode
            ? state.deptCode : deptCodeOf(firstDept);
        const position = (ROLES[state.role] && ROLES[state.role].name) || state.role;
        const joinDate = localToday();
        let added = 0;
        let skipped = 0;
        let failed = 0;
        const errors = [];
        state.busy = true;
        setBusyUi();
        progressText(0, state.rows.length);
        try {
            for (const row of state.rows) {
                if (destroyed) {return;}
                if (usedUsernames.has(row.username)) {
                    skipped += 1;
                    progressText(added + skipped + failed, state.rows.length);
                    continue;
                }
                if (fingerprintForms(row.fp).some((form) => usedFingerprints.has(form))) {
                    skipped += 1;
                    progressText(added + skipped + failed, state.rows.length);
                    continue;
                }
                try {
                    await createBulkAccount(row, { department, position, joinDate });
                    usedUsernames.add(row.username);
                    fingerprintForms(row.fp).forEach((form) => usedFingerprints.add(form));
                    added += 1;
                } catch (error) {
                    failed += 1;
                    errors.push(`${row.username}: ${(error && error.message) || 'فشل'}`);
                }
                progressText(added + skipped + failed, state.rows.length);
            }
        } finally {
            if (!destroyed) {
                state.busy = false;
                state.results = {
                    rows: state.rows.slice(), added, skipped, failed, errors,
                };
                state.step = 4;
                state.note = { message: '', kind: '' };
                paint({ focus: '[data-v2-bulk-done]' });
            }
        }
        if (destroyed) {return;}
        const message = `حُفظ ${added} حسابًا في قاعدة البيانات`
            + `${skipped ? `، تم تجاهل ${skipped} مكرر` : ''}`
            + `${failed ? `، وفشل ${failed}` : ''}`;
        notify(message, failed ? 'warning' : 'success');
    }

    function downloadBlob(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function resultRows() {
        return (state.results && state.results.rows) || state.rows;
    }

    async function exportExcel() {
        const ready = await ensureXlsx();
        if (destroyed) {return;}
        if (!ready) {flash('تعذر تحميل مولد ملفات Excel — تحقق من الشبكة وأعد المحاولة', 'error'); return;}
        const workbook = window.XLSX.utils.book_new();
        const sheet = window.XLSX.utils.aoa_to_sheet(bulkToExcelAoa(resultRows(), ROLE_NAMES));
        sheet['!cols'] = [{ wch: 4 }, { wch: 25 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 18 }];
        window.XLSX.utils.book_append_sheet(workbook, sheet, 'مستخدمين');
        window.XLSX.writeFile(workbook, `bulk_users_${Date.now()}.xlsx`);
        notify('تم تحميل ملف Excel', 'success');
    }

    function exportCsv() {
        downloadBlob(`\uFEFF${bulkToCsv(resultRows(), ROLE_NAMES)}`, `bulk_users_${Date.now()}.csv`, 'text/csv;charset=utf-8');
        notify('تم تحميل ملف CSV', 'success');
    }

    function exportJson() {
        downloadBlob(JSON.stringify(bulkToJson(resultRows(), ROLE_NAMES), null, 2),
            `bulk_users_${Date.now()}.json`, 'application/json');
        notify('تم تحميل ملف JSON', 'success');
    }

    function copyPasswords() {
        const text = bulkToCopyText(resultRows());
        const done = () => notify('تم نسخ جميع البيانات', 'success');
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
            return;
        }
        fallbackCopy(text, done);
    }

    function fallbackCopy(text, done) {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try {document.execCommand('copy'); done();}
        catch (_) {flash('تعذر النسخ — حدد الجدول يدويًا', 'warning');}
        area.remove();
    }

    function printRows(kind) {
        const payload = {
            rows: resultRows(),
            roleNames: ROLE_NAMES,
            orgName,
            logoUrl: `${window.location.origin}/app/assets/karim-logo.ico`,
            createdAt: displayDate(),
        };
        const html = kind === 'slips' ? bulkPrintSlipsHtml(payload) : bulkPrintTableHtml(payload);
        try {
            const viewer = openInAppReport('معاينة الاستيراد');
            viewer.document.write(html);
            viewer.document.close();
            setTimeout(() => { try {viewer.focus();} catch (_) { /* overlay owns focus */ } }, 500);
        } catch (_) {
            notify('تعذر فتح معاينة الطباعة', 'warning');
        }
    }

    function requestClose() {
        if (state.busy) {flash('جارٍ الاستيراد… انتظر حتى ينتهي', 'warning'); return;}
        // في النتائج صار شيء في قاعدة البيانات: الإغلاق يعيد تحميل الشاشة.
        if (state.step === 4) {finish(); return;}
        if (typeof ctx.onCancel === 'function') {ctx.onCancel(); return;}
        destroy();
    }

    function finish() {
        if (destroyed) {return;}
        if (typeof ctx.onDone === 'function') {ctx.onDone(); return;}
        destroy();
    }

    function destroy() {
        destroyed = true;
        if (el && el.parentNode) {el.parentNode.removeChild(el);}
    }

    el.addEventListener('click', (event) => {
        const target = event.target;
        if (target.closest('[data-v2-bulk-close]')) {requestClose(); return;}
        if (target.closest('[data-v2-bulk-retry]')) {loadContext(); return;}
        if (target.closest('[data-v2-bulk-pick]')) {
            const input = el.querySelector('[data-v2-bulk-file]');
            if (input) {input.click();}
            return;
        }
        if (target.closest('[data-v2-bulk-next]')) {
            if (state.busy) {return;}
            if (state.step === 1) {goStepTwo(); return;}
            if (state.step === 2) {goStepThree();}
            return;
        }
        if (target.closest('[data-v2-bulk-clear]')) {
            if (!state.busy) {resetAll();}
            return;
        }
        const fmt = target.closest('[data-v2-bulk-fmt]');
        if (fmt) {
            state.format = fmt.getAttribute('data-v2-bulk-fmt');
            el.querySelectorAll('[data-v2-bulk-fmt]').forEach((button) => {
                const on = button === fmt;
                button.classList.toggle('is-selected', on);
                button.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            return;
        }
        const del = target.closest('[data-v2-bulk-del]');
        if (del) {deleteRow(Number(del.getAttribute('data-v2-bulk-del'))); return;}
        if (target.closest('[data-v2-bulk-confirm]')) {confirmImport(); return;}
        if (target.closest('[data-v2-bulk-done]')) {finish(); return;}
        const exportButton = target.closest('[data-v2-bulk-export]');
        if (exportButton) {
            const kind = exportButton.getAttribute('data-v2-bulk-export');
            if (kind === 'xlsx') {exportExcel();}
            else if (kind === 'csv') {exportCsv();}
            else if (kind === 'json') {exportJson();}
            else if (kind === 'copy') {copyPasswords();}
            return;
        }
        const printButton = target.closest('[data-v2-bulk-print]');
        if (printButton) {printRows(printButton.getAttribute('data-v2-bulk-print'));}
    });

    el.addEventListener('input', (event) => {
        const target = event.target;
        if (target.matches('[data-v2-bulk-names]')) {state.namesText = target.value;}
        else if (target.matches('[data-v2-bulk-prefix]')) {state.prefix = target.value;}
        else if (target.matches('[data-v2-bulk-fp]')) {state.fpStart = target.value;}
    });

    el.addEventListener('change', async (event) => {
        const target = event.target;
        if (target.matches('[data-v2-bulk-role]')) {
            state.role = target.value;
            const wrap = el.querySelector('[data-v2-bulk-deptwrap]');
            if (wrap) {wrap.hidden = state.role !== 'dept_head';}
            return;
        }
        if (target.matches('[data-v2-bulk-dept]')) {state.deptCode = target.value; return;}
        if (target.matches('[data-v2-bulk-file]')) {
            const file = target.files && target.files[0];
            target.value = '';
            await handleFile(file);
        }
    });

    el.addEventListener('dragover', (event) => {
        const drop = event.target.closest('[data-v2-bulk-drop]');
        if (!drop) {return;}
        event.preventDefault();
        event.stopPropagation();
        drop.classList.add('is-dragover');
    });

    el.addEventListener('dragleave', (event) => {
        const drop = event.target.closest('[data-v2-bulk-drop]');
        if (!drop) {return;}
        event.preventDefault();
        event.stopPropagation();
        drop.classList.remove('is-dragover');
    });

    el.addEventListener('drop', async (event) => {
        const drop = event.target.closest('[data-v2-bulk-drop]');
        if (!drop) {return;}
        event.preventDefault();
        event.stopPropagation();
        drop.classList.remove('is-dragover');
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        await handleFile(file);
    });

    async function handleFile(file) {
        if (!file || destroyed) {return;}
        const ext = String(file.name || '').split('.').pop().toLowerCase();
        try {
            let names;
            if (ext === 'xlsx' || ext === 'xls') {
                const ready = await ensureXlsx();
                if (destroyed) {return;}
                if (!ready) {
                    flash('تعذر تحميل قارئ ملفات Excel — تحقق من الشبكة وأعد المحاولة', 'error');
                    return;
                }
                const buffer = await file.arrayBuffer();
                if (destroyed) {return;}
                const workbook = window.XLSXGuard.readWorkbook(buffer, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
                names = rows.map((row) => String((row && row[0]) || '').trim()).filter((name) => name.length > 1);
            } else {
                const text = await file.text();
                if (destroyed) {return;}
                names = parseBulkFileText(text);
            }
            state.namesText = names.join('\n');
            state.note = { message: `تم تحميل ${names.length} اسم من الملف`, kind: 'success' };
            paint({ focus: '[data-v2-bulk-names]' });
            notify(state.note.message, 'success');
        } catch (_) {
            if (!destroyed) {flash('خطأ في قراءة الملف', 'error');}
        }
    }

    paint();
    loadContext();

    return {
        el,
        getRows: () => state.rows.slice(),
        getState: () => ({ ...state }),
        destroy,
    };
}
