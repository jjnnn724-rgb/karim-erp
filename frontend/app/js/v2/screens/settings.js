/**
 * V2 — Settings screen · الإعدادات الكاملة (قراءة + كتابة المدير)
 * ═══════════════════════════════════════════════════════════════════════
 * Behavior mirror of the settings half of features/settings-users.js:8-592
 * + punch admin :724-1013 (read fully). Same doors, same payloads, same
 * server sentences. Gates mirrored: nav/backups/reset-all admin-only views,
 * ZATCA+KOT admin/manager writes, main save menu-gated, danger ops keep
 * their exact confirmations (RESTORE / CONFIRM PRODUCTION RESET / double).
 *
 * World-class deltas (no behavior change): sections load on demand (faster
 * first paint than the legacy 5-parallel + observer chain) · blocking
 * dialogs become inline panels · no inline handlers (CSP contract).
 */

import { canWrite } from '../session.js?v=4.9.156';
import { formatInt } from '../data/reports-repo.js?v=4.9.156';
import { fetchLocalBundle } from '../data/reports-extra.js?v=4.9.156';
import { setV2PrintLogo } from '../print-branding.js?v=4.9.156';
import { readMenuLabels } from '../layout/nav-model.js?v=4.9.156';
import { captureFace } from '../portal-face.js?v=4.9.156';
import { enrollFaceV1, enrollFaceV2 } from '../data/portal-repo.js?v=4.9.156';
import { fetchEmployees } from '../data/employees-repo.js?v=4.9.156';
import {
    ZATCA_WRITE_ROLES, KOT_WRITE_ROLES,
    fetchMainSettingsFull, updateMainSettings,
    fetchZatcaSettings, saveZatcaSettings, toggleZatca, testZatca, generateCsr,
    requestCsid, saveCsidManual, applyVat, fetchZatcaQueue, retryZatcaQueue,
    fetchKotSettings, saveKotSettings, fetchCardSettings, saveCardSettings,
    fetchPunchAdmin, fetchPunchAttempts, savePunchSettings, fetchPunchFaces,
    removePunchFace, fetchPunchDevices, unbindPunchDevice,
    fetchBackups, doBackup, uploadBackup, restoreBackup,
    resetAllData, operationalReset,
    fetchServerControl, serverControlAction,
} from '../data/settings-repo.js?v=4.9.156';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SVC_STATE_AR = {
    RUNNING: 'يعمل', STOPPED: 'متوقف', START_PENDING: 'جارٍ التشغيل',
    STOP_PENDING: 'جارٍ الإيقاف', PAUSED: 'موقوف مؤقتًا', UNKNOWN: 'غير معروف',
};
const SC_STAGE_AR = {
    queued: 'في الانتظار', stopping: 'جارٍ الإيقاف', waiting_stop: 'انتظار توقف الخدمة',
    stopped: 'متوقفة', starting: 'جارٍ التشغيل', waiting_health: 'انتظار جاهزية النظام',
    running: 'قيد التنفيذ', success: 'تم بنجاح', failed: 'فشل',
};
const SC_ACTION_AR = { start: 'تشغيل', stop: 'إيقاف', restart: 'إعادة تشغيل' };

function fmtDuration(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) {return `${d}ي ${h}س`;}
    if (h) {return `${h}س ${m}د`;}
    return `${m}د`;
}

const NAV_KEYS = ['cfo', 'cash-register', 'cashier-sales', 'sales-inquiry', 'revenues', 'expenses', 'cost-analysis', 'pnl', 'monthly-comparison', 'departments',
    'warehouse', 'wh-invoices', 'wh-moves', 'wh-returns', 'wh-prs', 'kitchen', 'dispatch',
    'recipes', 'procurement', 'hr-dashboard', 'employees', 'leaves', 'attendance', 'zkteco',
    'payroll', 'hr-departments', 'employee-portal', 'roster', 'reports', 'users', 'permissions',
    'yarasoft', 'oracle-data', 'whatsapp'];

/* Arabic last resort when the legacy i18n bridge is absent. The live app
   resolves these from ALL_PERMISSIONS.menus (readMenuLabels); this map only
   stops an English route key from reaching an Arabic admin screen. */
const NAV_LABELS_AR = {
    'cfo': 'المدير المالي', 'cash-register': 'سجلّ الصرف', 'cashier-sales': 'مبيعات الكاشير', 'sales-inquiry': 'استعلام المبيعات', 'revenues': 'الإيرادات', 'expenses': 'المصروفات',
    'cost-analysis': 'تحليل التكاليف', 'pnl': 'الأرباح والخسائر', 'monthly-comparison': 'مقارنة الشهور', 'departments': 'الأقسام',
    'warehouse': 'المخزون', 'wh-invoices': 'فواتير المخزن', 'wh-moves': 'حركات المخزون',
    'wh-returns': 'مرتجعات المخزون', 'wh-prs': 'طلبات الشراء', 'kitchen': 'المطبخ',
    'dispatch': 'التوزيع', 'recipes': 'الوصفات', 'procurement': 'المشتريات',
    'hr-dashboard': 'لوحة الموارد البشرية', 'employees': 'الموظفون', 'leaves': 'الإجازات',
    'attendance': 'الحضور', 'zkteco': 'جهاز البصمة', 'payroll': 'الرواتب',
    'hr-departments': 'أقسام الموارد البشرية', 'employee-portal': 'بوابة الموظف',
    'roster': 'الدوام', 'reports': 'التقارير', 'users': 'المستخدمون',
    'permissions': 'الصلاحيات', 'yarasoft': 'استيراد فواتير الكاشير', 'oracle-data': 'بيانات أوراكل',
    'whatsapp': 'واتساب',
};

/** Menu labels arrive as `<i class=ji data-i=…></i> NAME` HTML fragments. */
function plainMenuLabel(html) {
    return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const ZATCA_STATUS_AR = { queued: 'بالانتظار', processing: 'قيد الإرسال', reported: 'مُبلّغة', failed: 'فشلت', dead_letter: 'فشل نهائي', skipped_cancelled: 'ملغاة', skipped_disabled: 'موقوفة' };

function fmtBytes(b) {
    b = Number(b || 0);
    if (b < 1048576) {return `${(b / 1024).toFixed(1)}KB`;}
    if (b < 1073741824) {return `${(b / 1048576).toFixed(1)}MB`;}
    return `${(b / 1073741824).toFixed(2)}GB`;
}

function sectionCard(key, icon, title, bodyAttr, refreshAttr) {
    return `<section class="erp-card"><div class="erp-card__head">`
        + `<h3 class="erp-card__title"><i class="ji" data-i="${icon}" aria-hidden="true"></i> ${title}</h3>`
        + `<span class="erp-grow"></span>`
        + (refreshAttr ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-sec-reload="${refreshAttr}" aria-label="تحديث ${title}"><i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span></button>` : '')
        + `</div><div class="erp-card__body erp-stack" data-v2-sec="${key}">`
        + `<p class="erp-text-sm erp-text-muted" data-v2-sec-empty="${key}">اضغط تحديث لعرض هذا القسم.</p>`
        + `<div data-v2-sec-body="${bodyAttr}"></div></div></section>`;
}

function template(isAdmin) {
    return `
      <div class="erp-v2-settings">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">الإعدادات
              <span class="erp-eyebrow" dir="ltr" lang="en">Settings</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite" data-v2-note></div>
          </div>
          <div class="erp-dash-controls">
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>
        <div data-v2-main></div>
        ${isAdmin ? `<div data-v2-nav></div>` : ''}
        <div data-v2-sections>
          ${sectionCard('zatca', 'landmark', 'ربط هيئة الزكاة', 'zatca', 'zatca')}
          ${sectionCard('kot', 'printer', 'تذاكر المطبخ', 'kot', 'kot')}
          ${sectionCard('cards', 'id-card', 'بطاقات الموظفين', 'cards', 'cards')}
          ${sectionCard('punch', 'timer', 'البصمة الذاتية', 'punch', 'punch')}
          ${isAdmin ? sectionCard('server', 'zap', 'التحكم بالسيرفر', 'server', 'server') : ''}
          ${isAdmin ? sectionCard('backup', 'save', 'النسخ الاحتياطي الكامل والاستعادة', 'backup', 'backup') : ''}
          ${sectionCard('danger', 'inbox', 'تصدير وتصفير', 'danger', '')}
        </div>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void, confirmFn?: (m:string)=>boolean|Promise<boolean>}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, destroy: ()=>void}}
 */
