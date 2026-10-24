/**
 * V2 — الأجهزة والجلسات (البند ١٠)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHY A SCREEN AND NOT A MENU ITEM
 *   Every role needs to be able to end a session they no longer control —
 *   a phone left at the branch, a browser someone forgot to close. Only the
 *   admin has a settings menu, so putting this there would hide the control
 *   from the cashier who needs it most. It is a sub-route (`#/sessions`)
 *   opened from the profile slot, like `#/login`.
 *
 * WHAT IT SHOWS AND WHAT IT NEVER SHOWS
 *   Device, IP, start, last activity, expiry — the server's own fields
 *   (session-routes.js). No token, no hash, no user id: the API is
 *   self-service and scoped by the JWT, so there is nothing to choose here.
 *
 * THE CURRENT SESSION IS MARKED, NOT HIDDEN. Revoking it is allowed (that is
 * a legitimate "sign out everywhere including here"), and the caller decides
 * what happens next via `onCurrentRevoked` — this screen never navigates on
 * its own.
 *
 * No inline handlers (CSP nonce), one delegated listener, and one re-entrancy
 * guard per operation: this app has already been bitten by double-click
 * convoys, and a duplicate DELETE answers 404 on the second call.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.154';
import { statusBadge } from '../status.js?v=4.9.154';
import {
    fetchSessions,
    revokeSession,
    revokeOtherSessions,
    formatMoment,
} from '../data/sessions-repo.js?v=4.9.154';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function template() {
    return `
      <section class="erp-card erp-v2-sessions">
        <div class="erp-card__head">
          <h3 class="erp-card__title">الأجهزة والجلسات
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
          <button type="button" class="erp-btn erp-btn--ghost erp-btn--sm" data-v2-revoke-others>
            <i class="ji" data-i="shield-check" aria-hidden="true"></i><span>إبطال الجلسات الأخرى</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted">
            إبطال جهاز يقطع تجديد جلسته فورًا. الجلسة الحالية معلَّمة، وتبقى
            حتى تخرج منها أو تبطلها من هنا.
          </p>
          <div data-v2-table></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host
 * @param {{confirmFn?: (message:string)=>boolean,
 *          notify?: (message:string, kind?:string)=>void,
 *          onCurrentRevoked?: ()=>void}} [ctx]
 */
export function mountSessionsScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 sessions]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);

    let rows = [];
    let currentSessionId = null;
    let loading = false;
    let saving = false;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const countEl = q('[data-v2-count]');
    const othersBtn = q('[data-v2-revoke-others]');

    const table = createDataTable({
        caption: 'جلسات هذا الحساب',
        mode: 'client',
        pageSize: 25,
        stickyHeader: true,
        emptyMessage: 'لا توجد جلسات نشطة',
        emptyHint: 'ستظهر هنا كل أجهزة هذا الحساب بمجرد دخولها.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'device',
                header: 'الجهاز',
                sortable: true,
                filterable: true,
                value: (row) => row.device,
                render: (row) => `<span class="erp-row-wrap">
                    ${row.current ? statusBadge('session', 'current', { title: 'الجهاز الذي تتصفح منه الآن' }) : ''}
                    <span>${esc(row.device)}</span>
                  </span>`,
            },
            {
                key: 'ip',
                header: 'عنوان IP',
                width: '150px',
                className: 'erp-addr',
                value: (row) => row.ip || '',
                render: (row) => (row.ip ? esc(row.ip) : '<span class="erp-text-faint">—</span>'),
            },
            {
                key: 'started_at',
                header: 'بدأت',
                sortable: true,
                width: '160px',
                className: 'erp-addr',
                value: (row) => row.started_at || '',
                render: (row) => esc(formatMoment(row.started_at)),
            },
            {
                key: 'last_seen_at',
                header: 'آخر نشاط',
                sortable: true,
                width: '160px',
                className: 'erp-addr',
                value: (row) => row.last_seen_at || '',
                render: (row) => esc(formatMoment(row.last_seen_at)),
            },
            {
                key: 'expires_at',
                header: 'تنتهي',
                sortable: true,
                width: '160px',
                className: 'erp-addr',
                hidden: true,
                value: (row) => row.expires_at || '',
                render: (row) => esc(formatMoment(row.expires_at)),
            },
            {
                key: 'actions',
                header: 'إجراءات',
                width: '140px',
                align: 'end',
                value: () => '',
                render: (row) => `<button type="button" class="erp-btn erp-btn--sm"
                    data-v2-act="revoke" data-id="${esc(row.id)}"
                    data-current="${row.current ? '1' : '0'}"
                    data-device="${esc(row.device)}">
                    <i class="ji" data-i="log-out" aria-hidden="true"></i><span>إنهاء</span>
                  </button>`,
            },
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    function syncOthersButton() {
        if (!othersBtn) {return;}
        othersBtn.disabled = saving || loading || rows.length < 2;
        othersBtn.setAttribute('aria-disabled', othersBtn.disabled ? 'true' : 'false');
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        syncOthersButton();
        table.setLoading(true);
        try {
            const result = await fetchSessions();
            if (!el.isConnected) {return;}
            rows = result.sessions;
            currentSessionId = result.currentSessionId;
            table.setRows(rows);
            countEl.textContent = `(${rows.length})`;
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = [];
            table.setRows([]);
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — أعد تحميل الصفحة بعد تسجيل الدخول.'
                : `تعذّر تحميل الجلسات: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading = false;
            syncOthersButton();
        }
    }

    async function revokeOne(id, isCurrent, device) {
        if (saving || !id) {return;}
        const question = isCurrent
            ? 'إنهاء الجلسة الحالية؟ سيُطلب منك تسجيل الدخول من جديد على هذا الجهاز.'
            : `إنهاء جلسة «${device}»؟ لن يستطيع تجديد رمزه بعد الآن.`;
        if (!confirmFn(question)) {return;}
        saving = true;
        syncOthersButton();
        try {
            await revokeSession(id);
            if (isCurrent) {
                notify('أُنهيت الجلسة الحالية.');
                if (typeof ctx.onCurrentRevoked === 'function') {ctx.onCurrentRevoked();}
                return;
            }
            notify(`أُنهيت جلسة «${device}».`);
            await reload();
        } catch (e) {
            notify(`تعذّر إنهاء الجلسة: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
            syncOthersButton();
        }
    }

    async function revokeOthers() {
        if (saving || loading) {return;}
        const otherCount = rows.filter((row) => !row.current).length;
        if (!otherCount) {return;}
        if (!confirmFn(`إبطال ${otherCount} جلسة أخرى؟ الجلسة الحالية فقط ستبقى.`)) {return;}
        saving = true;
        syncOthersButton();
        try {
            const result = await revokeOtherSessions();
            notify((result && result.message) || 'أُبطلت الجلسات الأخرى.');
            await reload();
        } catch (e) {
            notify(`تعذّر إبطال الجلسات: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
            syncOthersButton();
        }
    }

    table.el.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-v2-act="revoke"]');
        if (btn) {
            if (btn.disabled) {return;}
            revokeOne(btn.dataset.id, btn.dataset.current === '1', btn.dataset.device || '');
            return;
        }
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-revoke-others]')) {revokeOthers();}
    });

    reload();

    return {
        el,
        reload,
        getRows: () => rows,
        getCurrentSessionId: () => currentSessionId,
        destroy() {
            table.destroy();
            el.remove();
        },
    };
}
