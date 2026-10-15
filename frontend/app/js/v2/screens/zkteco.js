/**
 * V2 — Fingerprint devices screen · شاشة 11 في سجل الترحيل (الموجة الثانية: تشغيل)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Same per-screen contract as 01-10, plus explicit device operations
 * (owner approval): ping test (harmless) and pull sync (routine ops).
 * Saving guard + confirms live here; the server re-checks role and
 * device state on each call. Import/user mapping stays a separate screen.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.130';
import { statusBadge } from '../status.js?v=4.9.130';
import { canWrite } from '../session.js?v=4.9.130';
import {
    fetchZkStatus, fetchZkDevices, deviceToRow, summarizeDevices,
    ZK_WRITE_ROLES, testDevice, syncDevice,
} from '../data/zkteco-repo.js?v=4.9.130';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Device-local date+time, the legacy basis (features/zkteco.js:23-26). */
function fmtDateTime(iso) {
    if (!iso) {return '';}
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) {return '';}
        return `${d.toLocaleDateString('ar-EG')} ${d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    } catch { return ''; }
}

function template() {
    return `
      <section class="erp-card erp-v2-zkteco">
        <div class="erp-card__head">
          <h3 class="erp-card__title">أجهزة بصمة الحضور
            <span class="erp-eyebrow" dir="ltr" lang="en">Fingerprint Devices</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
          <p class="erp-text-sm erp-text-muted">
            حالة المزامنة من وجه الخادم الحالي
            (<span class="erp-addr" dir="ltr">/api/zkteco/status</span> و
            <span class="erp-addr" dir="ltr">/devices</span>)، والصلاحية قررها
            الخادم وحده. أرقام الملخص قد تتأخر 20 ثانية (كاش الخادم).
            الاختبار نبضة غير مؤثرة والمزامنة تسحب البصمات (لأدوار التشغيل)؛
            الاستيراد والربط شاشات مستقلة.
            مفتاح الاتصال (Comm Key) لا يُعرض أبدًا.
          </p>
          <div data-v2-table></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountZktecoScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 zkteco]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const writable = canWrite(ctx.role, ZK_WRITE_ROLES);

    let rows = [];
    let loading = false;
    let saving = false;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');

    const table = createDataTable({
        caption: 'سجل أجهزة البصمة — بيانات حية',
        mode: 'client',
        pageSize: 20,
        stickyHeader: true,
        emptyMessage: 'لا توجد أجهزة مسجلة',
        emptyHint: 'تُسجَّل الأجهزة من شاشة البصمة في النظام الحالي.',
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
                render: (row) => `<span class="erp-num" dir="ltr">${esc(row.totalSynced.toLocaleString('en-US'))}</span>`,
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
                width: '220px',
                align: 'end',
                value: () => '',
                render: (row) => `<span class="erp-row-wrap">
                      <button type="button" class="erp-btn erp-btn--sm" data-v2-act="test" data-id="${esc(row.id)}">
                        <i class="ji" data-i="activity" aria-hidden="true"></i><span>اختبار</span>
                      </button>
                      <button type="button" class="erp-btn erp-btn--sm" data-v2-act="sync" data-id="${esc(row.id)}">
                        <i class="ji" data-i="refresh" aria-hidden="true"></i><span>مزامنة</span>
                      </button>
                    </span>`,
            }] : []),
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    function paintSummary(totals, running) {
        const c = summarizeDevices(rows);
        const parts = [
            `الأجهزة ${c.total}`, `متصلة ${c.online}`, `مفعّلة ${c.enabled}`,
            `بصمات اليوم ${totals.today ?? 0}`,
            `غير مربوطة ${totals.unlinkedEmployees ?? 0}`,
            running ? 'المحرك يعمل' : 'المحرك متوقف',
        ];
        summaryEl.textContent = parts.join(' · ');
        countEl.textContent = rows.length ? `(${rows.length})` : '';
    }

    /** Ping is harmless; sync pulls punches (minutes on slow links).
     *  One operation at a time, explicit confirms, verbatim answers. */
    async function runOp(op, id) {
        if (saving) {return;}
        const row = rows.find((r) => String(r.id) === String(id));
        if (!row) {return;}
        if (op === 'sync') {
            if (!confirmFn(`بدء مزامنة ${row.name} الآن؟ تسحب البصمات وتحقن الحضور — قد تستغرق دقيقة على الشبكات البطيئة.`)) {return;}
            notify(`بدأت مزامنة ${row.name}…`);
        }
        saving = true;
        try {
            const res = op === 'test' ? await testDevice(id) : await syncDevice(id);
            notify((res && res.message) || 'تمت العملية');
            await reload();
        } catch (e) {
            notify(`فشلت العملية: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
        }
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        table.setLoading(true);
        try {
            const [status, devices] = await Promise.all([fetchZkStatus(), fetchZkDevices()]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            // The status door already carries devices; the register door is
            // authoritative for the list — merged by id, register wins.
            const merged = new Map();
            for (const d of devices) {merged.set(String(d.id), d);}
            for (const d of status.devices || []) {
                if (!merged.has(String(d.id))) {merged.set(String(d.id), d);}
            }
            rows = [...merged.values()].map(deviceToRow);
            table.setRows(rows);
            paintSummary(status.totals || {}, status.running);
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = [];
            table.setRows([]);
            summaryEl.textContent = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض أجهزة البصمة بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل الأجهزة: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
        }
    }

    el.addEventListener('click', (event) => {
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            if (actBtn.disabled) {return;}
            runOp(actBtn.dataset.v2Act === 'sync' ? 'sync' : 'test', actBtn.dataset.id);
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    reload();

    return {
        el,
        reload,
        getRows: () => rows,
        destroy() {
            table.destroy();
            el.remove();
        },
    };
}