export function mountSettingsScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 settings]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const isAdmin = ctx.role === 'admin';
    const canZatca = canWrite(ctx.role, ZATCA_WRITE_ROLES);
    const canKot = canWrite(ctx.role, KOT_WRITE_ROLES);

    let main = null;
    let zatca = null;
    let loading = false;
    let busy = false;
    let zatcaTimer = null;
    let sc = null;
    let scTimer = null;
    let scPolling = false;
    let scPending = '';
    let scNotice = '';
    let scErr = '';
    let scPanelOpen = false;

    host.insertAdjacentHTML('beforeend', template(isAdmin));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const noteEl = q('[data-v2-note]');

    const say = (m) => { if (noteEl) {noteEl.textContent = m;} notify(m); };
    const secBody = (k) => el.querySelector(`[data-v2-sec-body="${k}"]`);
    const secEmpty = (k) => el.querySelector(`[data-v2-sec-empty="${k}"]`);

    /* ── الرئيسية ───────────────────────────────────────────────────────── */

    function paintMain() {
        const box = q('[data-v2-main]');
        if (!main) {
            box.innerHTML = '<p class="erp-text-sm erp-text-muted">تعذّر جلب الإعدادات (صلاحية/خطأ)</p>';
            return;
        }
        box.innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title"><i class="ji" data-i="settings" aria-hidden="true"></i> بيانات المنشأة</h3></div>`
            + `<div class="erp-card__body erp-stack"><div class="erp-settings-fields">`
            + `<label class="erp-field" for="v2-main-name"><span class="erp-text-sm erp-text-muted">اسم المطعم</span>`
            + `<input id="v2-main-name" class="erp-input" data-v2-main="name" autocomplete="organization" value="${esc(main.name || '')}"></label>`
            + `<label class="erp-field" for="v2-main-currency"><span class="erp-text-sm erp-text-muted">العملة</span>`
            + `<input id="v2-main-currency" class="erp-input erp-input--ltr" data-v2-main="currency" value="${esc(main.currency || '')}" maxlength="3" dir="ltr" autocomplete="off"></label>`
            + `<label class="erp-field" for="v2-main-work-start"><span class="erp-text-sm erp-text-muted">بداية الدوام</span>`
            + `<input id="v2-main-work-start" class="erp-input erp-input--ltr" data-v2-main="workStartHour" type="number" min="0" max="23" value="${esc(main.workStartHour ?? 9)}" autocomplete="off"></label>`
            + `</div><div class="erp-dash-controls">`
            + `<span data-v2-logo-prev>${main.logoB64 ? `<img src="${main.logoB64}" alt="الشعار" style="width:80px;height:80px;border-radius:12px;object-fit:cover">` : '<span class="erp-text-sm erp-text-muted">بلا شعار مرفوع</span>'}</span>`
            + `<input type="file" data-v2-logo-file accept="image/*" hidden>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-logo-pick>رفع الشعار</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-logo-reset>إزالة الشعار</button>`
            + `<span class="erp-grow"></span>`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-main-save><i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ الإعدادات</span></button>`
            + `</div></div></section>`;
        if (isAdmin) {paintNav();}
    }

    function paintNav() {
        const box = q('[data-v2-nav]');
        if (!box) {return;}
        const hidden = String(main.hidden_nav_pages || '').split(',').map((x) => x.trim()).filter(Boolean);
        const menuLabels = readMenuLabels();
        box.innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title"><i class="ji" data-i="eye" aria-hidden="true"></i> إدارة ظهور القائمة الجانبية</h3></div>`
            + `<div class="erp-card__body erp-stack">`
            + `<div class="erp-settings-navgrid">`
            + NAV_KEYS.map((k) => {
                const label = plainMenuLabel(menuLabels[k]) || NAV_LABELS_AR[k] || k;
                return `<label class="erp-settings-navgrid__item"><input type="checkbox" data-v2-navbox value="${esc(k)}"${hidden.includes(k) ? ' checked' : ''}> <span>${esc(label)}</span></label>`;
            }).join('')
            + `</div><small class="erp-text-sm erp-text-muted">المُعلَّم = مخفي من القائمة الجانبية لكل المستخدمين (عرض فقط — الصفحات تبقى تعمل عبر الروابط الداخلية). الرئيسية والإعدادات لا يُخفيان.</small>`
            + `<div><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-nav-save><i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ ظهور القوائم</span></button></div>`
            + `</div></section>`;
    }

    /* ── ZATCA ──────────────────────────────────────────────────────────── */

    const ZT = (id) => el.querySelector(`[data-v2-zt="${id}"]`)?.value ?? '';

    function paintZatca() {
        const box = secBody('zatca');
        const empty = secEmpty('zatca');
        if (empty) {empty.hidden = true;}
        if (!zatca) {box.innerHTML = '<p class="erp-text-sm erp-text-muted">تعذر تحميل إعدادات ZATCA.</p>'; return;}
        const c = zatca.config || {};
        const qu = zatca.queue || {};
        const chips = Object.entries(qu).filter(([k, v]) => v > 0 || ['queued', 'reported', 'failed', 'dead_letter'].includes(k))
            .map(([k, v]) => `<span class="erp-badge" data-tone="${k === 'reported' ? 'success' : (k === 'failed' || k === 'dead_letter') ? 'danger' : 'neutral'}">${esc(ZATCA_STATUS_AR[k] || k)}: <b class="erp-num" dir="ltr">${formatInt(v)}</b></span>`).join('')
            || '<span class="erp-badge" data-tone="neutral">لا مهام بعد</span>';
        const envOpts = (c.environments || []).map((e) => `<option value="${esc(e.value)}"${e.value === c.environment ? ' selected' : ''}>${esc(e.label)}</option>`).join('');
        box.innerHTML = `<p><span class="erp-badge" data-tone="${c.enabled ? 'success' : 'danger'}">${c.enabled ? 'الربط مفعّل — يتم الإرسال لهيئة الزكاة' : 'الربط موقوف — لا يُرسل أي شيء للهيئة'}</span> `
            + `<span class="erp-badge" data-tone="neutral">${esc(c.environment_label || '—')}</span> `
            + (c.has_csid ? '<span class="erp-badge" data-tone="success">شهادة CSID جاهزة</span>' : '<span class="erp-badge" data-tone="warning">لا شهادة CSID بعد</span>')
            + `</p><p class="erp-text-sm erp-text-muted">${chips}</p>`
            + (canZatca ? `<div class="erp-dash-controls">`
            + `<button type="button" class="erp-btn erp-btn--sm${c.enabled ? ' erp-btn--danger' : ''}" data-v2-zt-toggle="${c.enabled ? 'off' : 'on'}">${c.enabled ? 'إيقاف الربط' : 'تفعيل الربط'}</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-zt-test>اختبار الاتصال</button>`
            + `<span class="erp-text-sm" data-v2-zt-testres></span></div>`
            + `<div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">اسم المنشأة</label><input class="erp-input" data-v2-zt="seller_name" value="${esc(c.seller_name || '')}">`
            + `<label class="erp-text-sm erp-text-muted">الرقم الضريبي</label><input class="erp-input erp-input--ltr" data-v2-zt="vat_number" value="${esc(c.vat_number || '')}" maxlength="15" inputmode="numeric" dir="ltr">`
            + `<label class="erp-text-sm erp-text-muted">السجل التجاري</label><input class="erp-input" data-v2-zt="crn" value="${esc(c.crn || '')}">`
            + `<label class="erp-text-sm erp-text-muted">الفرع</label><input class="erp-input" data-v2-zt="branch_name" value="${esc(c.branch_name || '')}">`
            + `<label class="erp-text-sm erp-text-muted">العنوان</label><input class="erp-input" data-v2-zt="address" value="${esc(c.address || '')}">`
            + `<label class="erp-text-sm erp-text-muted">البيئة</label><select class="erp-select" data-v2-zt="environment">${envOpts}</select>`
            + `<label class="erp-text-sm erp-text-muted">API اختياري</label><input class="erp-input erp-input--ltr" data-v2-zt="api_base" value="${esc(c.api_base || '')}" placeholder="${esc(c.default_api_base || '')}" dir="ltr">`
            + `<label class="erp-text-sm erp-text-muted">الحل البرمجي</label><input class="erp-input" data-v2-zt="solution_name" value="${esc(c.solution_name || '')}">`
            + `<label class="erp-text-sm erp-text-muted">الهوية (اختياري)</label><input class="erp-input erp-input--ltr" data-v2-zt="eid" value="${esc(c.eid && c.eid !== '••••' ? c.eid : '')}" dir="ltr">`
            + `<label class="erp-text-sm erp-text-muted">أقصى محاولات</label><input class="erp-input erp-input--ltr" data-v2-zt="max_attempts" type="number" min="1" max="50" value="${esc(c.max_attempts || 10)}">`
            + `<label class="erp-text-sm"><input type="checkbox" data-v2-zt-check="poll_in_server"${c.poll_in_server !== false ? ' checked' : ''}> مزامنة تلقائية من الخادم (موصى بها)</label>`
            + `</div><div class="erp-dash-controls">`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-zt-save><i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ بيانات الربط</span></button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-zt-csr>${c.has_csr ? 'إعادة توليد CSR' : 'توليد CSR'}</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-zt-csid>${c.has_csid ? 'إعادة طلب CSID' : 'طلب CSID برمز OTP'}</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-zt-manual>إدخال شهادة يدويًا</button>`
            + (c.has_csid ? '<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-zt-clear>حذف الشهادة</button>' : '')
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-zt-vat>تطبيق الرقم على الأقسام</button>`
            + `</div><div data-v2-zt-panel></div>`
            + `<p class="erp-text-sm erp-text-muted"><b>خطوات الربط:</b> ① احفظ البيانات ← ② ولّد CSR ← ③ رمز OTP من fatoora.zatca.gov.sa ← ④ أدخله هنا ← ⑤ فعّل الربط.</p>`
            : '')
            + `<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--sm" data-v2-zt-queue>تحديث الطابور</button>`
            + (canZatca ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-zt-retry="failed">إعادة الفاشلة</button><button type="button" class="erp-btn erp-btn--sm" data-v2-zt-retry="all">إعادة الكل</button>` : '')
            + `</div><div data-v2-zt-queuebox><p class="erp-text-sm erp-text-muted">جارٍ تحميل الطابور…</p></div>`;
        loadZatcaQueueBox();
    }

    async function loadZatcaQueueBox() {
        const box = el.querySelector('[data-v2-zt-queuebox]');
        if (!box) {return;}
        try {
            const d = await fetchZatcaQueue(20);
            if (!el.isConnected) {return;}
            const rows = Array.isArray(d.data) ? d.data : [];
            box.innerHTML = rows.length ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>الفاتورة</th><th>القسم</th><th>الإجمالي</th><th>الحالة</th><th>المحاولات</th><th>آخر خطأ</th><th>أُبلغت</th></tr></thead><tbody>`
                + rows.map((r) => `<tr><td class="erp-td erp-mono" dir="ltr">#${esc(String(r.invoice_counter))}</td><td class="erp-td">${esc(r.department_name || '—')}</td>`
                    + `<td class="erp-td erp-num" dir="ltr">${formatInt(r.total_amount)} ${esc(main?.currency || '')}</td>`
                    + `<td class="erp-td"><span class="erp-badge" data-tone="${r.status === 'reported' ? 'success' : (r.status === 'failed' || r.status === 'dead_letter') ? 'danger' : 'neutral'}">${esc(ZATCA_STATUS_AR[r.status] || r.status)}</span></td>`
                    + `<td class="erp-td erp-num" dir="ltr">${esc(r.attempts)}/${esc(r.max_attempts)}</td>`
                    + `<td class="erp-td erp-text-muted"><small>${esc(String(r.last_error || '').slice(0, 60) || '—')}</small></td>`
                    + `<td class="erp-td">${r.reported_at ? esc(String(r.reported_at).slice(0, 19).replace('T', ' ')) : '—'}</td></tr>`).join('')
                + `</tbody></table></div>`
                : '<p class="erp-text-sm erp-text-muted">لا مهام في طابور ZATCA بعد — ستظهر الفواتير هنا بعد تفعيل الربط</p>';
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذر تحميل الطابور: ${esc((e && e.message) || '')}</p>`;
        }
    }

    function ztPanel(html) {
        const p = el.querySelector('[data-v2-zt-panel]');
        if (p) {p.innerHTML = html; p.scrollIntoView({ block: 'nearest' });}
    }

    /* ── KOT ───────────────────────────────────────────────────────────── */

    async function loadKot() {
        const box = secBody('kot');
        const empty = secEmpty('kot');
        if (empty) {empty.hidden = true;}
        try {
            const cfg = await fetchKotSettings();
            if (!el.isConnected) {return;}
            box.innerHTML = `<p><span class="erp-badge" data-tone="${cfg.kot_enabled ? 'success' : 'neutral'}">${cfg.kot_enabled ? 'التذاكر مفعّلة — تُطبع تلقائيًا عند كل بيع' : 'التذاكر موقوفة — لن تُطبع أي تذكرة تجهيز'}</span> `
                + `<span class="erp-text-sm erp-text-muted">تذكرة لكل قسم تجهيز بلا أسعار${cfg.updated_at ? ` · آخر تحديث ${esc(String(cfg.updated_at).slice(0, 19).replace('T', ' '))}${cfg.updated_by ? ` — بواسطة ${esc(cfg.updated_by)}` : ''}` : ''}</span></p>`
                + `<div class="erp-dash-controls">`
                + `<label class="erp-text-sm"><input type="checkbox" data-v2-kot="enabled"${cfg.kot_enabled ? ' checked' : ''}${canKot ? '' : ' disabled'}> تفعيل التذاكر عند البيع</label>`
                + `<label class="erp-text-sm erp-text-muted">النسخ</label>`
                + `<select class="erp-select" data-v2-kot-sel="copies"${canKot ? '' : ' disabled'}>${[1, 2, 3].map((n) => `<option value="${n}"${Number(cfg.kot_copies) === n ? ' selected' : ''}>${n} ${n === 1 ? 'نسخة' : 'نسخ'}</option>`).join('')}</select>`
                + `<label class="erp-text-sm"><input type="checkbox" data-v2-kot="notes"${cfg.kot_include_notes ? ' checked' : ''}${canKot ? '' : ' disabled'}> إظهار اسم الضيف/الملاحظات</label>`
                + (canKot ? '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-kot-save><i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ</span></button>' : '')
                + `</div><p class="erp-text-sm erp-text-muted">تُطبع على طابعات <span class="erp-mono" dir="ltr">kot-&lt;رقم القسم&gt;</span>.</p>`;
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذر تحميل إعدادات التذاكر: ${esc((e && e.message) || '')}</p>`;
        }
    }

    /* ── البطاقات ───────────────────────────────────────────────────────── */

    async function loadCards() {
        const box = secBody('cards');
        const empty = secEmpty('cards');
        if (empty) {empty.hidden = true;}
        try {
            const s = await fetchCardSettings();
            if (!el.isConnected) {return;}
            box.innerHTML = `<div class="erp-dash-controls">`
                + `<label class="erp-text-sm erp-text-muted">رابط التحقق (QR)</label>`
                + `<input class="erp-input erp-input--ltr" data-v2-card="verifyBase" dir="ltr" value="${esc(s.verifyBase || '')}" placeholder="https://192.168.1.165:5000">`
                + `<label class="erp-text-sm erp-text-muted">طوارئ البطاقة</label>`
                + `<input class="erp-input erp-input--ltr" data-v2-card="emergencyPhone" dir="ltr" value="${esc(s.emergencyPhone || '')}" placeholder="+966-5X-XXX-XXXX">`
                + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-card-save><i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ</span></button>`
                + `</div><small class="erp-text-sm erp-text-muted">البطاقات الجديدة تستخدم الرابط المحفوظ تلقائيًا.</small>`;
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذر تحميل إعدادات البطاقات: ${esc((e && e.message) || '')}</p>`;
        }
    }

    /* ── البصمة الذاتية ─────────────────────────────────────────────────── */

    let punch = { settings: {}, attempts: [], summary: null };
    let punchFilter = '';

    const pBool = (k) => ['true', '1', 'on'].includes(String(punch.settings[k] ?? 'false').toLowerCase());

    async function loadPunch() {
        const box = secBody('punch');
        const empty = secEmpty('punch');
        if (empty) {empty.hidden = true;}
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>';
        try {
            punch = await fetchPunchAdmin();
            if (!el.isConnected) {return;}
            paintPunch();
            loadPunchFacesBox();
            loadFaceTargets();
            loadPunchDevicesBox();
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذر تحميل لوحة البصمة: ${esc((e && e.message) || '')}</p>`;
        }
    }

    function punchVal(k, fb) {
        const v = punch.settings[k];
        return v === undefined || v === null || v === '' ? fb : String(v);
    }

    function paintPunch() {
        const box = secBody('punch');
        const hasCoords = punch.settings['punch_restaurant_lat'] && punch.settings['punch_restaurant_lng'];
        const geoOn = pBool('punch_geofence_enabled');
        const portalOn = pBool('punch_portal_enabled');
        const chk = (k, fb) => {
            if (punch.settings[k] !== undefined) {return pBool(k) ? ' checked' : '';}
            return fb ? ' checked' : '';
        };
        box.innerHTML = `<div class="erp-dash-controls">`
            + `<label class="erp-text-sm"><input type="checkbox" data-v2-pu-check="punch_portal_enabled"${chk('punch_portal_enabled')}> <b>تفعيل البصمة الذاتية</b></label>`
            + `<label class="erp-text-sm"><input type="checkbox" data-v2-pu-check="punch_geofence_enabled"${chk('punch_geofence_enabled')}> <b>قيد الموقع (Geofence)</b></label>`
            + `<label class="erp-text-sm"><input type="checkbox" data-v2-pu-check="punch_device_binding"${chk('punch_device_binding')}> <b>ربط جهاز واحد</b></label>`
            + `<label class="erp-text-sm"><input type="checkbox" data-v2-pu-check="punch_device_auto_rebind"${chk('punch_device_auto_rebind', true)}> <b>الربط التلقائي (موصى به)</b></label>`
            + `<label class="erp-text-sm"><input type="checkbox" data-v2-pu-check="punch_selfie_enabled"${chk('punch_selfie_enabled')}> <b>لقطة تحقق</b></label>`
            + `<label class="erp-text-sm"><input type="checkbox" data-v2-pu-check="punch_face_enabled"${chk('punch_face_enabled')}> <b>محرك الوجه الأساسي</b></label>`
            + `<label class="erp-text-sm"><input type="checkbox" data-v2-pu-check="punch_face_v2_enabled"${chk('punch_face_v2_enabled')}> <b>الوجه المتقدم ArcFace</b></label>`
            + `</div><div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">عتبة الأساسي</label><input class="erp-input erp-input--ltr" data-v2-pu="punch_face_threshold" type="number" min="0.3" max="0.9" step="0.01" value="${esc(punchVal('punch_face_threshold', '0.55'))}">`
            + `<label class="erp-text-sm erp-text-muted">عتبة المتقدم</label><input class="erp-input erp-input--ltr" data-v2-pu="punch_face_v2_threshold" type="number" min="0.2" max="0.8" step="0.01" value="${esc(punchVal('punch_face_v2_threshold', '0.42'))}">`
            + `<label class="erp-text-sm erp-text-muted">النطاق (م)</label><input class="erp-input erp-input--ltr" data-v2-pu="punch_radius_meters" type="number" min="50" max="500" value="${esc(punchVal('punch_radius_meters', '120'))}">`
            + `<label class="erp-text-sm erp-text-muted">دقة الموقع (م)</label><input class="erp-input erp-input--ltr" data-v2-pu="punch_max_accuracy_m" type="number" min="10" max="200" value="${esc(punchVal('punch_max_accuracy_m', '50'))}">`
            + `<label class="erp-text-sm erp-text-muted">قدم GPS (ث)</label><input class="erp-input erp-input--ltr" data-v2-pu="punch_max_fix_age_s" type="number" min="5" max="120" value="${esc(punchVal('punch_max_fix_age_s', '30'))}">`
            + `</div><div class="erp-dash-controls">`
            + `<label class="erp-text-sm"><input type="checkbox" data-v2-pu-check="punch_teleport_check"${chk('punch_teleport_check', true)}> <b>فحص التنقل المستحيل</b></label>`
            + `<label class="erp-text-sm erp-text-muted">أقصى سرعة (كم/س)</label><input class="erp-input erp-input--ltr" data-v2-pu="punch_max_teleport_kmh" type="number" min="50" max="1000" value="${esc(punchVal('punch_max_teleport_kmh', '250'))}">`
            + `</div><div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">خط العرض</label><input class="erp-input erp-input--ltr" data-v2-pu="punch_restaurant_lat" value="${esc(punchVal('punch_restaurant_lat', ''))}" dir="ltr">`
            + `<label class="erp-text-sm erp-text-muted">خط الطول</label><input class="erp-input erp-input--ltr" data-v2-pu="punch_restaurant_lng" value="${esc(punchVal('punch_restaurant_lng', ''))}" dir="ltr">`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-pu-locate>أنا هنا — التقط الموقع</button>`
            + `</div><div class="erp-dash-controls">`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-pu-save><i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ الإعدادات (ينعكس فورًا)</span></button>`
            + ((!hasCoords && geoOn) ? '<span style="color:var(--erp-danger-text)">⚠ الجيوفانس مفعّل بلا إحداثيات — البصمة ستُرفض!</span>' : '')
            + (portalOn ? '<span style="color:var(--erp-success-text);font-weight:700">● الميزة مفعّلة — الموظفون يبصمون</span>' : '<span class="erp-text-sm erp-text-muted">● الميزة مغلقة</span>')
            + `</div>`
            + `<h4>تسجيل بصمة الوجه</h4><div data-v2-pu-faces><p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p></div>`
            + (isAdmin ? `<div class="erp-dash-controls">`
                + `<select class="erp-select" data-v2-pu-face-user aria-label="الموظف"><option value="">— اختر الموظف —</option></select>`
                + `<button type="button" class="erp-btn erp-btn--sm" data-v2-pu-enroll>تسجيل الوجه بالكاميرا</button>`
                + `<span class="erp-text-sm erp-text-muted">يُخزن كأرقام فقط — لا صور.</span></div>`
                + `<p class="erp-text-sm" data-v2-pu-face-result role="status" aria-live="polite"></p>` : '')
            + `<h4>الأجهزة المربوطة</h4><div data-v2-pu-devices><p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p></div>`
            + `<h4>سجل محاولات البصمة</h4>`
            + `<div class="erp-dash-controls"><select class="erp-select" data-v2-pu-filter><option value="">كل المحاولات</option><option value="rejected"${punchFilter === 'rejected' ? ' selected' : ''}>المرفوضة فقط</option><option value="accepted"${punchFilter === 'accepted' ? ' selected' : ''}>المقبولة فقط</option></select>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-pu-att>تحديث</button></div>`
            + `<div data-v2-pu-summary></div><div data-v2-pu-table></div>`;
        paintPunchAttempts();
    }

    function paintPunchAttempts() {
        const sm = punch.summary || {};
        const sumBox = el.querySelector('[data-v2-pu-summary]');
        const tbl = el.querySelector('[data-v2-pu-table]');
        if (!sumBox || !tbl) {return;}
        const items = [
            ['مقبولة (24س)', sm.accepted_24h ?? 0], ['مرفوضة (24س)', sm.rejected_24h ?? 0],
            ['خارج النطاق (7 أيام)', sm.out_of_range_7d ?? 0], ['جهاز غير مطابق (7 أيام)', sm.device_mismatch_7d ?? 0],
        ];
        sumBox.innerHTML = `<ul class="erp-kpis">` + items.map(([l, v]) => `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">${esc(l)}</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatInt(v)}</span></div></li>`).join('') + `</ul>`;
        const rows = punch.attempts || [];
        tbl.innerHTML = rows.length ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>الوقت</th><th>المستخدم</th><th>القرار</th><th>السبب</th><th>المسافة</th><th>الدقة</th><th>الثقة</th><th>IP</th></tr></thead><tbody>`
            + rows.map((a) => {
                const ok = a.decision === 'accepted';
                const trust = a.trust_score !== null && a.trust_score !== undefined ? Number(a.trust_score) : null;
                const reason = a.reject_code === 'PUNCH_LOCATION_TELEPORT' && a.teleport_kmh !== null && a.teleport_kmh !== undefined
                    ? `تنقل مستحيل (${esc(String(a.teleport_kmh))} كم/س)` : esc(a.reject_code || '—');
                return `<tr><td class="erp-td erp-text-muted">${esc(a.attempted_at ? String(a.attempted_at).slice(0, 19).replace('T', ' ') : '—')}</td>`
                    + `<td class="erp-td">${esc(a.username || '—')}</td>`
                    + `<td class="erp-td"><span class="erp-badge" data-tone="${ok ? 'success' : 'danger'}">${ok ? 'مقبولة' : 'مرفوضة'}</span></td>`
                    + `<td class="erp-td">${reason}${a.trust_signals ? `<br><small class="erp-text-muted">${esc(String(a.trust_signals))}</small>` : ''}</td>`
                    + `<td class="erp-td erp-num" dir="ltr">${a.distance_m !== null && a.distance_m !== undefined ? `${esc(String(a.distance_m))}م` : '—'}</td>`
                    + `<td class="erp-td erp-num" dir="ltr">${a.accuracy_m !== null && a.accuracy_m !== undefined ? `${esc(String(a.accuracy_m))}م` : '—'}</td>`
                    + `<td class="erp-td erp-num" dir="ltr">${trust === null ? '—' : `${trust}%`}</td>`
                    + `<td class="erp-td erp-mono" dir="ltr">${esc(a.remote_ip || '—')}</td></tr>`;
            }).join('') + `</tbody></table></div>`
            : '<p class="erp-text-sm erp-text-muted">لا محاولات مسجلة بعد</p>';
    }

    async function loadPunchFacesBox() {
        const box = el.querySelector('[data-v2-pu-faces]');
        if (!box) {return;}
        try {
            const faces = await fetchPunchFaces();
            if (!el.isConnected) {return;}
            box.innerHTML = faces.length ? faces.map((f) => `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid var(--erp-border);border-radius:10px;padding:8px 12px;margin-bottom:6px">`
                + `<span><b>${esc(f.name || f.username || `موظف ${f.user_id}`)}</b> <small class="erp-text-muted">سُجل ${esc(String(f.enrolled_at || '').slice(0, 10))}</small> `
                + `<span class="erp-badge" data-tone="${f.engine === 'v2' ? 'info' : 'neutral'}">${f.engine === 'v2' ? 'متقدم' : 'أساسي'}</span></span>`
                + (isAdmin ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-pu-unface="${f.user_id}">إزالة</button>` : '') + `</div>`).join('')
                : '<small class="erp-text-sm erp-text-muted">لا وجوه مسجلة بعد</small>';
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذر تحميل الوجوه: ${esc((e && e.message) || '')}</p>`;
        }
    }

    /** قائمة الموظفين المرتبطين بحساب — نفس وجهة الكاميرا القديمة (mobile-shell :592). */
    async function loadFaceTargets() {
        const sel = el.querySelector('[data-v2-pu-face-user]');
        if (!sel) {return;}
        const cur = sel.value;
        try {
            const employees = await fetchEmployees();
            if (!el.isConnected) {return;}
            const targets = (Array.isArray(employees) ? employees : []).filter((e) => e && e.userId);
            sel.innerHTML = '<option value="">— اختر الموظف —</option>'
                + targets.map((e) => `<option value="${esc(String(e.userId))}">${esc(e.name || '')}${e.employeeId ? ` — ${esc(String(e.employeeId))}` : ''}</option>`).join('');
            if (cur) {sel.value = cur;}
        } catch (_) { /* القائمة اختيارية — الرسالة تظهر عند التسجيل بلا اختيار */ }
    }

    function faceEnrollMessage(saved) {
        if (saved.v2 && saved.v1) {return 'تم تسجيل الوجه بالمحركين — البصمة جاهزة من أي كاميرا';}
        if (saved.v2) {return 'تم تسجيل الوجه بالمحرك المتقدم' + (saved.v1Error ? ` (الأساسي: ${saved.v1Error})` : '');}
        if (saved.v1) {return 'تم تسجيل الوجه بالمحرك الأساسي' + (saved.v2Error ? ` (المتقدم: ${saved.v2Error})` : '');}
        return 'فشل التسجيل: ' + (saved.v2Error || saved.v1Error || 'لا لقطة صالحة');
    }

    /** تسجيل الوجه مزدوجًا — نفس خطوة القديم (saveFaceEnrollment) عبر مستودع V2. */
    async function enrollFaceForTarget() {
        const sel = el.querySelector('[data-v2-pu-face-user]');
        const out = el.querySelector('[data-v2-pu-face-result]');
        const btn = el.querySelector('[data-v2-pu-enroll]');
        const put = (text, ok) => {
            if (!out) {return;}
            out.textContent = text;
            out.className = `erp-text-sm ${ok ? 'erp-text-success' : 'erp-text-danger'}`;
        };
        const userId = Number(sel && sel.value);
        if (!userId) {put('اختر الموظف أولًا', false); return;}
        const name = (sel.selectedOptions && sel.selectedOptions[0] && sel.selectedOptions[0].textContent) || '';
        if (btn) {btn.disabled = true; btn.textContent = 'افتح الكاميرا ووجّهها للوجه…';}
        try {
            const face = await captureFace({ title: `تسجيل وجه: ${name}`, target: 5, wantDescriptors: true });
            const saved = { v2: false, v1: false };
            if (face.images.length) {
                try { await enrollFaceV2(userId, face.images); saved.v2 = true; }
                catch (e) { saved.v2Error = (e && e.message) || 'فشل المحرك المتقدم'; }
            }
            if (face.descriptors.length) {
                try { await enrollFaceV1(userId, face.descriptors); saved.v1 = true; }
                catch (e) { saved.v1Error = (e && e.message) || 'فشل المحرك الأساسي'; }
            }
            if (!el.isConnected) {return;}
            put(faceEnrollMessage(saved), saved.v2 || saved.v1);
            if (saved.v2 || saved.v1) {loadPunchFacesBox();}
        } catch (e) {
            if ((e && e.message) !== 'FACE_CANCELLED') {put((e && e.message) || 'فشل التسجيل', false);}
        } finally {
            if (btn) {btn.disabled = false; btn.textContent = 'تسجيل الوجه بالكاميرا';}
        }
    }

    async function loadPunchDevicesBox() {
        const box = el.querySelector('[data-v2-pu-devices]');
        if (!box) {return;}
        try {
            const rows = await fetchPunchDevices();
            if (!el.isConnected) {return;}
            box.innerHTML = rows.length ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>المستخدم</th><th>الجهاز</th><th>IP الربط</th><th>آخر ظهور</th><th></th></tr></thead><tbody>`
                + rows.map((d) => {
                    const when = d.last_seen_at || d.bound_at;
                    return `<tr><td class="erp-td"><b>${esc(d.name || d.username || `مستخدم #${d.user_id}`)}</b>${d.username ? `<br><small class="erp-text-muted" dir="ltr">${esc(d.username)}</small>` : ''}</td>`
                    + `<td class="erp-td erp-mono" dir="ltr">${esc(String(d.device_id || '').slice(0, 12))}…</td>`
                    + `<td class="erp-td erp-mono" dir="ltr">${esc(d.bound_ip || '—')}</td>`
                    + `<td class="erp-td erp-text-muted">${esc(when ? String(when).slice(0, 19).replace('T', ' ') : '—')}</td>`
                    + (isAdmin ? `<td class="erp-td"><button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-pu-unbind="${Number(d.user_id)}">فك الربط</button></td>` : '<td class="erp-td"></td>') + `</tr>`;
                }).join('') + `</tbody></table></div>`
                + `<small class="erp-text-sm erp-text-muted">«فك الربط» يسمح بالبصمة من جهاز جديد فورًا.</small>`
                : '<p class="erp-text-sm erp-text-muted">لا أجهزة مربوطة — أول بصمة من كل موظف تربط جهازه تلقائيًا</p>';
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذر تحميل الأجهزة: ${esc((e && e.message) || '')}</p>`;
        }
    }

    /* ── النسخ ──────────────────────────────────────────────────────────── */

    function fmtBackupRow(f, i) {
        const sha = f.shaOk === true ? '<span class="erp-badge" data-tone="success">سليمة</span>'
            : f.shaOk === false ? '<span class="erp-badge" data-tone="danger">تالفة!</span>'
            : f.hasSha ? '<span class="erp-badge" data-tone="neutral">بصمة موجودة</span>'
            : '<span class="erp-badge" data-tone="neutral">بلا بصمة</span>';
        return `<tr><td class="erp-td"><b class="erp-mono" dir="ltr">${esc(f.file)}</b>${i === 0 ? ' <span class="erp-badge" data-tone="success">الأحدث</span>' : ''}</td>`
            + `<td class="erp-td erp-num" dir="ltr">${fmtBytes(f.bytes)}</td>`
            + `<td class="erp-td erp-text-muted">${esc(String(f.mtime || '').replace('T', ' ').slice(0, 19))}</td>`
            + `<td class="erp-td">${sha}</td>`
            + `<td class="erp-td">${f.manifest ? '<span class="erp-badge" data-tone="info">كاملة + إعدادات</span>' : '<span class="erp-text-muted">قاعدة فقط</span>'}</td>`
            + `<td class="erp-td"><button type="button" class="erp-btn erp-btn--sm" data-v2-bk-restore="${esc(f.file)}"${f.shaOk === false ? ' disabled' : ''}>استعادة</button></td></tr>`;
    }

    async function loadBackups() {
        const box = secBody('backup');
        const empty = secEmpty('backup');
        if (empty) {empty.hidden = true;}
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>';
        try {
            const d = await fetchBackups();
            if (!el.isConnected) {return;}
            const files = d.files || [];
            box.innerHTML = `<div class="erp-dash-controls">`
                + `<button type="button" class="erp-btn erp-btn--sm" data-v2-bk-now>نسخة احتياطية الآن</button>`
                + `<input type="file" data-v2-bk-file accept=".sql" hidden>`
                + `<button type="button" class="erp-btn erp-btn--sm" data-v2-bk-pick>رفع نسخة خارجية</button>`
                + `<button type="button" class="erp-btn erp-btn--sm" data-v2-bk-list>تحديث القائمة</button></div>`
                + `<small class="erp-text-sm erp-text-muted">النسخة تشمل قاعدة البيانات كاملة + الإعدادات — انسخ أحدث ملف على فلاشة خارجية. الاستعادة تمسح الحالي (نسخة أمان تلقائية أولًا).</small>`
                + `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>الملف</th><th>الحجم</th><th>التاريخ</th><th>السلامة</th><th>المحتوى</th><th></th></tr></thead><tbody>`
                + (files.map(fmtBackupRow).join('') || '<tr><td class="erp-td" colspan="6">لا نسخ بعد — دوس نسخة احتياطية الآن</td></tr>')
                + `</tbody></table></div>`
                + (d.dir ? `<small class="erp-text-sm erp-text-muted">مجلد النسخ: <code dir="ltr">${esc(d.dir)}</code></small>` : '')
                + `<div data-v2-bk-panel></div>`;
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">${esc((e && e.message) || 'تعذر الجلب')}</p>`;
        }
    }

    /* ── التحكم بالسيرفر ────────────────────────────────────────────────── */

    function scTone(state) {
        if (state === 'RUNNING' || state === 'success' || state === 'accepted') {return 'success';}
        if (state === 'STOPPED' || state === 'failed') {return 'danger';}
        if (!state || state === 'UNKNOWN') {return 'neutral';}
        return 'warning';
    }

    function scBox(title, value) {
        return `<div style="border:1px solid var(--erp-border);border-radius:10px;padding:10px;background:var(--erp-surface-sunken)">`
            + `<div class="erp-text-xs erp-text-muted">${esc(title)}</div>`
            + `<div class="erp-text-sm" style="margin-top:4px">${value}</div></div>`;
    }

    function paintServerControl() {
        const box = secBody('server');
        const empty = secEmpty('server');
        if (!box) {return;}
        if (empty) {empty.hidden = true;}

        if (!sc) {
            box.innerHTML = scErr
                ? `<div class="erp-stack"><p class="erp-text-sm" style="color:var(--erp-danger-text)">${esc(scErr)}</p>`
                  + `<div><button type="button" class="erp-btn erp-btn--sm" data-v2-sc-refresh>إعادة الفحص</button></div></div>`
                : '<p class="erp-text-sm erp-text-muted">جارٍ فحص حالة الخادم…</p>';
            return;
        }

        if (sc.available === false) {
            const notInstalled = sc.reason === 'not_installed';
            box.innerHTML = `<div class="erp-stack" style="border:1px solid var(--erp-warning);border-radius:10px;padding:12px">`
                + `<p><b>التحكم بالسيرفر غير متاح الآن.</b></p>`
                + `<p class="erp-text-sm erp-text-muted">${esc(sc.message || 'خدمة التحكم المرافقة لا تستجيب.')}</p>`
                + (notInstalled
                    ? `<p class="erp-text-sm">التثبيت مرة واحدة كمسؤول: <code dir="ltr">windows-service\\install-control-elevated.bat</code></p>`
                    : `<p class="erp-text-sm">تحقق من الخدمة <code dir="ltr">KarimERP-Control</code> في services.msc.</p>`)
                + `<p class="erp-text-sm">صفحة التحكم المستقلة: <code dir="ltr">${esc(sc.controlUrl || 'http://127.0.0.1:5011/')}</code></p>`
                + `<p class="erp-text-xs erp-text-muted">تُفتح محليًا على جهاز السيرفر، أو عن بُعد عبر نفق التحكم المستقل عند تشغيله.</p>`
                + `<div><button type="button" class="erp-btn erp-btn--sm" data-v2-sc-refresh>إعادة الفحص</button></div></div>`;
            return;
        }

        const svc = sc.service || {};
        const erp = sc.erp || {};
        const ctl = sc.control || {};
        const publicUrl = ctl.publicHost ? `https://${ctl.publicHost}/` : '';
        const state = String(svc.state || 'UNKNOWN');
        const running = state === 'RUNNING';
        const healthy = erp.healthy === true;
        const maintenance = sc.maintenance && sc.maintenance.state;
        const actionsOn = ctl.actionsEnabled !== false;
        const op = sc.operation || sc.lastOperation;
        const busyNow = !!scPending || !!(sc.operation && sc.operation.state === 'running');
        const lock = (!actionsOn || busyNow) ? ' disabled' : '';

        const opLine = op
            ? `${esc(SC_ACTION_AR[op.action] || op.action)} — ${esc(SC_STAGE_AR[op.state] || op.state)}`
                + (op.actor ? ` · ${esc(op.actor)}` : '')
                + (op.error ? `<br><span class="erp-text-xs" style="color:var(--erp-danger-text)">${esc(op.error)}</span>` : '')
            : '<span class="erp-text-muted">لا عمليات بعد</span>';

        const audit = (sc.audit || []).slice(0, 5);

        box.innerHTML = (scNotice ? `<p class="erp-text-sm" role="status"><span class="erp-badge" data-tone="info">${esc(scNotice)}</span></p>` : '')
            + (scErr ? `<p class="erp-text-sm" role="alert" style="color:var(--erp-danger-text)">${esc(scErr)}</p>` : '')
            + `<div class="erp-dash-controls">`
            + `<span class="erp-badge" data-tone="${scTone(state)}">الخدمة: ${esc(SVC_STATE_AR[state] || state)}</span>`
            + `<span class="erp-badge" data-tone="${healthy ? 'success' : 'danger'}">${healthy ? 'النظام يستجيب' : 'النظام لا يستجيب'}</span>`
            + (maintenance ? `<span class="erp-badge" data-tone="${maintenance === 'stopped' ? 'danger' : 'warning'}">صيانة: ${esc(maintenance)}</span>` : '')
            + `<span class="erp-badge" data-tone="neutral">لوحة التحكم <span dir="ltr">v${esc(ctl.version || '—')}</span></span></div>`
            + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">`
            + scBox('خدمة ويندوز', `<b dir="ltr">${esc(svc.name || 'KarimERP-Server')}</b>${svc.pid ? ` <span class="erp-text-xs erp-text-muted" dir="ltr">PID ${Number(svc.pid)}</span>` : ''}`)
            + scBox('صحة التطبيق', healthy
                ? `متصل${erp.latencyMs != null ? ` · <span dir="ltr">${Number(erp.latencyMs)}ms</span>` : ''}`
                    + `${erp.version ? ` · <span dir="ltr">v${esc(erp.version)}</span>` : ''}`
                    + `${erp.uptimeMs != null ? `<br><span class="erp-text-xs erp-text-muted">مدة التشغيل ${fmtDuration(erp.uptimeMs / 1000)}</span>` : ''}`
                : '<span style="color:var(--erp-danger-text)">لا يستجيب</span>')
            + scBox('آخر عملية', opLine)
            + scBox('وضع الصيانة', maintenance
                ? `${esc(maintenance)}<br><span class="erp-text-xs erp-text-muted">يمنع المراقب من إعادة التشغيل التلقائي</span>`
                : '<span class="erp-text-muted">غير مفعّل</span>')
            + `</div>`
            + `<div class="erp-dash-controls" style="margin-top:4px">`
            + `<button type="button" class="erp-btn ${running ? 'erp-btn--sm' : 'erp-btn--primary'}" data-v2-sc-open="start"${running ? ' disabled' : lock}>تشغيل السيرفر</button>`
            + `<button type="button" class="erp-btn ${running ? 'erp-btn--primary' : 'erp-btn--sm'}" data-v2-sc-open="restart"${running ? lock : ' disabled'}>إعادة تشغيل</button>`
            + `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-sc-open="stop"${running ? lock : ' disabled'}>إيقاف السيرفر</button>`
            + `</div>`
            + (publicUrl
                ? `<p class="erp-text-xs">التحكم الكامل من أي مكان: <a href="${esc(publicUrl)}" target="_blank" rel="noopener" dir="ltr">${esc(publicUrl)}</a></p>`
                : '')
            + `<p class="erp-text-xs erp-text-muted">الإيقاف يقطع هذه الصفحة والموقع العام حتى تعيد التشغيل من صفحة التحكم المستقلة${publicUrl ? ` (<a href="${esc(publicUrl)}" target="_blank" rel="noopener" dir="ltr">${esc(publicUrl)}</a>)` : ''} أو محليًا (<span dir="ltr">127.0.0.1:5011</span>). إعادة التشغيل تعيد النظام تلقائيًا خلال ثوانٍ.</p>`
            + (actionsOn ? '' : '<p class="erp-text-sm" style="color:var(--erp-warning-text)">الأوامر معطّلة في الخدمة المرافقة — أعد تثبيتها بالوضع الخدمي.</p>')
            + `<div data-v2-sc-panel></div>`
            + (audit.length
                ? `<details><summary class="erp-text-sm erp-text-muted">آخر الأوامر (${audit.length})</summary><div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>الوقت</th><th>المستخدم</th><th>الأمر</th><th>النتيجة</th></tr></thead><tbody>`
                    + audit.map((a) => `<tr><td class="erp-td erp-text-xs" dir="ltr">${esc(String(a.at || '').slice(5, 16).replace('T', ' '))}</td>`
                        + `<td class="erp-td">${esc(a.actor || '—')}</td>`
                        + `<td class="erp-td">${esc(SC_ACTION_AR[a.action] || a.action || '—')}</td>`
                        + `<td class="erp-td"><span class="erp-badge" data-tone="${scTone(a.result)}">${esc(a.result || '—')}</span></td></tr>`).join('')
                    + `</tbody></table></div></details>`
                : '');
    }

    function scOpenPanel(action) {
        const panel = el.querySelector('[data-v2-sc-panel]');
        if (!panel || !SC_ACTION_AR[action]) {return;}
        const phrase = action === 'stop' ? 'STOP' : action === 'restart' ? 'RESTART' : '';
        const title = action === 'stop' ? 'إيقاف كامل للسيرفر'
            : action === 'restart' ? 'إعادة تشغيل السيرفر' : 'تشغيل السيرفر';
        const warning = action === 'stop'
            ? 'ستنقطع هذه الصفحة والموقع العام وواجهات الكاشير فورًا. التشغيل بعدها من صفحة التحكم المحلية على جهاز السيرفر فقط.'
            : action === 'restart'
                ? 'سيتوقف السيرفر ثوانٍ ثم يعود تلقائيًا. الطلبات الجارية قد تنقطع.'
                : 'ستبدأ خدمة ويندوز ويصبح النظام متاحًا بعد اكتمال الإقلاع.';
        panel.innerHTML = `<div class="erp-stack" style="border:1px solid ${action === 'start' ? 'var(--erp-border)' : 'var(--erp-danger-text)'};border-radius:10px;padding:12px;margin-top:8px">`
            + `<p class="erp-text-sm"><b>${esc(title)}</b></p>`
            + `<p class="erp-text-sm" style="color:${action === 'start' ? 'var(--erp-text-muted)' : 'var(--erp-danger-text)'}">${esc(warning)}</p>`
            + (phrase
                ? `<label class="erp-text-sm erp-text-muted">اكتب <b dir="ltr">${phrase}</b> للتأكيد</label>`
                    + `<input class="erp-input erp-input--ltr" data-v2-sc-phrase placeholder="${phrase}" autocomplete="off" dir="ltr" maxlength="10">`
                : '')
            + `<div class="erp-dash-controls">`
            + `<button type="button" class="erp-btn erp-btn--sm ${action === 'start' ? 'erp-btn--primary' : 'erp-btn--danger'}" data-v2-sc-go="${action}">${esc(title)} الآن</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-sc-cancel>إلغاء</button></div></div>`;
        scPanelOpen = true;
        panel.scrollIntoView({ block: 'nearest' });
    }

    async function refreshServerControl() {
        // لا نمسح لوحة التأكيد أثناء كتابة المشرف STOP/RESTART — النداء الدوري
        // كل 5 ثوانٍ كان يعيد بناء القسم ويطمس المُدخل.
        if (scPolling || scPanelOpen) {return;}
        scPolling = true;
        try {
            const d = await fetchServerControl();
            if (!el.isConnected) {return;}
            sc = d;
            scErr = '';
            if (d && d.available !== false) {
                const opNow = d.operation;
                if (scPending) {
                    if (opNow && opNow.action === scPending) {
                        if (opNow.state === 'success') {
                            scNotice = `اكتمل: ${SC_ACTION_AR[opNow.action] || opNow.action} — ${SC_STAGE_AR[opNow.stage] || opNow.stage}`;
                            scPending = '';
                        } else if (opNow.state === 'failed') {
                            scNotice = `فشل: ${SC_ACTION_AR[opNow.action] || opNow.action} — ${opNow.error || 'خطأ غير معروف'}`;
                            scPending = '';
                        } else {
                            scNotice = `قيد التنفيذ: ${SC_ACTION_AR[opNow.action] || opNow.action} — ${SC_STAGE_AR[opNow.stage] || opNow.stage || '…'}`;
                        }
                    } else if (scPending === 'stop' && d.service && d.service.state !== 'RUNNING') {
                        scPending = '';
                        scNotice = 'السيرفر متوقف الآن — التشغيل من صفحة التحكم المحلية على جهاز السيرفر.';
                    }
                } else if (opNow && opNow.state === 'running') {
                    scPending = opNow.action;
                }
            }
            paintServerControl();
        } catch (e) {
            if (!el.isConnected) {return;}
            scErr = scPending === 'stop'
                ? 'انقطع الاتصال بعد أمر الإيقاف — إن كان السيرفر متوقفًا فاستخدم صفحة التحكم المحلية لتشغيله.'
                : `تعذّر جلب حالة التحكم: ${(e && e.message) || 'خطأ في الاتصال'} — إعادة المحاولة تلقائيًا.`;
            paintServerControl();
        } finally {
            scPolling = false;
        }
    }

    async function loadServerControl() {
        const box = secBody('server');
        const empty = secEmpty('server');
        if (empty) {empty.hidden = true;}
        if (box) {box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ فحص حالة الخادم…</p>';}
        sc = null; scErr = ''; scNotice = ''; scPanelOpen = false;
        await refreshServerControl();
        startScTimer();
    }

    function startScTimer() {
        stopScTimer();
        scTimer = setInterval(() => {
            if (!el.isConnected) {stopScTimer(); return;}
            refreshServerControl();
        }, 5000);
    }

    function stopScTimer() {
        if (scTimer) {clearInterval(scTimer); scTimer = null;}
    }

    async function runServerAction(action) {
        const phrase = action === 'stop' ? 'STOP' : action === 'restart' ? 'RESTART' : '';
        if (phrase) {
            const typed = (el.querySelector('[data-v2-sc-phrase]')?.value || '').trim().toUpperCase();
            if (typed !== phrase) {say(`اكتب ${phrase} للتأكيد`); return;}
        } else if (!await confirmFn('تشغيل خدمة السيرفر الآن؟')) {
            return;
        }
        try {
            await serverControlAction(action, phrase);
            if (!el.isConnected) {return;}
            scPending = action;
            scNotice = action === 'stop'
                ? 'تم قبول الإيقاف — ستنقطع هذه الواجهة خلال ثوانٍ. لإعادة التشغيل: صفحة التحكم المحلية على جهاز السيرفر.'
                : action === 'restart'
                    ? 'تم قبول إعادة التشغيل — سيعود النظام تلقائيًا، وستُحدَّث الحالة هنا.'
                    : 'تم قبول التشغيل — جارٍ إقلاع النظام.';
            scErr = '';
            paintServerControl();
            startScTimer();
        } catch (e) {
            say((e && e.message) || 'تعذر تنفيذ الأمر');
        }
    }

    /* ── التصدير والتصفير ───────────────────────────────────────────────── */

    function paintDanger() {
        const box = secBody('danger');
        const empty = secEmpty('danger');
        if (empty) {empty.hidden = true;}
        box.innerHTML = `<div class="erp-dash-controls">`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-exp-json>تصدير قراءة البيانات (JSON)</button>`
            + `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-reset-data>مسح جميع البيانات</button>`
            + (isAdmin ? '<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-reset-full>تصفير شامل (كل السستم)</button>' : '')
            + `</div><div data-v2-danger-panel></div>`
            + `<small class="erp-text-sm erp-text-muted">التصدير قراءة فقط من نفس أبواب الشاشات — بلا كلمات مرور ولا أسرار.</small>`;
    }

    async function exportJson() {
        say('جارٍ جمع البيانات للتصدير…');
        try {
            const b = await fetchLocalBundle();
            const data = {
                version: '4.9.2', exportDate: new Date().toISOString(), scope: 'v2-readable-registers',
                departments: b.departments, revenues: b.revenues, expenses: b.expenses,
                inventory: b.inventory, dispatches: b.dispatches,
                kitchenReturns: b.returns, employees: b.employees, leaves: b.leaves,
                recipes: b.recipes,
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `karim-export_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            say('تم التصدير');
        } catch (e) {
            say((e && e.message) || 'تعذر التصدير');
        }
    }

    /* ── القراءة الرئيسية ───────────────────────────────────────────────── */

    async function reload() {
        if (loading) {return;}
        loading = true;
        try {
            main = await fetchMainSettingsFull().catch(() => null);
            if (!el.isConnected) {return;}
            if (Array.isArray(main)) {main = main[0] || {};}
            setV2PrintLogo(main && main.logoB64);
            paintMain();
            say('الإعدادات — الأقسام التفصيلية تُحمَّل عند الطلب.');
        } catch {
            if (!el.isConnected) {return;}
            main = null;
            paintMain();
        } finally {
            loading = false;
        }
    }

    function loadSection(key) {
        if (key === 'zatca') {
            const box = secBody('zatca');
            box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>';
            fetchZatcaSettings().then((z) => {
                if (!el.isConnected) {return;}
                zatca = z;
                paintZatca();
                startZatcaQueueTimer();
            }).catch((e) => {
                if (!el.isConnected) {return;}
                box.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذر تحميل إعدادات ZATCA: ${esc((e && e.message) || '')}</p>`;
            });
        }
        else if (key === 'kot') {loadKot();}
        else if (key === 'cards') {loadCards();}
        else if (key === 'punch') {loadPunch();}
        else if (key === 'server') {loadServerControl();}
        else if (key === 'backup') {loadBackups();}
        else if (key === 'danger') {paintDanger();}
    }

    function startZatcaQueueTimer() {
        stopZatcaQueueTimer();
        zatcaTimer = setInterval(() => {
            if (!el.isConnected) {stopZatcaQueueTimer(); return;}
            if (el.querySelector('[data-v2-zt-queuebox]')) {loadZatcaQueueBox();}
            else {stopZatcaQueueTimer();}
        }, 15000);
    }

    function stopZatcaQueueTimer() {
        if (zatcaTimer) {clearInterval(zatcaTimer); zatcaTimer = null;}
    }

    /* ── التفويض ───────────────────────────────────────────────────────── */

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-logo-file]')) {
            const f = event.target.files?.[0];
            if (!f) {return;}
            if (f.size > 2 * 1024 * 1024) {say('حجم الصورة كبير جدًا (حد أقصى 2MB)'); event.target.value = ''; return;}
            const reader = new FileReader();
            reader.onload = async (evt) => {
                try {
                    const logoB64 = evt.target.result;
                    await updateMainSettings({ logoB64 });
                    if (!el.isConnected) {return;}
                    main = { ...(main || {}), logoB64 };
                    setV2PrintLogo(typeof logoB64 === 'string' ? logoB64 : '');
                    paintMain();
                    say('تم رفع الشعار وحفظه في قاعدة البيانات');
                } catch (e) {
                    if (!el.isConnected) {return;}
                    say((e && e.message) || 'تعذر حفظ الشعار');
                }
            };
            reader.readAsDataURL(f);
            event.target.value = '';
            return;
        }
        if (event.target.matches('[data-v2-bk-file]')) {
            const f = event.target.files?.[0];
            event.target.value = '';
            if (!f) {return;}
            if (!/\.sql$/i.test(f.name)) {say('ارفع ملف نسخة .sql فقط'); return;}
            uploadBackup(f).then((d) => {
                if (!el.isConnected) {return;}
                say(`اترفعت النسخة: ${d.file}`);
                loadBackups();
            }).catch((e) => {
                if (!el.isConnected) {return;}
                say((e && e.message) || 'فشل الرفع');
            });
        }
    });

    el.addEventListener('click', async (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        const sec = event.target.closest('[data-v2-sec-reload]');
        if (sec) {loadSection(sec.dataset.v2SecReload); return;}

        if (event.target.closest('[data-v2-main-save]')) {
            const v = (n) => el.querySelector(`[data-v2-main="${n}"]`)?.value;
            try {
                const saved = await updateMainSettings({
                    name: (v('name') || '').trim() || (main && main.name),
                    currency: (v('currency') || '').trim() || 'SAR',
                    workStartHour: parseInt(v('workStartHour'), 10) || 9,
                });
                if (!el.isConnected) {return;}
                main = { ...(main || {}), ...(saved || {}) };
                paintMain();
                say('تم حفظ الإعدادات في قاعدة البيانات');
            } catch (e) {
                if (!el.isConnected) {return;}
                say((e && e.message) || 'تعذر حفظ الإعدادات');
            }
            return;
        }
        if (event.target.closest('[data-v2-logo-pick]')) {el.querySelector('[data-v2-logo-file]')?.click(); return;}
        if (event.target.closest('[data-v2-logo-reset]')) {
            try {
                await updateMainSettings({ logoB64: null });
                if (!el.isConnected) {return;}
                main = { ...(main || {}), logoB64: null };
                setV2PrintLogo('');
                paintMain();
                say('تمت إزالة الشعار من قاعدة البيانات');
            } catch (e) {
                if (!el.isConnected) {return;}
                say((e && e.message) || 'تعذر إزالة الشعار');
            }
            return;
        }
        if (event.target.closest('[data-v2-nav-save]')) {
            const hidden = [...el.querySelectorAll('[data-v2-navbox]:checked')].map((x) => x.value).join(',');
            try {
                const saved = await updateMainSettings({ name: (main && main.name) || 'مطاعم الشرفه العالمي', hidden_nav_pages: hidden });
                if (!el.isConnected) {return;}
                main = { ...(main || {}), ...(saved || {}), hidden_nav_pages: hidden };
                say('تم تحديث ظهور القوائم لكل المستخدمين');
            } catch (e) {
                if (!el.isConnected) {return;}
                say((e && e.message) || 'فشل حفظ ظهور القوائم');
            }
            return;
        }

        if (event.target.closest('[data-v2-zt-save]')) {
            const payload = {
                seller_name: ZT('seller_name') || null, vat_number: ZT('vat_number') || null,
                crn: ZT('crn') || null, branch_name: ZT('branch_name') || null,
                address: ZT('address') || null, environment: ZT('environment') || null,
                api_base: ZT('api_base') || null, solution_name: ZT('solution_name') || null,
                eid: ZT('eid') || null, max_attempts: parseInt(ZT('max_attempts'), 10) || 10,
                poll_in_server: el.querySelector('[data-v2-zt-check="poll_in_server"]')?.checked !== false,
            };
            try {
                await saveZatcaSettings(payload);
                say('تم حفظ بيانات ربط ZATCA');
                loadSection('zatca');
            } catch (e) {say((e && e.message) || 'تعذر الحفظ');}
            return;
        }
        const ztt = event.target.closest('[data-v2-zt-toggle]');
        if (ztt) {
            const enable = ztt.dataset.v2ZtToggle === 'on';
            if (!enable && !await confirmFn('إيقاف الربط يجمّد الإبلاغ الضريبي مؤقتًا — الفواتير تبقى محفوظة وتُرسل عند إعادة التفعيل. متابعة؟')) {return;}
            try {
                await toggleZatca(enable);
                say(enable ? 'تم تفعيل ربط ZATCA — سيبدأ الإبلاغ تلقائيًا' : 'تم إيقاف ربط ZATCA — الطابور مجمّد');
                loadSection('zatca');
            } catch (e) {say((e && e.message) || 'تعذر تغيير الحالة');}
            return;
        }
        if (event.target.closest('[data-v2-zt-test]')) {
            const box = el.querySelector('[data-v2-zt-testres]');
            if (box) {box.textContent = 'جارٍ اختبار الاتصال…';}
            try {
                const r = await testZatca(ZT('api_base') || undefined);
                if (!el.isConnected) {return;}
                if (box) {box.textContent = r.ok ? `تستجيب (HTTP ${r.http_status}) — ${r.latency_ms}ms` : (r.message || r.error || 'تعذر الاتصال');}
            } catch (e) {
                if (!el.isConnected) {return;}
                if (box) {box.textContent = (e && e.message) || 'فشل الاختبار';}
            }
            return;
        }
        if (event.target.closest('[data-v2-zt-csr]')) {
            say('جارٍ توليد CSR…');
            try {
                const r = await generateCsr();
                if (!el.isConnected) {return;}
                ztPanel(`<div class="erp-dash-controls"><label class="erp-text-sm erp-text-muted">محتوى CSR — انسخه لمنصة Fatoora</label></div>`
                    + `<textarea class="erp-input erp-input--ltr" rows="6" readonly dir="ltr" data-v2-zt-csrtext>${esc(r.csr_pem || '')}</textarea>`
                    + `<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--sm" data-v2-zt-csricopy>نسخ CSR</button></div>`);
                say('تم توليد CSR حقيقي (EC P-256)');
                loadSection('zatca');
            } catch (e) {say((e && e.message) || 'تعذر توليد CSR — احفظ الرقم الضريبي أولاً');}
            return;
        }
        if (event.target.closest('[data-v2-zt-csricopy]')) {
            const ta = el.querySelector('[data-v2-zt-csrtext]');
            if (ta && navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(ta.value).then(() => say('تم نسخ CSR')).catch(() => {});
            }
            return;
        }
        if (event.target.closest('[data-v2-zt-csid]')) {
            ztPanel(`<div class="erp-dash-controls"><label class="erp-text-sm erp-text-muted">رمز OTP من منصة Fatoora (6 أرقام)</label>`
                + `<input class="erp-input erp-input--ltr" data-v2-zt-otp inputmode="numeric" maxlength="6" placeholder="######" autocomplete="off" dir="ltr">`
                + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-zt-csid-go>إرسال الطلب للهيئة</button></div>`
                + `<p class="erp-text-sm erp-text-muted">ادخل إلى fatoora.zatca.gov.sa ← «الأجهزة والبرمجيات» ← «إنشاء رمز OTP» ثم أدخله هنا.</p>`);
            return;
        }
        if (event.target.closest('[data-v2-zt-csid-go]')) {
            const otp = (el.querySelector('[data-v2-zt-otp]')?.value || '').trim();
            if (!/^\d{6}$/.test(otp)) {say('أدخل رمز OTP المكوّن من 6 أرقام'); return;}
            say('جارٍ إرسال الطلب للهيئة…');
            try {
                await requestCsid(otp);
                say('تم استلام شهادة CSID بنجاح — يمكنك تفعيل الربط الآن');
                loadSection('zatca');
            } catch (e) {say((e && e.message) || 'فشل طلب الشهادة');}
            return;
        }
        if (event.target.closest('[data-v2-zt-manual]')) {
            ztPanel(`<div class="erp-dash-controls"><label class="erp-text-sm erp-text-muted">رمز الشهادة من البوابة</label></div>`
                + `<textarea class="erp-input erp-input--ltr" data-v2-zt-mcsid rows="4" dir="ltr" placeholder="MIIC…"></textarea>`
                + `<div class="erp-dash-controls"><label class="erp-text-sm erp-text-muted">الرقم الضريبي (اختياري)</label>`
                + `<input class="erp-input erp-input--ltr" data-v2-zt-mvat inputmode="numeric" maxlength="20" dir="ltr">`
                + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-zt-mgo>حفظ الشهادة</button></div>`);
            return;
        }
        if (event.target.closest('[data-v2-zt-mgo]')) {
            const csid = (el.querySelector('[data-v2-zt-mcsid]')?.value || '').trim();
            if (!csid) {say('الصق رمز الشهادة أولاً'); return;}
            try {
                await saveCsidManual({ csid, vat_number: (el.querySelector('[data-v2-zt-mvat]')?.value || '').trim() || undefined });
                say('تم حفظ شهادة CSID — يمكنك تفعيل الربط الآن');
                loadSection('zatca');
            } catch (e) {say((e && e.message) || 'تعذر حفظ الشهادة');}
            return;
        }
        if (event.target.closest('[data-v2-zt-clear]')) {
            if (!await confirmFn('حذف شهادة CSID المحفوظة؟ سيتوقف الإبلاغ للهيئة حتى تُدخل شهادة جديدة.')) {return;}
            try {
                await saveCsidManual({ clear: true });
                say('تم حذف الشهادة');
                loadSection('zatca');
            } catch (e) {say((e && e.message) || 'تعذر حذف الشهادة');}
            return;
        }
        if (event.target.closest('[data-v2-zt-vat]')) {
            const vat = ZT('vat_number');
            if (!/\d{15}/.test(String(vat || '').replace(/\D/g, ''))) {say('احفظ الرقم الضريبي (15 رقمًا) أولاً'); return;}
            if (!await confirmFn(`سيتم تطبيق الرقم الضريبي ${vat} على جميع الأقسام/الفروع حتى تظهر الفواتير ورموز QR متوافقة. متابعة؟`)) {return;}
            try {
                const r = await applyVat(vat);
                say(`تم تحديث ${r.updated} قسماً بالرقم الضريبي الموحّد`);
            } catch (e) {say((e && e.message) || 'تعذر التطبيق');}
            return;
        }
        if (event.target.closest('[data-v2-zt-queue]')) {loadZatcaQueueBox(); return;}
        const ztr = event.target.closest('[data-v2-zt-retry]');
        if (ztr) {
            const scope = ztr.dataset.v2ZtRetry;
            if (!await confirmFn(scope === 'all' ? 'إعادة جدولة كل الفواتير الفاشلة والنهائية للإرسال من جديد؟' : 'إعادة محاولة الفواتير الفاشلة فقط؟')) {return;}
            try {
                const r = await retryZatcaQueue(scope);
                say(`تمت إعادة جدولة ${r.requeued} فاتورة`);
                loadSection('zatca');
            } catch (e) {say((e && e.message) || 'تعذر إعادة الجدولة');}
            return;
        }

        if (event.target.closest('[data-v2-kot-save]')) {
            try {
                const saved = await saveKotSettings({
                    kot_enabled: el.querySelector('[data-v2-kot="enabled"]')?.checked !== false,
                    kot_copies: parseInt(el.querySelector('[data-v2-kot-sel="copies"]')?.value, 10) || 1,
                    kot_include_notes: el.querySelector('[data-v2-kot="notes"]')?.checked !== false,
                });
                say(saved.kot_enabled ? 'تم الحفظ — التذاكر مفعّلة' : 'تم الحفظ — التذاكر موقوفة');
                loadKot();
            } catch (e) {say((e && e.message) || 'تعذر حفظ إعدادات التذاكر');}
            return;
        }

        if (event.target.closest('[data-v2-card-save]')) {
            try {
                await saveCardSettings({
                    verifyBase: el.querySelector('[data-v2-card="verifyBase"]')?.value || '',
                    emergencyPhone: el.querySelector('[data-v2-card="emergencyPhone"]')?.value || '',
                });
                say('تم حفظ إعدادات البطاقات');
            } catch (e) {say((e && e.message) || 'تعذر الحفظ');}
            return;
        }

        if (event.target.closest('[data-v2-pu-save]')) {
            const v = (n) => el.querySelector(`[data-v2-pu="${n}"]`)?.value ?? '';
            const c = (n) => el.querySelector(`[data-v2-pu-check="${n}"]`)?.checked ?? true;
            try {
                await savePunchSettings({
                    punch_portal_enabled: el.querySelector('[data-v2-pu-check="punch_portal_enabled"]')?.checked || false,
                    punch_geofence_enabled: el.querySelector('[data-v2-pu-check="punch_geofence_enabled"]')?.checked || false,
                    punch_device_binding: el.querySelector('[data-v2-pu-check="punch_device_binding"]')?.checked || false,
                    punch_device_auto_rebind: c('punch_device_auto_rebind'),
                    punch_selfie_enabled: el.querySelector('[data-v2-pu-check="punch_selfie_enabled"]')?.checked || false,
                    punch_face_enabled: el.querySelector('[data-v2-pu-check="punch_face_enabled"]')?.checked || false,
                    punch_face_v2_enabled: el.querySelector('[data-v2-pu-check="punch_face_v2_enabled"]')?.checked || false,
                    punch_face_threshold: v('punch_face_threshold') || '0.55',
                    punch_face_v2_threshold: v('punch_face_v2_threshold') || '0.42',
                    punch_radius_meters: v('punch_radius_meters') || '120',
                    punch_max_accuracy_m: v('punch_max_accuracy_m') || '50',
                    punch_max_fix_age_s: v('punch_max_fix_age_s') || '30',
                    punch_teleport_check: c('punch_teleport_check'),
                    punch_max_teleport_kmh: v('punch_max_teleport_kmh') || '250',
                    punch_restaurant_lat: v('punch_restaurant_lat') ?? '',
                    punch_restaurant_lng: v('punch_restaurant_lng') ?? '',
                });
                say('تم حفظ إعدادات البصمة — تنعكس على الموظفين فورًا');
                loadPunch();
            } catch (e) {say((e && e.message) || 'فشل الحفظ');}
            return;
        }
        if (event.target.closest('[data-v2-pu-locate]')) {
            if (!navigator.geolocation) {say('جهازك لا يدعم تحديد الموقع'); return;}
            say('جارٍ التقاط الموقع — اطلب أقصى دقة وانتظر…');
            navigator.geolocation.getCurrentPosition(async (pos) => {
                try {
                    await savePunchSettings({
                        punch_restaurant_lat: pos.coords.latitude,
                        punch_restaurant_lng: pos.coords.longitude,
                    });
                    if (!el.isConnected) {return;}
                    say(`تم حفظ إحداثيات المطعم بدقة ${Math.round(pos.coords.accuracy)}م`);
                    loadPunch();
                } catch (e) {
                    if (!el.isConnected) {return;}
                    say((e && e.message) || 'فشل الحفظ');
                }
            }, (err) => {
                say(err.code === 1 ? 'مُنِع الوصول للموقع — اسمح به من المتصفح' : 'تعذر تحديد الموقع');
            }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
            return;
        }
        if (event.target.closest('[data-v2-pu-att]')) {
            try {
                const r = await fetchPunchAttempts(punchFilter);
                if (!el.isConnected) {return;}
                punch.attempts = r.attempts;
                punch.summary = r.summary;
                paintPunchAttempts();
            } catch (e) {say((e && e.message) || 'تعذر تحميل السجل');}
            return;
        }
        if (event.target.closest('[data-v2-pu-enroll]')) {
            await enrollFaceForTarget();
            return;
        }
        const unf = event.target.closest('[data-v2-pu-unface]');
        if (unf) {
            if (!await confirmFn('متأكد من إزالة بصمة الوجه لهذا الموظف؟')) {return;}
            try {
                await removePunchFace(unf.dataset.v2PuUnface);
                say('تمت إزالة الوجه');
                loadPunchFacesBox();
            } catch (e) {say((e && e.message) || 'فشل');}
            return;
        }
        const unb = event.target.closest('[data-v2-pu-unbind]');
        if (unb) {
            if (!await confirmFn('فك ربط أجهزة هذا المستخدم؟ البصمة التالية من أي جهاز ستُربط تلقائيًا.')) {return;}
            try {
                const r = await unbindPunchDevice(unb.dataset.v2PuUnbind);
                say(`تم فك الربط (${r.unbound || 0} جهاز) — البصمة التالية تربط من جديد`);
                loadPunchDevicesBox();
            } catch (e) {say((e && e.message) || 'فشل فك الربط');}
            return;
        }

        if (event.target.closest('[data-v2-sc-refresh]')) {refreshServerControl(); return;}
        const scOpen = event.target.closest('[data-v2-sc-open]');
        if (scOpen) {scOpenPanel(scOpen.dataset.v2ScOpen); return;}
        if (event.target.closest('[data-v2-sc-cancel]')) {
            const panel = el.querySelector('[data-v2-sc-panel]');
            if (panel) {panel.innerHTML = '';}
            scPanelOpen = false;
            return;
        }
        const scGo = event.target.closest('[data-v2-sc-go]');
        if (scGo) {scPanelOpen = false; await runServerAction(scGo.dataset.v2ScGo); return;}

        if (event.target.closest('[data-v2-bk-now]')) {
            if (!await confirmFn('عمل نسخة احتياطية كاملة الآن (قاعدة البيانات + الإعدادات)؟')) {return;}
            try {
                const d = await doBackup();
                say(`تمت النسخة — ${(d.files || []).length} نسخة محفوظة`);
                loadBackups();
            } catch (e) {say((e && e.message) || 'فشل النسخ');}
            return;
        }
        if (event.target.closest('[data-v2-bk-pick]')) {el.querySelector('[data-v2-bk-file]')?.click(); return;}
        if (event.target.closest('[data-v2-bk-list]')) {loadBackups(); return;}
        const bkr = event.target.closest('[data-v2-bk-restore]');
        if (bkr) {
            const file = bkr.dataset.v2BkRestore;
            const panel = el.querySelector('[data-v2-bk-panel]');
            if (panel) {
                panel.innerHTML = `<div class="erp-dash-controls"><span class="erp-text-sm"><b>استعادة:</b> <span class="erp-mono" dir="ltr">${esc(file)}</span> — نسخة أمان تلقائية أولًا.</span>`
                    + `<label class="erp-text-sm"><input type="checkbox" data-v2-bk-env> استعادة .env أيضًا</label>`
                    + `<label class="erp-text-sm erp-text-muted">اكتب RESTORE</label>`
                    + `<input class="erp-input erp-input--ltr" data-v2-bk-confirm placeholder="RESTORE" dir="ltr" autocomplete="off">`
                    + `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-bk-go="${esc(file)}">تنفيذ الاستعادة</button></div>`;
                panel.scrollIntoView({ block: 'nearest' });
            }
            return;
        }
        const bkgo = event.target.closest('[data-v2-bk-go]');
        if (bkgo) {
            const c = (el.querySelector('[data-v2-bk-confirm]')?.value || '').trim();
            if (c !== 'RESTORE') {say('اكتب RESTORE للتأكيد'); return;}
            if (!await confirmFn('تأكيد نهائي: الاستعادة هتمسح الوضع الحالي وترجع النسخة؟')) {return;}
            try {
                await restoreBackup({ file: bkgo.dataset.v2BkGo, restoreEnv: el.querySelector('[data-v2-bk-env]')?.checked === true });
                say('تمت الاستعادة — أعد تشغيل خدمة السيرفر الآن');
                loadBackups();
            } catch (e) {say((e && e.message) || 'فشلت الاستعادة');}
            return;
        }

        if (event.target.closest('[data-v2-exp-json]')) {exportJson(); return;}
        if (event.target.closest('[data-v2-reset-data]')) {
            if (!await confirmFn('سيتم حذف جميع البيانات التشغيلية ولا يمكن التراجع. هل تريد المتابعة؟')) {return;}
            if (!await confirmFn('تأكيد نهائي')) {return;}
            if (busy) {return;}
            busy = true;
            try {
                await resetAllData();
                say('تم التصفير — جارٍ التحديث…');
                setTimeout(() => window.location.reload(), 1200);
            } catch (e) {
                say((e && e.message) || 'تعذر تصفير قاعدة البيانات');
                busy = false;
            }
            return;
        }
        if (event.target.closest('[data-v2-reset-full]')) {
            const panel = el.querySelector('[data-v2-danger-panel]');
            if (panel && !panel.innerHTML) {
                panel.innerHTML = `<div class="erp-card__body erp-stack" style="border:1px solid var(--erp-danger-text);border-radius:10px;padding:12px">`
                    + `<p class="erp-text-sm"><b style="color:var(--erp-danger-text)">تحذير نهائي — لا يمكن التراجع:</b> سيُحذف كل شيء (رواتب/حضور/موظفين/إيرادات/مصاريف/صرف/فواتير/مخزون/ورديات/موردين/حسابات). سيبقى مدير النظام + المحاسب والإعدادات وسجل التدقيق. <b>أكّد أخذ نسخة احتياطية أولًا!</b></p>`
                    + `<label class="erp-text-sm erp-text-muted">سبب التصفير (10 أحرف على الأقل)</label>`
                    + `<textarea class="erp-input" data-v2-rs-reason rows="2"></textarea>`
                    + `<label class="erp-text-sm erp-text-muted">اكتب CONFIRM PRODUCTION RESET</label>`
                    + `<input class="erp-input erp-input--ltr" data-v2-rs-confirm autocomplete="off" dir="ltr">`
                    + `<label class="erp-text-sm" style="color:var(--erp-danger-text)"><input type="checkbox" data-v2-rs-force checked> تصفير إجباري</label>`
                    + `<div><button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-rs-go>تنفيذ التصفير الشامل</button></div></div>`;
                panel.scrollIntoView({ block: 'nearest' });
            }
            return;
        }
        if (event.target.closest('[data-v2-rs-go]')) {
            const confirmation = (el.querySelector('[data-v2-rs-confirm]')?.value || '').trim();
            const reason = (el.querySelector('[data-v2-rs-reason]')?.value || '').trim();
            const force = el.querySelector('[data-v2-rs-force]')?.checked === true;
            if (confirmation !== 'CONFIRM PRODUCTION RESET') {say('اكتب العبارة CONFIRM PRODUCTION RESET كما هي تمامًا'); return;}
            if (!reason || reason.length < 10) {say('اكتب سببًا واضحًا لا يقل عن 10 أحرف'); return;}
            if (!await confirmFn('تحذير نهائي: سيتم حذف كل شيء في السستم. لا يمكن التراجع. هل أنت متأكد 100%؟')) {return;}
            try {
                const result = await operationalReset({ confirmation, reason, force });
                say(`تم التصفير الشامل — كل السستم رجع للصفر${result.reset?.reset_number ? ` — رقم العملية ${result.reset.reset_number}` : ''}`);
            } catch (e) {say((e && e.message) || 'تعذر التصفير؛ لم يتم تغيير البيانات');}
        }
    });

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-pu-filter]')) {
            punchFilter = event.target.value || '';
            fetchPunchAttempts(punchFilter).then((r) => {
                if (!el.isConnected) {return;}
                punch.attempts = r.attempts;
                punch.summary = r.summary;
                paintPunchAttempts();
            }).catch((e) => say((e && e.message) || 'تعذر تحميل السجل'));
        }
    });

    reload();

    return {
        el, reload,
        destroy() {
            stopZatcaQueueTimer();
            stopScTimer();
            el.remove();
        },
    };
}
