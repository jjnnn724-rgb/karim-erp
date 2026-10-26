/**
 * V2 — Fingerprint devices screen · شاشة 11 في سجل الترحيل
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PARITY (P2-2, 2026-10-17)
 *   The legacy page (features/zkteco.js, 563 lines) has four tabs. V2 now
 *   carries all of them on the same doors:
 *     الأجهزة        status + devices + test + sync + create/update/delete
 *                    + enable toggle + network scan (+ use a found device)
 *     ربط الموظفين   mappings + manual save + auto-link + device-user import
 *     سجل البصمات    newest 200 raw punches + dated CSV export
 *     تغطية البصمات  /coverage?days=7 — who is missing, and why
 *
 * WRITES ARE DOUBLE-LOCKED
 *   Role (admin|hr, the server's own WRITE_ROLES) AND the independent
 *   `v2zkwrite` flag — OFF by default, query overrides storage. With either
 *   missing the four tabs stay readable and no write control is drawn.
 *
 * WHAT THE SCREEN NEVER DOES
 *   It never renders `commKey`: the edit form starts blank and a blank field
 *   means "keep the stored key". It never speaks to the network itself (the
 *   repo is the only door). It never touches inline handlers (CSP).
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.180';
import { statusBadge } from '../status.js?v=4.9.180';
import { canWrite } from '../session.js?v=4.9.180';
import { zkWriteEnabled } from '../write-flags.js?v=4.9.180';
import { fetchHrDepartments } from '../data/hr-registers-repo.js?v=4.9.180';
import {
    fetchZkStatus, fetchZkDevices, deviceToRow, summarizeDevices,
    fetchZkMappings, mappingStats, fetchZkLogs, fetchZkCoverage, coverageStats,
    fetchStoredDeviceUsers, fetchLiveDeviceUsers,
    validateDeviceForm, punchStateName, verifyTypeName,
    ZK_WRITE_ROLES,
    testDevice, syncDevice, createDevice, updateDevice, deleteDevice,
    scanNetwork, saveMapping, autoLinkMappings, importDeviceUsers,
    downloadZkLogsCsv,
} from '../data/zkteco-repo.js?v=4.9.180';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const TABS = ['devices', 'mappings', 'logs', 'coverage'];

/** Device-local date+time, the legacy basis (features/zkteco.js:23-26). */
function fmtDateTime(iso) {
    if (!iso) {return '';}
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) {return '';}
        return `${d.toLocaleDateString('ar-EG')} ${d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    } catch { return ''; }
}

function fmtDate(iso) {
    if (!iso) {return '—';}
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) {return '—';}
        return d.toLocaleDateString('ar-EG');
    } catch { return '—'; }
}

function fmtTime(iso) {
    if (!iso) {return '—';}
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) {return '—';}
        return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return '—'; }
}

const intFmt = (v) => Number(v || 0).toLocaleString('en-US');

/** Server labels 0=in / 1=out for CSV; the UI keeps the legacy six states. */
function punchTone(state) {
    if (Number(state) === 0) {return 'success';}
    if (Number(state) === 1) {return 'danger';}
    return 'info';
}

function template(writable) {
    return `
      <section class="erp-card erp-v2-zkteco">
        <div class="erp-card__head">
          <h3 class="erp-card__title">أجهزة بصمة الحضور
            <span class="erp-eyebrow" dir="ltr" lang="en">Fingerprint Devices</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <div class="erp-zk__head-actions">
            ${writable ? `
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-add>
              <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة جهاز</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-scan>
              <i class="ji" data-i="search" aria-hidden="true"></i><span>مسح الشبكة</span>
            </button>` : ''}
            <button type="button" class="erp-btn erp-btn--sm" data-v2-reload>
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted">
            حالة المزامنة من النظام مباشرة، والصلاحية محكومة بالأدوار. أرقام
            الملخص قد تتأخر 20 ثانية (تحديث مؤقت).
            مفتاح الاتصال (Comm Key) لا يُعرض أبدًا، وحقله في التعديل فارغ يعني
            «أبقِ المفتاح المخزّن».
            ${writable ? '' : '<span data-v2-ro>الكتابة غير متاحة الآن — إما الصلاحية لا تسمح أو ميزة الكتابة غير مفعّلة.</span>'}
          </p>
          <div class="erp-zk__tabs" role="tablist" aria-label="أقسام شاشة البصمة">
            <button type="button" class="erp-btn erp-btn--sm erp-btn--primary is-active" role="tab" aria-selected="true" data-v2-tab="devices">الأجهزة</button>
            <button type="button" class="erp-btn erp-btn--sm" role="tab" aria-selected="false" data-v2-tab="mappings">ربط الموظفين</button>
            <button type="button" class="erp-btn erp-btn--sm" role="tab" aria-selected="false" data-v2-tab="logs">سجل البصمات</button>
            <button type="button" class="erp-btn erp-btn--sm" role="tab" aria-selected="false" data-v2-tab="coverage">تغطية البصمات</button>
          </div>
          <div data-v2-panel hidden></div>
          <div data-v2-pane="devices">
            <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
            <div data-v2-table></div>
          </div>
          <div data-v2-pane="mappings" hidden></div>
          <div data-v2-pane="logs" hidden></div>
          <div data-v2-pane="coverage" hidden></div>
        </div>
      </section>`;
}

function importCardHtml(devices, departments) {
    const options = devices.length
        ? devices.map((d) => `<option value="${esc(d.id)}">${esc(d.name)} — ${esc(d.ipAddress || d.ip || '')}</option>`).join('')
        : '<option value="">لا توجد أجهزة</option>';
    const deptOptions = departments.length
        ? `<option value="">بدون قسم</option>${departments.map((d) => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('')}`
        : '<option value="">بدون قسم (تعذّر تحميل الأقسام)</option>';
    return `<div class="erp-zk__import">
      <div class="erp-zk__import-head">
        <strong>سحب الأسماء من جهاز البصمة</strong>
        <span class="erp-text-sm erp-text-muted">الرقم الوظيفي = رقم البصمة، ويُنشأ الموظف مربوطًا تلقائيًا</span>
      </div>
      <div class="erp-zk__import-row">
        <label class="erp-field"><span>الجهاز</span>
          <select class="erp-input" data-v2-import-device>${options}</select>
        </label>
        <label class="erp-field"><span>القسم</span>
          <select class="erp-input" data-v2-import-dept>${deptOptions}</select>
        </label>
        <button type="button" class="erp-btn erp-btn--sm" data-v2-import-preview>
          <i class="ji" data-i="user-check" aria-hidden="true"></i><span>سحب الأسماء…</span>
        </button>
      </div>
    </div>`;
}

function mappingsShellHtml(writable) {
    return `<div data-v2-map-summary class="erp-zk__facts"></div>
      <div class="erp-zk__toolbar">
        <input class="erp-input" data-v2-map-search placeholder="بحث بالاسم أو الرقم الوظيفي أو القسم" aria-label="بحث في ربط الموظفين" style="max-width:320px">
        ${writable ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-auto-link>
          <i class="ji" data-i="zap" aria-hidden="true"></i><span>ربط تلقائي بالرقم الوظيفي</span>
        </button>` : ''}
      </div>
      ${writable ? `<div data-v2-import-host></div>` : ''}
      <h4 class="erp-zk__section-title">ربط الموظفين بأرقام البصمة</h4>
      <div data-v2-map-rows></div>
      <h4 class="erp-zk__section-title">أرقام بصمات غير مرتبطة بموظف</h4>
      <div data-v2-unmapped></div>`;
}

export function mountZktecoScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 zkteco]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const writable = canWrite(ctx.role, ZK_WRITE_ROLES) && zkWriteEnabled();

    let devices = [];
    let totals = {};
    let running = null;
    let mappings = { employees: [], unmapped: [] };
    let departments = [];
    let logs = [];
    let coverage = null;
    let logFrom = '';
    let logTo = '';
    let mapFilter = '';
    let tab = 'devices';
    let panelRow = null;
    let saving = false;

    const loaded = { devices: false, mappings: false, logs: false, coverage: false };
    const loading = { devices: false, mappings: false, logs: false, coverage: false };

    host.insertAdjacentHTML('beforeend', template(writable));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const pane = (name) => q(`[data-v2-pane="${name}"]`);
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');
    const panelEl = q('[data-v2-panel]');

    const table = createDataTable({
        caption: 'سجل أجهزة البصمة — بيانات حية',
        mode: 'client',
        pageSize: 20,
        stickyHeader: true,
        emptyMessage: 'لا توجد أجهزة مسجلة',
        emptyHint: 'أضف جهاز البصمة من زر «إضافة جهاز» أو ابحث عنه بمسح الشبكة.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'name', header: 'الجهاز', sortable: true, filterable: true,
                render: (row) => {
                    const label = row.nameResolved ? esc(row.name)
                        : `<span class="erp-text-muted">${esc(row.name)}</span>`;
                    const sub = (row.ip || row.port)
                        ? `<span class="erp-mini__sub erp-mono" dir="ltr">${esc(row.ip)}${row.port ? `:${esc(row.port)}` : ''}</span>`
                        : '';
                    return sub ? `${label}${sub}` : label;
                },
            },
            {
                key: 'status', header: 'الحالة', sortable: true, filterable: true, width: '150px',
                value: (row) => row.status,
                render: (row) => (row.status
                    ? statusBadge('device', row.status)
                    : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'enabled', header: 'مفعّل', sortable: true, width: '110px', align: 'center',
                value: (row) => (row.enabled ? 'نعم' : 'لا'),
                render: (row) => (row.enabled
                    ? statusBadge('branches', 'active')
                    : statusBadge('branches', 'inactive')),
            },
            {
                key: 'lastSyncAt', header: 'آخر مزامنة', sortable: true, width: '170px',
                render: (row) => {
                    const t = fmtDateTime(row.lastSyncAt);
                    return t ? esc(t) : `<span class="erp-text-muted">—</span>`;
                },
            },
            {
                key: 'totalSynced', header: 'إجمالي المزامن', sortable: true, type: 'number',
                width: '130px', align: 'end', value: (row) => row.totalSynced,
                render: (row) => `<span class="erp-num" dir="ltr">${esc(intFmt(row.totalSynced))}</span>`,
            },
            {
                key: 'lastError', header: 'آخر خطأ', filterable: true,
                render: (row) => (row.lastError
                    ? `<span class="erp-text-muted" title="${esc(row.lastError)}">${esc(row.lastError.slice(0, 80))}</span>`
                    : `<span class="erp-text-muted">—</span>`),
            },
            ...(writable ? [{
                key: 'actions',
                header: 'تشغيل',
                width: '330px',
                align: 'end',
                value: () => '',
                render: (row) => `<span class="erp-row-wrap">
                      <button type="button" class="erp-btn erp-btn--sm" data-v2-act="test" data-id="${esc(row.id)}">
                        <i class="ji" data-i="activity" aria-hidden="true"></i><span>فحص</span>
                      </button>
                      <button type="button" class="erp-btn erp-btn--sm" data-v2-act="sync" data-id="${esc(row.id)}">
                        <i class="ji" data-i="refresh" aria-hidden="true"></i><span>مزامنة</span>
                      </button>
                      <button type="button" class="erp-btn erp-btn--sm" data-v2-act="edit" data-id="${esc(row.id)}" aria-label="تعديل الجهاز" title="تعديل">
                        <i class="ji" data-i="pencil" aria-hidden="true"></i>
                      </button>
                      <button type="button" class="erp-btn erp-btn--sm" data-v2-act="toggle" data-id="${esc(row.id)}" aria-label="${row.enabled ? 'إيقاف الجهاز' : 'تفعيل الجهاز'}" title="${row.enabled ? 'إيقاف' : 'تفعيل'}">
                        <i class="ji" data-i="${row.enabled ? 'pause' : 'play'}" aria-hidden="true"></i>
                      </button>
                      <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-act="delete" data-id="${esc(row.id)}" aria-label="حذف الجهاز" title="حذف">
                        <i class="ji" data-i="trash" aria-hidden="true"></i>
                      </button>
                    </span>`,
            }] : []),
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    function paneState(target, text) {
        target.innerHTML = `<div class="erp-state" role="status"><span class="erp-state__title">${esc(text)}</span></div>`;
    }

    function paneError(target, message) {
        target.innerHTML = `<div class="erp-error" role="alert">
          <i class="ji" data-i="alert-triangle" aria-hidden="true"></i>
          <span>${esc(message)}</span>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-retry>إعادة المحاولة</button>
        </div>`;
    }

    function invalidate(...keys) {
        for (const key of keys) {loaded[key] = false;}
    }

    function paintSummary() {
        const c = summarizeDevices(devices);
        const parts = [`الأجهزة ${intFmt(c.total)}`, `متصلة ${intFmt(c.online)}`, `مفعّلة ${intFmt(c.enabled)}`];
        if (totals && (totals.today !== undefined || totals.unmapped !== undefined)) {
            parts.push(`بصمات اليوم ${intFmt(totals.today)}`);
            parts.push(`غير مربوطة ${intFmt(totals.unmapped)}`);
        } else {
            parts.push('ملخص اليوم تعذّر تحميله');
        }
        if (running === true) {parts.push('المحرك يعمل');}
        else if (running === false) {parts.push('المحرك متوقف');}
        summaryEl.textContent = parts.join(' · ');
        countEl.textContent = devices.length ? `(${devices.length})` : '';
    }

    async function reloadDevices() {
        if (loading.devices) {return;}
        loading.devices = true;
        table.setLoading(true);
        try {
            const [statusRes, devicesRes] = await Promise.allSettled([fetchZkStatus(), fetchZkDevices()]);
            if (!el.isConnected) {return;}
            if (statusRes.status === 'fulfilled') {
                totals = statusRes.value.totals;
                running = statusRes.value.running;
            } else {
                totals = {};
                running = null;
            }
            if (devicesRes.status === 'rejected') {
                loaded.devices = false;
                devices = [];
                table.setRows([]);
                summaryEl.textContent = '';
                countEl.textContent = '';
                const e = devicesRes.reason;
                table.setError(e && e.message === 'UNAUTHORIZED'
                    ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                    : (e && e.code === 'FORBIDDEN'
                        ? 'لا صلاحية لعرض أجهزة البصمة بهذا الحساب — القرار للخادم وحده.'
                        : `تعذّر تحميل الأجهزة: ${(e && e.message) || 'خطأ'}`));
                return;
            }
            // The register door is authoritative for the list; the status
            // door's embedded copy only fills ids the register did not return.
            const merged = new Map();
            for (const d of devicesRes.value) {merged.set(String(d.id), d);}
            if (statusRes.status === 'fulfilled') {
                for (const d of statusRes.value.devices) {
                    if (!merged.has(String(d.id))) {merged.set(String(d.id), d);}
                }
            }
            devices = [...merged.values()].map(deviceToRow);
            table.setRows(devices);
            paintSummary();
            loaded.devices = true;
        } finally {
            loading.devices = false;
        }
    }

    /* ── Mappings tab ─────────────────────────────────────────────────── */
    function deptName(code) {
        if (!code) {return '—';}
        const d = departments.find((x) => String(x.code) === String(code));
        return d ? d.name : String(code);
    }

    function takenIds() {
        const set = new Set();
        for (const e of mappings.employees) {
            for (const v of [e.deviceUserId, e.employeeId]) {
                const t = String(v ?? '').trim();
                if (!t) {continue;}
                set.add(t);
                if (/^\d+$/.test(t)) {set.add(String(Number(t)));}
            }
        }
        return set;
    }

    function filteredEmployees() {
        const needle = mapFilter.trim().toLowerCase();
        if (!needle) {return mappings.employees;}
        return mappings.employees.filter((e) => [
            e.name, e.employeeId, e.department, deptName(e.department),
        ].some((v) => String(v || '').toLowerCase().includes(needle)));
    }

    function paintMapRows() {
        const stats = mappingStats(mappings);
        const summary = q('[data-v2-map-summary]');
        if (summary) {
            summary.innerHTML = `
              <span class="erp-badge" data-tone="info">موظفون ${intFmt(stats.employees)}</span>
              <span class="erp-badge" data-tone="success">مربوطون ${intFmt(stats.linked)}</span>
              <span class="erp-badge" data-tone="${stats.unlinked ? 'warning' : 'success'}">غير مربوطين ${intFmt(stats.unlinked)}</span>
              <span class="erp-badge" data-tone="${stats.unmapped ? 'danger' : 'success'}">أرقام بلا موظف ${intFmt(stats.unmapped)}</span>`;
        }
        const rowsHost = q('[data-v2-map-rows]');
        const list = filteredEmployees();
        if (rowsHost) {
            const rows = list.map((e) => {
                const id = esc(e.id);
                const linked = String(e.deviceUserId ?? '').trim() !== '';
                const status = String(e.status || '');
                const inactive = status && status !== 'active'
                    ? ` <span class="erp-text-sm erp-text-muted">(${esc(status)})</span>` : '';
                return `<tr>
                  <td>${esc(e.name)}${inactive}</td>
                  <td><span class="erp-mono" dir="ltr">${esc(e.employeeId || '—')}</span></td>
                  <td>${esc(deptName(e.department))}</td>
                  <td>${linked
                        ? `<span class="erp-badge" data-tone="success">مربوط — ${esc(e.deviceUserId)}</span>`
                        : '<span class="erp-badge" data-tone="warning">غير مربوط</span>'}</td>
                  <td><input class="erp-input erp-input--ltr" dir="ltr" data-v2-map-input data-id="${id}"
                        value="${esc(e.deviceUserId ?? '')}" placeholder="رقم البصمة على الجهاز"
                        aria-label="رقم البصمة للموظف ${esc(e.name)}" ${writable ? '' : 'disabled'} style="max-width:170px"></td>
                  <td><span class="erp-num" dir="ltr">${intFmt(e.todayPunches || 0)}</span></td>
                  ${writable ? `<td><button type="button" class="erp-btn erp-btn--sm" data-v2-map-save data-id="${id}">
                    <i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ</span>
                  </button></td>` : ''}
                </tr>`;
            }).join('');
            rowsHost.innerHTML = `<div class="erp-table__scroll" tabindex="0" style="max-height:520px">
              <table class="erp-table__grid">
                <caption class="erp-sr-only">ربط الموظفين بأرقام البصمة</caption>
                <thead><tr><th>الموظف</th><th>الرقم الوظيفي</th><th>القسم</th><th>علامة الربط</th><th>رقم البصمة على الجهاز</th><th>بصمات اليوم</th>${writable ? '<th></th>' : ''}</tr></thead>
                <tbody>${rows || `<tr><td colspan="${writable ? 7 : 6}" class="erp-text-muted">${mappings.employees.length ? 'لا موظف يطابق البحث' : 'لا يوجد موظفون'}</td></tr>`}</tbody>
              </table>
            </div>`;
        }
        const unmappedHost = q('[data-v2-unmapped]');
        if (unmappedHost) {
            const rows = mappings.unmapped.map((u) => `<tr>
              <td><span class="erp-badge" data-tone="info">${esc(u.deviceUserId)}</span></td>
              <td><span class="erp-num" dir="ltr">${intFmt(u.punches)}</span></td>
              <td>${u.lastPunch ? esc(fmtDate(u.lastPunch) + ' · ' + fmtTime(u.lastPunch)) : '—'}</td>
              <td>${writable ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-map-user="${esc(u.deviceUserId)}">اختر موظفًا…</button>` : '—'}</td>
            </tr>`).join('');
            unmappedHost.innerHTML = `<div class="erp-table__scroll" tabindex="0" style="max-height:320px">
              <table class="erp-table__grid">
                <caption class="erp-sr-only">أرقام بصمات غير مرتبطة بموظف</caption>
                <thead><tr><th>رقم البصمة</th><th>عدد البصمات</th><th>آخر بصمة</th><th></th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4" class="erp-text-muted">كل البصمات مرتبطة بموظفين</td></tr>'}</tbody>
              </table>
            </div>`;
        }
    }

    function renderMappings() {
        const target = pane('mappings');
        target.innerHTML = mappingsShellHtml(writable);
        const importHost = q('[data-v2-import-host]');
        if (importHost) {importHost.innerHTML = importCardHtml(devices, departments);}
        paintMapRows();
    }

    async function loadMappings(force = false) {
        if (loading.mappings) {return;}
        if (loaded.mappings && !force) {return;}
        loading.mappings = true;
        const target = pane('mappings');
        paneState(target, 'جارٍ قراءة ربط الموظفين…');
        try {
            const [mapRes, deptRes] = await Promise.allSettled([fetchZkMappings(), fetchHrDepartments()]);
            if (!el.isConnected) {return;}
            if (deptRes.status === 'fulfilled') {departments = deptRes.value;}
            if (mapRes.status === 'rejected') {
                const e = mapRes.reason;
                loaded.mappings = false;
                paneError(target, e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض ربط الموظفين بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل ربط الموظفين: ${(e && e.message) || 'خطأ'}`);
                return;
            }
            mappings = mapRes.value;
            loaded.mappings = true;
            renderMappings();
        } finally {
            loading.mappings = false;
        }
    }

    async function saveMapRow(employeeId) {
        if (!writable || saving) {return;}
        const input = [...el.querySelectorAll('[data-v2-map-input]')]
            .find((i) => String(i.dataset.id) === String(employeeId));
        if (!input) {return;}
        const raw = String(input.value || '').trim();
        saving = true;
        try {
            const row = await saveMapping(employeeId, raw);
            if (!el.isConnected) {return;}
            notify(raw ? `تم ربط الموظف برقم البصمة ${raw}` : 'تم إلغاء ربط الموظف');
            invalidate('devices', 'logs', 'coverage');
            await loadMappings(true);
            if (row && row.name) {notify(raw ? `تم ربط «${row.name}» برقم البصمة ${raw}` : `أُلغي ربط «${row.name}»`);}
        } catch (e) {
            if (!el.isConnected) {return;}
            notify((e && e.message) || 'تعذّر حفظ الربط', 'error');
        } finally {
            saving = false;
        }
    }

    async function runAutoLink() {
        if (!writable || saving) {return;}
        if (!confirmFn('ربط تلقائي: كل موظف بلا رقم بصمة سيأخذ رقمه الوظيفي إن لم يكن محجوزًا. المتابعة؟')) {return;}
        saving = true;
        try {
            const res = await autoLinkMappings();
            if (!el.isConnected) {return;}
            notify((res && res.message) || 'تم الربط التلقائي');
            invalidate('devices', 'logs', 'coverage');
            await loadMappings(true);
        } catch (e) {
            if (!el.isConnected) {return;}
            notify((e && e.message) || 'فشل الربط التلقائي', 'error');
        } finally {
            saving = false;
        }
    }

    function openMapUserPanel(deviceUserId) {
        if (!writable) {return;}
        const candidates = mappings.employees.filter((e) => !['inactive', 'منتهي', 'منتهي الخدمة'].includes(String(e.status || '')));
        if (!candidates.length) {notify('لا يوجد موظفون للربط', 'warning'); return;}
        const options = candidates.map((e) => `<option value="${esc(e.id)}">${esc(e.name)} — ${esc(e.employeeId || '')}</option>`).join('');
        panelRow = String(deviceUserId);
        panelEl.innerHTML = `<div class="erp-zk__panel">
          <div class="erp-zk__panel-head">
            <h4>ربط رقم البصمة <span class="erp-mono" dir="ltr">${esc(deviceUserId)}</span> بموظف</h4>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close><i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span></button>
          </div>
          <div class="erp-stack">
            <label class="erp-field"><span>الموظف</span>
              <select class="erp-input" data-v2-map-employee>${options}</select>
            </label>
            <p class="erp-text-sm erp-text-danger" data-v2-form-err role="alert" hidden></p>
            <div class="erp-zk__panel-actions">
              <button type="button" class="erp-btn" data-v2-panel-close>إلغاء</button>
              <button type="button" class="erp-btn erp-btn--primary" data-v2-map-link>
                <i class="ji" data-i="save" aria-hidden="true"></i><span>ربط</span>
              </button>
            </div>
          </div>
        </div>`;
        panelEl.hidden = false;
        panelEl.scrollIntoView({ block: 'nearest' });
    }

    async function confirmMapUser() {
        if (!writable || saving) {return;}
        const employeeId = q('[data-v2-map-employee]')?.value;
        if (!employeeId) {return;}
        saving = true;
        try {
            await saveMapping(employeeId, panelRow);
            if (!el.isConnected) {return;}
            notify(`تم الربط — بصمات الرقم ${panelRow} ستظهر ضمن سجل الموظف`);
            closePanel();
            invalidate('devices', 'logs', 'coverage');
            await loadMappings(true);
        } catch (e) {
            if (!el.isConnected) {return;}
            const box = panelEl.querySelector('[data-v2-form-err]');
            if (box) {box.textContent = (e && e.message) || 'تعذّر الربط'; box.hidden = false;}
        } finally {
            saving = false;
        }
    }

    async function previewImport() {
        if (!writable || saving) {return;}
        const deviceId = q('[data-v2-import-device]')?.value;
        if (!deviceId) {notify('اختر جهاز البصمة أولًا', 'error'); return;}
        const dept = q('[data-v2-import-dept]')?.value || '';
        saving = true;
        notify('جارٍ قراءة مستخدمي الجهاز…');
        try {
            let users = [];
            try {
                users = await fetchStoredDeviceUsers(deviceId);
            } catch (_) { /* fall through to the live hardware read */ }
            if (!users.length) {users = await fetchLiveDeviceUsers(deviceId);}
            if (!el.isConnected) {return;}
            if (!users.length) {notify('لا يوجد مستخدمون مسجلون على هذا الجهاز', 'warning'); return;}
            openImportPanel(deviceId, dept, users);
        } catch (e) {
            if (!el.isConnected) {return;}
            notify((e && e.message) || 'تعذّر قراءة مستخدمي الجهاز', 'error');
        } finally {
            saving = false;
        }
    }

    function openImportPanel(deviceId, department, users) {
        const taken = takenIds();
        let fresh = 0;
        const rows = users.map((u) => {
            const uid = String(u.userId ?? '').trim();
            const name = String(u.name ?? '').trim() || (u.archived
                ? `أرشيف — بصمات سابقة (${intFmt(u.totalPunches || 0)})`
                : `موظف ${uid}`);
            const exists = !uid || taken.has(uid)
                || (/^\d+$/.test(uid) && taken.has(String(Number(uid))))
                || !!u.employeeId;
            if (!exists && uid) {
                fresh += 1;
                taken.add(uid);
                if (/^\d+$/.test(uid)) {taken.add(String(Number(uid)));}
            }
            const punchInfo = u.totalPunches != null
                ? ` <span class="erp-text-sm erp-text-muted">${intFmt(u.totalPunches)} بصمة</span>` : '';
            const linked = u.employeeName
                ? ` <span class="erp-text-sm erp-text-muted">← ${esc(u.employeeName)}</span>` : '';
            const archived = u.archived
                ? ' <span class="erp-badge" data-tone="neutral">محذوف من الجهاز</span>' : '';
            return `<tr>
              <td><input type="checkbox" data-v2-import-check value="${esc(uid)}" ${exists ? 'disabled' : 'checked'} aria-label="استيراد ${esc(name)}"></td>
              <td><span class="erp-badge" data-tone="info">${esc(uid || '—')}</span></td>
              <td><strong>${esc(name)}</strong>${punchInfo}${linked}${archived}</td>
              <td>${exists
                    ? '<span class="erp-badge" data-tone="neutral">موجود — تخطي</span>'
                    : '<span class="erp-badge" data-tone="success">جديد</span>'}</td>
            </tr>`;
        }).join('');
        panelRow = String(deviceId);
        panelEl.innerHTML = `<div class="erp-zk__panel">
          <div class="erp-zk__panel-head">
            <h4>مستخدمو جهاز البصمة (${intFmt(users.length)}) — جديد: ${intFmt(fresh)}</h4>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close><i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span></button>
          </div>
          <div class="erp-table__scroll" tabindex="0" style="max-height:340px">
            <table class="erp-table__grid">
              <caption class="erp-sr-only">مستخدمو الجهاز قبل الاستيراد</caption>
              <thead><tr><th>#</th><th>رقم البصمة</th><th>الاسم على الجهاز</th><th>الحالة</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <p class="erp-text-sm erp-text-danger" data-v2-form-err role="alert" hidden></p>
          <div class="erp-zk__panel-actions">
            <button type="button" class="erp-btn" data-v2-panel-close>إلغاء</button>
            <button type="button" class="erp-btn erp-btn--primary" data-v2-import-confirm data-dept="${esc(department)}">
              <i class="ji" data-i="circle-check" aria-hidden="true"></i><span>إنشاء المحدد كموظفين</span>
            </button>
          </div>
        </div>`;
        panelEl.hidden = false;
        panelEl.scrollIntoView({ block: 'nearest' });
    }

    async function confirmImport() {
        if (!writable || saving) {return;}
        const checks = [...panelEl.querySelectorAll('[data-v2-import-check]')];
        const ids = checks.filter((c) => c.checked && !c.disabled).map((c) => c.value);
        if (!ids.length) {
            const box = panelEl.querySelector('[data-v2-form-err]');
            if (box) {box.textContent = 'اختر مستخدمًا واحدًا على الأقل'; box.hidden = false;}
            return;
        }
        const dept = panelEl.querySelector('[data-v2-import-confirm]')?.dataset.dept || '';
        saving = true;
        try {
            const res = await importDeviceUsers(panelRow, ids, dept);
            if (!el.isConnected) {return;}
            notify((res && res.message) || 'تم الاستيراد');
            panelEl.innerHTML = `<div class="erp-zk__panel">
              <div class="erp-zk__panel-head"><h4>نتيجة الاستيراد</h4></div>
              <div class="erp-zk__facts" style="margin-bottom:12px">
                <span class="erp-badge" data-tone="success">تم إنشاؤهم ${intFmt(res && res.created)}</span>
                <span class="erp-badge" data-tone="warning">تُخطي (موجود) ${intFmt(res && res.skipped)}</span>
              </div>
              <p class="erp-text-sm erp-text-muted">${esc((res && res.message) || '')}</p>
              <div class="erp-zk__panel-actions">
                <button type="button" class="erp-btn erp-btn--primary" data-v2-panel-close>تم</button>
              </div>
            </div>`;
            invalidate('devices', 'logs', 'coverage');
            await loadMappings(true);
        } catch (e) {
            if (!el.isConnected) {return;}
            const box = panelEl.querySelector('[data-v2-form-err]');
            if (box) {box.textContent = (e && e.message) || 'فشل الاستيراد'; box.hidden = false;}
        } finally {
            saving = false;
        }
    }

    /* ── Logs tab ─────────────────────────────────────────────────────── */
    function renderLogs() {
        const target = pane('logs');
        const rows = logs.map((l) => {
            const employee = l.employeeName
                ? `<strong>${esc(l.employeeName)}</strong>`
                : `<span class="erp-badge" data-tone="warning">غير مرتبط (${esc(l.deviceUserId)})</span>`;
            return `<tr>
              <td>${esc(fmtDate(l.attendanceTime))}</td>
              <td><span class="erp-num" dir="ltr">${esc(fmtTime(l.attendanceTime))}</span></td>
              <td>${employee}</td>
              <td><span class="erp-mono" dir="ltr">${esc(l.employeeNumber || '—')}</span></td>
              <td><span class="erp-badge" data-tone="${punchTone(l.punchState)}">${esc(punchStateName(l.punchState))}</span></td>
              <td>${esc(verifyTypeName(l.verifyType))}</td>
              <td>${esc(l.deviceName || '—')}</td>
            </tr>`;
        }).join('');
        target.innerHTML = `<div class="erp-zk__toolbar">
            <label class="erp-field"><span>من تاريخ</span><input class="erp-input erp-input--ltr" type="date" data-v2-log-from value="${esc(logFrom)}"></label>
            <label class="erp-field"><span>إلى تاريخ</span><input class="erp-input erp-input--ltr" type="date" data-v2-log-to value="${esc(logTo)}"></label>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-export>
              <i class="ji" data-i="download" aria-hidden="true"></i><span>تصدير CSV</span>
            </button>
            <span class="erp-text-sm erp-text-muted">أحدث ${intFmt(logs.length)} بصمة خام — التصدير يحترم التاريخين</span>
          </div>
          <div class="erp-table__scroll" tabindex="0" style="max-height:560px">
            <table class="erp-table__grid">
              <caption class="erp-sr-only">سجل البصمات الخام</caption>
              <thead><tr><th>التاريخ</th><th>الوقت</th><th>الموظف</th><th>الرقم الوظيفي</th><th>الحركة</th><th>طريقة التحقق</th><th>الجهاز</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="7" class="erp-text-muted">لا توجد بصمات بعد — تأكد من فحص الجهاز وربطه</td></tr>'}</tbody>
            </table>
          </div>`;
    }

    async function loadLogs(force = false) {
        if (loading.logs) {return;}
        if (loaded.logs && !force) {return;}
        loading.logs = true;
        const target = pane('logs');
        paneState(target, 'جارٍ قراءة سجل البصمات…');
        try {
            logs = await fetchZkLogs(200);
            if (!el.isConnected) {return;}
            loaded.logs = true;
            renderLogs();
        } catch (e) {
            if (!el.isConnected) {return;}
            loaded.logs = false;
            paneError(target, e && e.code === 'FORBIDDEN'
                ? 'لا صلاحية لعرض سجل البصمات بهذا الحساب — القرار للخادم وحده.'
                : `تعذّر تحميل سجل البصمات: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading.logs = false;
        }
    }

    async function exportLogs() {
        if (saving) {return;}
        saving = true;
        notify('جارٍ تجهيز ملف البصمات…');
        try {
            const { blob, filename } = await downloadZkLogsCsv({ from: logFrom, to: logTo });
            if (!el.isConnected) {return;}
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {URL.revokeObjectURL(url); a.remove();}, 5000);
            notify('تم تنزيل ملف البصمات (يفتح مباشرة في Excel بالعربية)');
        } catch (e) {
            if (!el.isConnected) {return;}
            notify((e && e.message) || 'تعذّر التصدير', 'error');
        } finally {
            saving = false;
        }
    }

    /* ── Coverage tab ─────────────────────────────────────────────────── */
    function diagnosisTone(diagnosis) {
        const d = String(diagnosis || '');
        if (d === 'سليم') {return 'success';}
        if (d.startsWith('آخر بصمة')) {return 'warning';}
        return 'danger';
    }

    function renderCoverage() {
        const target = pane('coverage');
        const s = coverageStats(coverage || {});
        const problems = (coverage && coverage.problems) || [];
        const ok = (coverage && coverage.ok) || [];
        const unmapped = (coverage && coverage.unmapped_device_users) || [];
        const problemRows = problems.map((e) => `<tr>
          <td><strong>${esc(e.name)}</strong></td>
          <td>${esc(e.department || '—')}</td>
          <td><span class="erp-mono" dir="ltr">${esc(e.deviceUserId || '—')}</span></td>
          <td>${e.face_enrolled ? '<span class="erp-badge" data-tone="info">وجه ✓</span>' : '<span class="erp-text-muted">—</span>'}</td>
          <td>${e.last_punch ? `<span class="erp-mono" dir="ltr">${esc(String(e.last_punch).slice(0, 16))}</span>` : '<span class="erp-badge" data-tone="danger">أبدًا</span>'}</td>
          <td><span class="erp-num" dir="ltr">${intFmt(e.attendance_days || 0)}</span></td>
          <td><span class="erp-badge" data-tone="${diagnosisTone(e.diagnosis)}">${esc(e.diagnosis || '—')}</span></td>
          <td class="erp-text-sm">${esc(e.action || '—')}</td>
        </tr>`).join('');
        const okRows = ok.map((e) => `<tr>
          <td>${esc(e.name)}</td><td>${esc(e.department || '—')}</td>
          <td><span class="erp-mono" dir="ltr">${esc(e.deviceUserId || '—')}</span></td>
          <td>${e.face_enrolled ? 'وجه ✓' : '—'}</td>
          <td><span class="erp-mono" dir="ltr">${esc(String(e.last_punch || '—').slice(0, 16))}</span></td>
          <td><span class="erp-num" dir="ltr">${intFmt(e.attendance_days || 0)}</span></td>
        </tr>`).join('');
        const unmappedBox = unmapped.length ? `<div class="erp-zk__alert">
          <p><i class="ji" data-i="alert-triangle" aria-hidden="true"></i>
            <strong>بصمات خام على الجهاز بلا موظف مربوط — اربطها من تبويب «ربط الموظفين»:</strong></p>
          <div class="erp-row-wrap">${unmapped.map((u) => `<span class="erp-badge" data-tone="warning">جهاز #${esc(u.deviceUserId)} — ${intFmt(u.raw)} بصمة خام</span>`).join(' ')}</div>
          ${writable ? '<button type="button" class="erp-btn erp-btn--sm" data-v2-goto-mappings>فتح ربط الموظفين</button>' : ''}
        </div>` : '';
        target.innerHTML = `<div class="erp-zk__facts">
            <span class="erp-badge" data-tone="info">إجمالي الموظفين ${intFmt(s.total)}</span>
            <span class="erp-badge" data-tone="success">سليم ${intFmt(s.ok)}</span>
            <span class="erp-badge" data-tone="${s.problems ? 'danger' : 'success'}">مشاكل ${intFmt(s.problems)}</span>
            <span class="erp-badge" data-tone="info">بصمة وجه (تطبيق) ${intFmt(s.face)}</span>
            <span class="erp-badge" data-tone="${s.unmapped ? 'warning' : 'success'}">بصمات خام بلا موظف ${intFmt(s.unmapped)}</span>
            <span class="erp-text-sm erp-text-muted">آخر ${intFmt((coverage && coverage.days) || 7)} أيام${coverage && coverage.generated_at ? ` · ${esc(fmtDateTime(coverage.generated_at))}` : ''}</span>
          </div>
          ${unmappedBox}
          <h4 class="erp-zk__section-title">الموظفون الذين يحتاجون معالجة (${intFmt(problems.length)})</h4>
          <div class="erp-table__scroll" tabindex="0" style="max-height:480px">
            <table class="erp-table__grid">
              <caption class="erp-sr-only">تغطية البصمات — مشاكل</caption>
              <thead><tr><th>الموظف</th><th>القسم</th><th>رقم الجهاز</th><th>وجه (تطبيق)</th><th>آخر بصمة</th><th>أيام حضور</th><th>التشخيص</th><th>الإجراء</th></tr></thead>
              <tbody>${problemRows || '<tr><td colspan="8" class="erp-text-muted">كل الموظفين سليمون — لا شيء يحتاج معالجة</td></tr>'}</tbody>
            </table>
          </div>
          ${ok.length ? `<details class="erp-zk__details"><summary>الموظفون السليمون (${intFmt(ok.length)})</summary>
            <div class="erp-table__scroll" tabindex="0" style="max-height:360px">
              <table class="erp-table__grid">
                <caption class="erp-sr-only">تغطية البصمات — سليم</caption>
                <thead><tr><th>الموظف</th><th>القسم</th><th>رقم الجهاز</th><th>وجه (تطبيق)</th><th>آخر بصمة</th><th>أيام حضور</th></tr></thead>
                <tbody>${okRows}</tbody>
              </table>
            </div>
          </details>` : ''}`;
    }

    async function loadCoverage(force = false) {
        if (loading.coverage) {return;}
        if (loaded.coverage && !force) {return;}
        loading.coverage = true;
        const target = pane('coverage');
        paneState(target, 'جارٍ حساب تغطية البصمات…');
        try {
            coverage = await fetchZkCoverage(7);
            if (!el.isConnected) {return;}
            loaded.coverage = true;
            renderCoverage();
        } catch (e) {
            if (!el.isConnected) {return;}
            loaded.coverage = false;
            paneError(target, e && e.code === 'FORBIDDEN'
                ? 'لا صلاحية لعرض تغطية البصمات بهذا الحساب — القرار للخادم وحده.'
                : `تعذّر تحميل التغطية: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading.coverage = false;
        }
    }

    /* ── Tab switching / refresh ──────────────────────────────────────── */
    function setTab(next) {
        if (!TABS.includes(next)) {return;}
        tab = next;
        for (const b of el.querySelectorAll('[data-v2-tab]')) {
            const on = b.dataset.v2Tab === next;
            b.classList.toggle('is-active', on);
            b.classList.toggle('erp-btn--primary', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        for (const p of el.querySelectorAll('[data-v2-pane]')) {
            p.hidden = p.dataset.v2Pane !== next;
        }
        closePanel();
        if (next === 'devices') {reloadDevices();}
        else if (next === 'mappings') {loadMappings();}
        else if (next === 'logs') {loadLogs();}
        else {loadCoverage();}
    }

    function refreshCurrent() {
        if (tab === 'devices') {reloadDevices();}
        else if (tab === 'mappings') {loadMappings(true);}
        else if (tab === 'logs') {loadLogs(true);}
        else {loadCoverage(true);}
    }

    /* ── Device panel (add / edit / scan / import) ────────────────────── */
    function closePanel() {
        panelRow = null;
        panelEl.innerHTML = '';
        panelEl.hidden = true;
    }

    function setPanelError(message) {
        const box = panelEl.querySelector('[data-v2-form-err]');
        if (box) {box.textContent = message; box.hidden = false;}
    }

    function openDeviceForm(row, prefill = null) {
        if (!writable) {return;}
        const editing = !!row;
        const source = row || prefill || {};
        panelRow = row || null;
        panelEl.innerHTML = `<div class="erp-zk__panel">
          <div class="erp-zk__panel-head">
            <h4>${editing ? `تعديل جهاز: ${esc(row.name)}` : 'إضافة جهاز بصمة'}</h4>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close><i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span></button>
          </div>
          <form data-v2-device-form novalidate>
            <div class="erp-zk__form-grid">
              <label class="erp-field"><span>اسم الجهاز *</span>
                <input class="erp-input" name="name" maxlength="100" value="${esc(source.name || '')}" required>
              </label>
              <label class="erp-field"><span>عنوان IP *</span>
                <input class="erp-input erp-input--ltr" name="ipAddress" dir="ltr" value="${esc(source.ipAddress || source.ip || '')}" placeholder="192.168.1.201" required>
              </label>
              <label class="erp-field"><span>المنفذ</span>
                <input class="erp-input erp-input--ltr" name="port" type="number" min="1" max="65535" value="${esc(source.port || 4370)}">
              </label>
              <label class="erp-field"><span>مفتاح الاتصال (Comm Key)</span>
                <input class="erp-input erp-input--ltr" name="commKey" type="number" min="0" max="65535" value="" autocomplete="off" placeholder="${editing ? 'اتركه فارغًا للإبقاء على الحالي' : '0'}">
              </label>
              <label class="erp-field"><span>فترة المزامنة (ثانية)</span>
                <input class="erp-input erp-input--ltr" name="syncIntervalSeconds" type="number" min="5" max="86400" value="${esc(source.syncIntervalSeconds || 30)}">
              </label>
              <label class="erp-field"><span>مفعّل</span>
                <select class="erp-input" name="enabled">
                  <option value="true" ${source.enabled === false ? '' : 'selected'}>نعم — ابدأ المزامنة</option>
                  <option value="false" ${source.enabled === false ? 'selected' : ''}>لا — لاحقًا</option>
                </select>
              </label>
            </div>
            <p class="erp-text-sm erp-text-danger" data-v2-form-err role="alert" hidden></p>
            <div class="erp-zk__panel-actions">
              <button type="button" class="erp-btn" data-v2-panel-close>إلغاء</button>
              <button type="submit" class="erp-btn erp-btn--primary"><i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ الجهاز</span></button>
            </div>
          </form>
        </div>`;
        panelEl.hidden = false;
        panelEl.scrollIntoView({ block: 'nearest' });
        const first = panelEl.querySelector('input[name="name"]');
        if (first && typeof first.focus === 'function') {first.focus();}
    }

    async function saveDeviceForm(form) {
        if (!writable || saving) {return;}
        const fd = new FormData(form);
        const raw = {
            name: fd.get('name') || '',
            ipAddress: fd.get('ipAddress') || '',
            port: fd.get('port'),
            commKey: fd.get('commKey'),
            syncIntervalSeconds: fd.get('syncIntervalSeconds'),
            enabled: fd.get('enabled') === 'true',
        };
        const { errors, value } = validateDeviceForm(raw, { partial: false });
        if (errors.length) {
            setPanelError(errors[0].message);
            const field = form.querySelector(`[name="${errors[0].field}"]`);
            if (field && typeof field.focus === 'function') {field.focus();}
            return;
        }
        saving = true;
        const submit = form.querySelector('button[type="submit"]');
        if (submit) {submit.disabled = true;}
        try {
            if (panelRow) {
                await updateDevice(panelRow.id, value);
                if (!el.isConnected) {return;}
                notify(`تم تحديث الجهاز «${String(value.name).trim()}»`);
            } else {
                await createDevice(value);
                if (!el.isConnected) {return;}
                notify('أُضيف الجهاز — اضغط «فحص» للتأكد من الاتصال');
            }
            closePanel();
            invalidate('mappings', 'logs', 'coverage');
            await reloadDevices();
        } catch (e) {
            if (!el.isConnected) {return;}
            setPanelError((e && e.message) || 'تعذّر حفظ الجهاز');
        } finally {
            saving = false;
            if (submit) {submit.disabled = false;}
        }
    }

    async function runOp(op, id) {
        if (!writable || saving) {return;}
        const row = devices.find((r) => String(r.id) === String(id));
        if (!row) {return;}
        if (op === 'sync') {
            if (!confirmFn(`بدء مزامنة ${row.name} الآن؟ تسحب البصمات وتحقن الحضور — قد تستغرق دقيقة على الشبكات البطيئة.`)) {return;}
            notify(`بدأت مزامنة ${row.name}…`);
        }
        saving = true;
        try {
            const res = op === 'test' ? await testDevice(id) : await syncDevice(id);
            if (!el.isConnected) {return;}
            notify((res && res.message) || 'تمت العملية');
            if (op === 'sync') {invalidate('mappings', 'logs', 'coverage');}
            await reloadDevices();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify(`فشلت العملية: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
        }
    }

    async function toggleDevice(id) {
        if (!writable || saving) {return;}
        const row = devices.find((r) => String(r.id) === String(id));
        if (!row) {return;}
        saving = true;
        try {
            await updateDevice(id, { enabled: !row.enabled });
            if (!el.isConnected) {return;}
            notify(row.enabled ? `أُوقف الجهاز «${row.name}»` : `فُعّل الجهاز «${row.name}»`);
            await reloadDevices();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify((e && e.message) || 'تعذّر تغيير حالة الجهاز', 'error');
        } finally {
            saving = false;
        }
    }

    async function removeDevice(id) {
        if (!writable || saving) {return;}
        const row = devices.find((r) => String(r.id) === String(id));
        if (!row) {return;}
        if (!confirmFn(`حذف جهاز «${row.name}»؟ سيُحذف معه سجل بصماته الخام نهائيًا (ON DELETE CASCADE). لا يمكن التراجع.`)) {return;}
        saving = true;
        try {
            await deleteDevice(id);
            if (!el.isConnected) {return;}
            notify(`حُذف الجهاز «${row.name}»`);
            invalidate('mappings', 'logs', 'coverage');
            await reloadDevices();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify((e && e.message) || 'تعذّر حذف الجهاز', 'error');
        } finally {
            saving = false;
        }
    }

    async function runScan() {
        if (!writable || saving) {return;}
        saving = true;
        notify('جارٍ مسح الشبكات المحلية بحثًا عن أجهزة ZKTeco…');
        const button = q('[data-v2-scan]');
        if (button) {button.disabled = true;}
        try {
            const res = await scanNetwork();
            if (!el.isConnected) {return;}
            showScanPanel(res);
            notify(res.message || (res.found.length ? `وُجد ${res.found.length} جهاز` : 'لا أجهزة على الشبكة'));
        } catch (e) {
            if (!el.isConnected) {return;}
            notify((e && e.message) || 'فشل مسح الشبكة', 'error');
        } finally {
            saving = false;
            if (button) {button.disabled = false;}
        }
    }

    function showScanPanel(result) {
        const rows = (result.found || []).map((d) => `<tr>
          <td><span class="erp-badge" data-tone="info" dir="ltr">${esc(d.ip)}</span></td>
          <td><span class="erp-num" dir="ltr">${esc(d.port)}</span></td>
          <td>${d.serial ? `<span class="erp-mono" dir="ltr">${esc(d.serial)}</span>` : '—'}</td>
          <td>${d.deviceName ? esc(d.deviceName) : '—'}</td>
          <td>${d.firmware ? esc(d.firmware) : '—'}</td>
          <td><button type="button" class="erp-btn erp-btn--sm" data-v2-scan-use data-ip="${esc(d.ip)}" data-port="${esc(d.port)}">
            <i class="ji" data-i="check" aria-hidden="true"></i><span>استخدام هذا الجهاز</span>
          </button></td>
        </tr>`).join('');
        panelRow = null;
        panelEl.innerHTML = `<div class="erp-zk__panel">
          <div class="erp-zk__panel-head">
            <h4>نتائج مسح الشبكة</h4>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close><i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span></button>
          </div>
          <p class="erp-text-sm erp-text-muted">الشبكات الممسوحة: <span class="erp-mono" dir="ltr">${esc((result.subnets || []).join(', ') || '—')}</span> على المنفذ ${esc(result.port || 4370)}</p>
          <div class="erp-table__scroll" tabindex="0" style="max-height:340px">
            <table class="erp-table__grid">
              <caption class="erp-sr-only">أجهزة البصمة المكتشفة على الشبكة</caption>
              <thead><tr><th>عنوان IP</th><th>المنفذ</th><th>الرقم التسلسلي</th><th>اسم الجهاز</th><th>الفيرموير</th><th></th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6" class="erp-text-muted">لم يُعثر على أي جهاز بصمة ZKTeco على الشبكة. تأكد من تشغيل الجهاز وتوصيله، ثم أعد المسح.</td></tr>'}</tbody>
            </table>
          </div>
        </div>`;
        panelEl.hidden = false;
        panelEl.scrollIntoView({ block: 'nearest' });
    }

    async function useFoundDevice(ip, port) {
        if (!writable || saving) {return;}
        const offline = devices.find((d) => d.status !== 'online');
        if (offline) {
            if (!confirmFn(`تحديث عنوان الجهاز «${offline.name}» إلى ${ip}:${port}؟`)) {return;}
            saving = true;
            try {
                await updateDevice(offline.id, { ipAddress: ip, port: Number(port) || 4370 });
                if (!el.isConnected) {return;}
                notify('تم تحديث عنوان الجهاز — جارٍ المزامنة');
                closePanel();
                await reloadDevices();
            } catch (e) {
                if (!el.isConnected) {return;}
                setPanelError((e && e.message) || 'تعذّر تحديث العنوان');
            } finally {
                saving = false;
            }
            return;
        }
        closePanel();
        openDeviceForm(null, { name: '', ipAddress: ip, port: String(port || 4370) });
    }

    /* ── Events ───────────────────────────────────────────────────────── */
    el.addEventListener('click', (event) => {
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            if (actBtn.disabled || saving) {return;}
            const act = actBtn.dataset.v2Act;
            const id = actBtn.dataset.id;
            if (act === 'test' || act === 'sync') {runOp(act, id);}
            else if (act === 'edit') {
                const row = devices.find((r) => String(r.id) === String(id));
                if (row) {openDeviceForm(row);}
            } else if (act === 'toggle') {toggleDevice(id);}
            else if (act === 'delete') {removeDevice(id);}
            return;
        }
        const tabBtn = event.target.closest('[data-v2-tab]');
        if (tabBtn) {setTab(tabBtn.dataset.v2Tab); return;}
        if (event.target.closest('[data-v2-reload]')) {refreshCurrent(); return;}
        if (event.target.closest('[data-v2-add]')) {openDeviceForm(null); return;}
        if (event.target.closest('[data-v2-scan]')) {runScan(); return;}
        if (event.target.closest('[data-v2-panel-close]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-retry]')) {refreshCurrent(); return;}
        if (event.target.closest('[data-v2-auto-link]')) {runAutoLink(); return;}
        if (event.target.closest('[data-v2-import-preview]')) {previewImport(); return;}
        if (event.target.closest('[data-v2-import-confirm]')) {confirmImport(); return;}
        if (event.target.closest('[data-v2-map-link]')) {confirmMapUser(); return;}
        if (event.target.closest('[data-v2-export]')) {exportLogs(); return;}
        if (event.target.closest('[data-v2-goto-mappings]')) {setTab('mappings'); return;}

        const mapSave = event.target.closest('[data-v2-map-save]');
        if (mapSave) {saveMapRow(mapSave.dataset.id); return;}
        const mapUser = event.target.closest('[data-v2-map-user]');
        if (mapUser) {openMapUserPanel(mapUser.dataset.v2MapUser); return;}
        const useBtn = event.target.closest('[data-v2-scan-use]');
        if (useBtn) {useFoundDevice(useBtn.dataset.ip, useBtn.dataset.port); return;}

        const offlineRetry = event.target.closest('[data-erp-retry]');
        if (offlineRetry) {reloadDevices();}
    });

    el.addEventListener('submit', (event) => {
        const form = event.target.closest('[data-v2-device-form]');
        if (!form) {return;}
        event.preventDefault();
        saveDeviceForm(form);
    });

    el.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') {return;}
        if (event.target.matches('[data-v2-map-input]')) {
            event.preventDefault();
            saveMapRow(event.target.dataset.id);
        }
    });

    el.addEventListener('input', (event) => {
        if (event.target.matches('[data-v2-map-search]')) {
            mapFilter = String(event.target.value || '');
            paintMapRows();
        } else if (event.target.matches('[data-v2-log-from]')) {
            logFrom = String(event.target.value || '');
        } else if (event.target.matches('[data-v2-log-to]')) {
            logTo = String(event.target.value || '');
        }
    });

    reloadDevices();

    return {
        el,
        reload() {refreshCurrent();},
        getRows: () => devices,
        getTab: () => tab,
        destroy() {
            table.destroy();
            el.remove();
        },
    };
}
