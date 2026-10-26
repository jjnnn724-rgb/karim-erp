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
 *
 * PASSKEYS (مفاتيح المرور) live on the same screen because they answer the
 * same question — "what can get into this account, and how do I cut it off?".
 * A passkey is the second factor for users who chose biometrics over a TOTP
 * code. Registration and removal require the password again: a stolen
 * session must not be able to add a permanent key or to weaken the account.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.180';
import { statusBadge } from '../status.js?v=4.9.180';
import {
    fetchSessions,
    revokeSession,
    revokeOtherSessions,
    formatMoment,
} from '../data/sessions-repo.js?v=4.9.180';
import {
    fetchPasskeys,
    registerPasskey,
    removePasskey,
    passkeySupport,
    defaultDeviceLabel,
} from '../data/passkeys-repo.js?v=4.9.180';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function template() {
    return `
      <div class="erp-stack" data-v2-sessions-wrap>
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
      </section>

      <section class="erp-card erp-v2-passkeys" aria-labelledby="v2passkeys-title">
        <div class="erp-card__head">
          <h3 class="erp-card__title" id="v2passkeys-title">مفاتيح المرور (بصمة / Face ID)
            <span class="erp-text-muted erp-text-sm" data-v2-passkey-count></span>
          </h3>
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-passkey-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted">
            بعد تسجيل جهاز يصبح الدخول منه بالبصمة أو Face ID بدل رمز التطبيق —
            بعد كلمة المرور. التسجيل والحذف يتطلبان كلمة المرور: جلسة مسروقة
            وحدها لا تغيّر شكل الحماية.
          </p>
          <p class="erp-text-sm erp-text-muted" data-v2-passkey-unsupported hidden></p>
          <ul class="erp-passkey-list" data-v2-passkey-list></ul>

          <div class="erp-passkey-add erp-stack" data-v2-passkey-add>
            <p class="erp-text-sm">
              <i class="ji" data-i="fingerprint" aria-hidden="true"></i>
              سجّل هذا الجهاز — سيطلب المتصفح تأكيد بصمتك أو Face ID.
            </p>
            <div class="erp-passkey-grid">
              <div class="erp-field">
                <label class="erp-label" for="v2pk-label">اسم الجهاز</label>
                <input class="erp-input" id="v2pk-label" data-v2-pk="label" type="text"
                       maxlength="60" autocomplete="off" placeholder="مثال: هاتف المدير">
              </div>
              <div class="erp-field">
                <label class="erp-label" for="v2pk-pass">كلمة المرور (للتأكيد)</label>
                <input class="erp-input erp-input--ltr" id="v2pk-pass" data-v2-pk="password"
                       type="password" autocomplete="current-password" dir="ltr">
              </div>
            </div>
            <div class="erp-error" data-v2-passkey-error role="alert"></div>
            <button type="button" class="erp-btn erp-btn--primary" data-v2-passkey-add-go>
              <i class="ji" data-i="fingerprint" aria-hidden="true"></i><span>تسجيل هذا الجهاز</span>
            </button>
          </div>

          <div data-v2-passkey-remove-panel hidden>
            <p class="erp-text-sm">حذف «<strong data-v2-passkey-target></strong>» — أدخل كلمة المرور للتأكيد.</p>
            <div class="erp-field">
              <label class="erp-label" for="v2pk-remove-pass">كلمة المرور</label>
              <input class="erp-input erp-input--ltr" id="v2pk-remove-pass" data-v2-passkey-remove-pass
                     type="password" autocomplete="current-password" dir="ltr">
            </div>
            <div class="erp-error" data-v2-passkey-remove-error role="alert"></div>
            <div class="erp-row-wrap">
              <button type="button" class="erp-btn erp-btn--danger" data-v2-passkey-remove-go>
                <i class="ji" data-i="trash" aria-hidden="true"></i><span>تأكيد الحذف</span>
              </button>
              <button type="button" class="erp-btn erp-btn--ghost" data-v2-passkey-remove-cancel>إلغاء</button>
            </div>
          </div>
        </div>
      </section>
      </div>`;
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

    // ── مفاتيح المرور ────────────────────────────────────────────────────
    const mountSupport = passkeySupport();
    const passkeyList = q('[data-v2-passkey-list]');
    const passkeyCount = q('[data-v2-passkey-count]');
    const passkeyUnsupported = q('[data-v2-passkey-unsupported]');
    const passkeyAdd = q('[data-v2-passkey-add]');
    const passkeyAddBtn = q('[data-v2-passkey-add-go]');
    const passkeyError = q('[data-v2-passkey-error]');
    const passkeyRemovePanel = q('[data-v2-passkey-remove-panel]');
    const passkeyRemoveTarget = q('[data-v2-passkey-target]');
    const passkeyRemoveInput = q('[data-v2-passkey-remove-pass]');
    const passkeyRemoveError = q('[data-v2-passkey-remove-error]');
    const labelInput = q('[data-v2-pk="label"]');
    const passwordInput = q('[data-v2-pk="password"]');
    let passkeys = [];
    let passkeyBusy = false;
    let pendingRemoval = null;

    if (!mountSupport.supported) {
        passkeyUnsupported.hidden = false;
        passkeyUnsupported.textContent = mountSupport.reason;
        passkeyAdd.hidden = true;
    } else if (labelInput) {
        labelInput.placeholder = `مثال: ${defaultDeviceLabel()}`;
    }

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

    // ── مفاتيح المرور: قراءة، تسجيل، حذف ────────────────────────────────
    function passkeyMeta(row) {
        const parts = [row.backed_up ? 'قابل للمزامنة بين أجهزتك' : 'مرتبط بهذا الجهاز'];
        parts.push(row.last_used_at ? `آخر استخدام ${formatMoment(row.last_used_at)}` : 'لم يُستخدم بعد');
        parts.push(`أُضيف ${formatMoment(row.created_at)}`);
        return parts.join(' · ');
    }

    function syncPasskeyButtons() {
        const removeGo = q('[data-v2-passkey-remove-go]');
        const cancel = q('[data-v2-passkey-remove-cancel]');
        if (passkeyAddBtn) {
            passkeyAddBtn.disabled = passkeyBusy || !mountSupport.supported;
            passkeyAddBtn.setAttribute('aria-disabled', passkeyAddBtn.disabled ? 'true' : 'false');
        }
        if (removeGo) {removeGo.disabled = passkeyBusy;}
        if (cancel) {cancel.disabled = passkeyBusy;}
        passkeyList.querySelectorAll('[data-v2-passkey-remove]').forEach((btn) => {
            btn.disabled = passkeyBusy;
        });
    }

    function renderPasskeys() {
        passkeyList.replaceChildren();
        passkeyCount.textContent = passkeys.length ? `(${passkeys.length})` : '';
        if (!passkeys.length) {
            const empty = document.createElement('li');
            empty.className = 'erp-text-sm erp-text-muted';
            empty.textContent = mountSupport.supported
                ? 'لا يوجد جهاز مسجّل بعد — سجّل هذا الجهاز لتصبح البصمة عاملك الثاني.'
                : 'لا يوجد جهاز مسجّل، وهذا المتصفح لا يدعم التسجيل.';
            passkeyList.append(empty);
            syncPasskeyButtons();
            return;
        }
        passkeys.forEach((row) => {
            const li = document.createElement('li');
            li.className = 'erp-passkey-row';
            li.innerHTML = `
              <span class="erp-passkey-row__icon"><i class="ji" data-i="smartphone" aria-hidden="true"></i></span>
              <span class="erp-passkey-row__main">
                <span class="erp-passkey-row__label">${esc(row.label)}</span>
                <span class="erp-passkey-row__meta">${esc(passkeyMeta(row))}</span>
              </span>
              <span class="erp-passkey-row__actions">
                <button type="button" class="erp-btn erp-btn--ghost erp-btn--sm"
                        data-v2-passkey-remove="${esc(row.id)}">
                  <i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span>
                </button>
              </span>`;
            passkeyList.append(li);
        });
        syncPasskeyButtons();
    }

    async function loadPasskeys() {
        if (!mountSupport.supported) {renderPasskeys(); return;}
        passkeyError.textContent = '';
        try {
            const result = await fetchPasskeys();
            if (!el.isConnected) {return;}
            passkeys = result.credentials;
        } catch (e) {
            if (!el.isConnected) {return;}
            passkeys = [];
            passkeyError.textContent = e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — أعد تحميل الصفحة بعد تسجيل الدخول.'
                : `تعذّر تحميل الأجهزة المسجّلة: ${(e && e.message) || 'خطأ'}`;
        }
        renderPasskeys();
    }

    async function addPasskey() {
        if (passkeyBusy || !mountSupport.supported) {return;}
        const password = passwordInput.value;
        if (!password) {
            passkeyError.textContent = 'أدخل كلمة المرور لتأكيد تسجيل الجهاز';
            passwordInput.focus();
            return;
        }
        passkeyBusy = true;
        syncPasskeyButtons();
        passkeyError.textContent = '';
        try {
            const result = await registerPasskey({
                password,
                deviceLabel: labelInput.value.trim() || defaultDeviceLabel(),
            });
            passwordInput.value = '';
            labelInput.value = '';
            notify((result && result.message) || 'تم تسجيل الجهاز.');
            await loadPasskeys();
        } catch (e) {
            passkeyError.textContent = (e && e.message) || 'تعذّر تسجيل الجهاز — حاول مجددًا';
        } finally {
            passkeyBusy = false;
            syncPasskeyButtons();
        }
    }

    function openRemove(id) {
        const row = passkeys.find((entry) => String(entry.id) === String(id));
        if (!row) {return;}
        pendingRemoval = row;
        passkeyRemoveTarget.textContent = row.label;
        passkeyRemoveInput.value = '';
        passkeyRemoveError.textContent = '';
        passkeyRemovePanel.hidden = false;
        passkeyRemoveInput.focus();
    }

    function closeRemove() {
        pendingRemoval = null;
        passkeyRemovePanel.hidden = true;
        passkeyRemoveInput.value = '';
        passkeyRemoveError.textContent = '';
    }

    async function confirmRemove() {
        if (passkeyBusy || !pendingRemoval) {return;}
        if (!passkeyRemoveInput.value) {
            passkeyRemoveError.textContent = 'أدخل كلمة المرور لتأكيد الحذف';
            passkeyRemoveInput.focus();
            return;
        }
        passkeyBusy = true;
        syncPasskeyButtons();
        passkeyRemoveError.textContent = '';
        const target = pendingRemoval;
        try {
            const result = await removePasskey(target.id, passkeyRemoveInput.value);
            closeRemove();
            notify((result && result.message) || `حُذف «${target.label}».`);
            await loadPasskeys();
        } catch (e) {
            passkeyRemoveError.textContent = (e && e.message) || 'تعذّر حذف الجهاز — حاول مجددًا';
        } finally {
            passkeyBusy = false;
            syncPasskeyButtons();
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
        if (event.target.closest('[data-v2-revoke-others]')) {revokeOthers(); return;}
        if (event.target.closest('[data-v2-passkey-reload]')) {loadPasskeys(); return;}
        if (event.target.closest('[data-v2-passkey-add-go]')) {addPasskey(); return;}
        if (event.target.closest('[data-v2-passkey-remove-cancel]')) {closeRemove(); return;}
        if (event.target.closest('[data-v2-passkey-remove-go]')) {confirmRemove(); return;}
        const removeBtn = event.target.closest('[data-v2-passkey-remove]');
        if (removeBtn) {openRemove(removeBtn.getAttribute('data-v2-passkey-remove'));}
    });

    passwordInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {e.preventDefault(); addPasskey();}
    });
    passkeyRemoveInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {e.preventDefault(); confirmRemove();}
    });

    reload();
    loadPasskeys();

    return {
        el,
        reload,
        getRows: () => rows,
        getCurrentSessionId: () => currentSessionId,
        destroy() {
            try {
                passwordInput.value = '';
                passkeyRemoveInput.value = '';
            } catch { /* already detached */ }
            passkeys = [];
            pendingRemoval = null;
            table.destroy();
            el.remove();
        },
    };
}
