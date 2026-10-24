/**
 * V2 — Login screen · Gate C (الدخول الحقيقي)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE LEGACY LOGIN, NOT INVENTED
 *   POST {origin}/api/auth/login { username, password }
 *     (features/auth-navigation.js:131-136 — raw fetch, NOT apiFetch)
 *   → { access_token, app_key?, refresh_token?, user:{id,username,role,name,
 *       dept_code?}, password_change_required? }
 *   → !ok or no access_token: { error, message } shown verbatim through
 *     SERVER_CODE_AR (core/api.js) with a fixed fallback — never a paraphrase.
 *   Session semantics mirror doLogin exactly: access token in memory only
 *   (window._jwt), app key in memory (window._appKey), refresh token in
 *   localStorage['karim_rt_v1'] via KARIM_RTset (the owner's permanent-
 *   session decision). 15s AbortController timeout, same message.
 *
 * WHY RAW fetch AND NOT apiFetch
 *   apiFetch on 401 wipes the stored refresh token (KARIM_RTclear,
 *   core/api.js:44-48). A mistyped password answered 401 would destroy a
 *   healthy production session. doLogin uses raw fetch for the same reason.
 *
 * SECURITY RULES (security-hardening)
 *   • The password lives in one local variable + the input element. It is
 *     never logged, never stored, never interpolated into any message, and
 *     the field is cleared on success and on destroy.
 *   • On failure the value stays for correction (legacy behaviour) — the
 *     error region carries no credential fragment, only server text.
 *   • password_change_required is a BOUNDARY, not a flow: rotation stays in
 *     the legacy app. V2 states it and links there; it never touches the
 *     rotation endpoint.
 *   • Resume ("استئناف الجلسة المحفوظة") spends the shared refresh token
 *     only on an explicit click — the same explicitness ?live=1 requires.
 *   • No inline handlers (CSP nonce makes 'unsafe-inline' inert).
 */

import { API_BASE, SERVER_CODE_AR } from '../../core/api.js?v=4.9.152';
import { installApiFetchBridge, ensureSession, readRefreshToken } from '../session.js?v=4.9.152';
import { resetPassword } from '../data/shell-repo.js?v=4.9.152';

const LOGIN_TIMEOUT_MS = 15000;

/** Server error → Arabic sentence. Pure and exported for tests. */
export function serverMessage(data, fallback) {
    if (data && typeof data === 'object') {
        if (typeof data.error === 'string' && SERVER_CODE_AR[data.error]) {
            return SERVER_CODE_AR[data.error];
        }
        if (typeof data.message === 'string' && data.message.trim()) {return data.message.trim();}
    }
    return fallback;
}

function template(canResume) {
    return `
      <div class="erp-login-wrap">
        <section class="erp-card erp-login-card" aria-labelledby="v2login-title">
          <header class="erp-login-hero">
            <span class="erp-login-hero__eyebrow" dir="ltr" lang="en">AL SHURFA · ENTERPRISE</span>
            <div class="erp-login-brand">
              <img class="erp-login-logo" src="assets/al-shurfa-logo.png" alt="مطاعم الشرفة العالمي">
            </div>
            <h2 class="erp-login-title" id="v2login-title">تسجيل الدخول
              <span class="erp-eyebrow" dir="ltr" lang="en">Sign In</span>
            </h2>
            <p class="erp-login-hero__note">أدخل بيانات حسابك للوصول إلى مساحة العمل.</p>
          </header>
          <div class="erp-card__body erp-stack">
            <div data-v2-pane="password">
            <form data-v2-login-form novalidate>
              <div class="erp-field">
                <label class="erp-label" for="v2login-user">اسم المستخدم
                  <span class="erp-eyebrow" dir="ltr" lang="en">Username</span></label>
                <input class="erp-input erp-input--ltr" id="v2login-user" name="username"
                       type="text" autocomplete="username" dir="ltr" required>
              </div>
              <div class="erp-field">
                <label class="erp-label" for="v2login-pass">كلمة المرور
                  <span class="erp-eyebrow" dir="ltr" lang="en">Password</span></label>
                <div class="erp-login-passrow">
                  <input class="erp-input erp-input--ltr" id="v2login-pass" name="password"
                         type="password" autocomplete="current-password" dir="ltr" required>
                  <button type="button" class="erp-btn erp-btn--sm" data-v2-showpass
                          aria-pressed="false" aria-label="إظهار كلمة المرور">إظهار</button>
                </div>
                <p class="erp-text-xs erp-text-muted" data-v2-caps hidden>⚠ زر Caps Lock مفعّل</p>
              </div>
              <div class="erp-error" data-v2-login-error role="alert"></div>
              <button type="submit" class="erp-btn erp-btn--primary erp-login-submit" data-v2-submit>
                <i class="ji" data-i="lock" aria-hidden="true"></i><span>دخول</span>
              </button>
            </form>
            <p class="erp-text-sm erp-login-center">
              <button type="button" class="erp-link" data-v2-forgot>نسيت كلمة المرور؟</button>
            </p>
            <div data-v2-forgot-panel hidden>
              <p class="erp-text-sm erp-text-muted">أدخل اسم المستخدم، ثم اطلب من المدير رمز استعادة من 6 أرقام (صالح 10 دقائق)، وأدخل الرمز مع كلمة المرور الجديدة.</p>
              <div class="erp-field">
                <label class="erp-label" for="v2fp-user">اسم المستخدم</label>
                <input class="erp-input erp-input--ltr" id="v2fp-user" data-v2-fp="user" type="text" autocomplete="username" dir="ltr">
              </div>
              <div class="erp-field">
                <label class="erp-label" for="v2fp-code">رمز الاستعادة (6 أرقام)</label>
                <input class="erp-input erp-input--ltr" id="v2fp-code" data-v2-fp="code" type="text" inputmode="numeric" maxlength="6" placeholder="______" dir="ltr">
              </div>
              <div class="erp-field">
                <label class="erp-label" for="v2fp-new">كلمة المرور الجديدة (12 حرفًا على الأقل مع حروف وأرقام)</label>
                <input class="erp-input erp-input--ltr" id="v2fp-new" data-v2-fp="new" type="password" autocomplete="new-password" dir="ltr">
              </div>
              <div class="erp-field">
                <label class="erp-label" for="v2fp-new2">تأكيد كلمة المرور الجديدة</label>
                <input class="erp-input erp-input--ltr" id="v2fp-new2" data-v2-fp="new2" type="password" autocomplete="new-password" dir="ltr">
              </div>
              <div class="erp-error" data-v2-fp-error role="alert"></div>
              <button type="button" class="erp-btn erp-btn--primary" data-v2-fp-go>
                <i class="ji" data-i="key" aria-hidden="true"></i><span>تغيير كلمة المرور</span>
              </button>
            </div>
            ${canResume ? `
            <div class="erp-login-sep" aria-hidden="true"><span>أو</span></div>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-resume>
              <i class="ji" data-i="refresh" aria-hidden="true"></i>
              <span>استئناف الجلسة المحفوظة على هذا الجهاز</span>
            </button>` : ''}
            </div>

            <div data-v2-mfa-pane hidden>
              <div class="erp-login-mfa-head">
                <span class="erp-login-mfa-badge" aria-hidden="true">
                  <i class="ji" data-i="shield-check"></i>
                </span>
                <div>
                  <h3 class="erp-login-mfa-title">التحقق بخطوتين
                    <span class="erp-eyebrow" dir="ltr" lang="en">Two-Factor</span>
                  </h3>
                  <p class="erp-text-sm erp-text-muted" data-v2-mfa-lede>
                    أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.
                  </p>
                </div>
              </div>

              <div data-v2-mfa-step="verify">
                <div class="erp-field">
                  <label class="erp-label" for="v2mfa-code">رمز المصادقة
                    <span class="erp-eyebrow" dir="ltr" lang="en">6-digit code</span></label>
                  <input class="erp-input erp-input--ltr erp-login-code" id="v2mfa-code"
                         inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                         placeholder="••••••" dir="ltr">
                </div>
                <div class="erp-field" data-v2-mfa-recovery hidden>
                  <label class="erp-label" for="v2mfa-recovery-code">رمز الاسترداد</label>
                  <input class="erp-input erp-input--ltr" id="v2mfa-recovery-code"
                         type="text" autocomplete="off" spellcheck="false"
                         placeholder="XXXXX-XXXXX" dir="ltr">
                  <p class="erp-text-xs erp-text-muted">كل رمز يعمل مرة واحدة فقط.</p>
                </div>
                <div class="erp-error" data-v2-mfa-error role="alert"></div>
                <button type="button" class="erp-btn erp-btn--primary erp-login-submit" data-v2-mfa-verify>
                  <span>تحقق ودخول</span>
                </button>
                <p class="erp-text-sm erp-login-center">
                  <button type="button" class="erp-link" data-v2-mfa-recovery-toggle>أستخدم رمز استرداد</button>
                </p>
                <p class="erp-text-sm erp-login-center">
                  <button type="button" class="erp-link" data-v2-mfa-back>رجوع لتسجيل الدخول</button>
                </p>
              </div>

              <div data-v2-mfa-step="enroll" hidden>
                <p class="erp-text-sm erp-text-muted">
                  امسح الرمز بتطبيق مصادقة (Google Authenticator أو Microsoft Authenticator)،
                  ثم أدخل الرمز الظاهر لتفعيل الحماية.
                </p>
                <div class="erp-login-qr">
                  <img data-v2-mfa-qr alt="رمز QR لتسجيل المصادقة الثنائية" width="240" height="240" hidden>
                  <span class="erp-login-qr__loading" data-v2-mfa-qr-loading>جارٍ تجهيز رمز QR…</span>
                </div>
                <details class="erp-login-manual">
                  <summary>إدخال المفتاح يدويًا</summary>
                  <code data-v2-mfa-secret dir="ltr"></code>
                </details>
                <div class="erp-field">
                  <label class="erp-label" for="v2mfa-enroll-code">الرمز الظاهر في التطبيق</label>
                  <input class="erp-input erp-input--ltr erp-login-code" id="v2mfa-enroll-code"
                         inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                         placeholder="••••••" dir="ltr">
                </div>
                <div class="erp-error" data-v2-mfa-enroll-error role="alert"></div>
                <button type="button" class="erp-btn erp-btn--primary erp-login-submit" data-v2-mfa-confirm>
                  <span>تفعيل ودخول</span>
                </button>
                <p class="erp-text-sm erp-login-center">
                  <button type="button" class="erp-link" data-v2-mfa-back>رجوع لتسجيل الدخول</button>
                </p>
              </div>

              <div data-v2-mfa-step="codes" hidden>
                <p class="erp-text-sm erp-text-muted">
                  احفظ رموز الاسترداد هذه في مكان آمن. كل رمز يعمل مرة واحدة، وهي
                  طريقك للدخول إذا فقدت هاتفك. لن تُعرض مرة أخرى.
                </p>
                <ol class="erp-login-codes" data-v2-mfa-codes dir="ltr"></ol>
                <button type="button" class="erp-btn erp-btn--sm" data-v2-mfa-copy>نسخ الرموز</button>
                <button type="button" class="erp-btn erp-btn--primary erp-login-submit" data-v2-mfa-done>
                  <span>تم الحفظ — دخول</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{ onSuccess?: (session:{role:string|null,user:any})=>void }} [ctx]
 * @returns {{el: HTMLElement, destroy: ()=>void}}
 */
export function mountLoginScreen(host, ctx = {}) {
    installApiFetchBridge();
    const canResume = !!readRefreshToken();

    host.insertAdjacentHTML('beforeend', template(canResume));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const form = q('[data-v2-login-form]');
    const userInput = q('#v2login-user');
    const passInput = q('#v2login-pass');
    const errBox = q('[data-v2-login-error]');
    const submitBtn = q('[data-v2-submit]');
    const capsHint = q('[data-v2-caps]');
    let busy = false;

    function fail(message) {
        errBox.textContent = message;
    }

    function setBusy(on) {
        busy = on;
        submitBtn.disabled = on;
        if (on) {submitBtn.setAttribute('aria-busy', 'true');}
        else {submitBtn.removeAttribute('aria-busy');}
        const label = submitBtn.querySelector('span');
        if (label) {label.textContent = on ? 'جارٍ التحقق…' : 'دخول';}
    }

    // ── MFA (التحقق بخطوتين) ─────────────────────────────────────────────
    // كلمة المرور وحدها لم تعد تُدخل: الخادم يعيد تذكرة قصيرة العمر، وهذه
    // الشاشة تُكمل العامل الثاني ثم تسلّم الجلسة الكاملة لـ publishAndEnter.
    const passwordPane = q('[data-v2-pane="password"]');
    const mfaPane = q('[data-v2-mfa-pane]');
    const mfaLede = q('[data-v2-mfa-lede]');
    const mfaCodeInput = q('#v2mfa-code');
    const mfaRecoveryField = q('[data-v2-mfa-recovery]');
    const mfaRecoveryInput = q('#v2mfa-recovery-code');
    const mfaError = q('[data-v2-mfa-error]');
    const enrollCodeInput = q('#v2mfa-enroll-code');
    const enrollError = q('[data-v2-mfa-enroll-error]');
    const qrImg = q('[data-v2-mfa-qr]');
    const qrLoading = q('[data-v2-mfa-qr-loading]');
    const secretEl = q('[data-v2-mfa-secret]');
    const codesList = q('[data-v2-mfa-codes]');
    const stepBlocks = {
        verify: q('[data-v2-mfa-step="verify"]'),
        enroll: q('[data-v2-mfa-step="enroll"]'),
        codes: q('[data-v2-mfa-step="codes"]'),
    };
    const mfaButtons = [q('[data-v2-mfa-verify]'), q('[data-v2-mfa-confirm]')].filter(Boolean);
    let mfaToken = null;
    let recoveryMode = false;
    let pendingSession = null;
    let recoveryCodes = [];

    function focusQuiet(node) {
        if (!node) {return;}
        try { node.focus({ preventScroll: true }); } catch { try { node.focus(); } catch { /* headless */ } }
    }

    function showMfaStep(step) {
        Object.entries(stepBlocks).forEach(([name, block]) => {
            if (block) {block.hidden = name !== step;}
        });
        mfaPane.hidden = false;
    }

    function enterMfa(step, lede) {
        passwordPane.hidden = true;
        mfaError.textContent = '';
        enrollError.textContent = '';
        if (lede) {mfaLede.textContent = lede;}
        showMfaStep(step);
        focusQuiet(step === 'enroll' ? enrollCodeInput : mfaCodeInput);
    }

    function backToPassword(message) {
        mfaToken = null;
        pendingSession = null;
        recoveryCodes = [];
        recoveryMode = false;
        mfaCodeInput.value = '';
        mfaRecoveryInput.value = '';
        enrollCodeInput.value = '';
        mfaError.textContent = '';
        enrollError.textContent = '';
        mfaRecoveryField.hidden = true;
        mfaPane.hidden = true;
        passwordPane.hidden = false;
        if (message) {fail(message);}
        focusQuiet(passInput);
    }

    function setMfaBusy(on) {
        busy = on;
        mfaButtons.forEach((btn) => {btn.disabled = on;});
        if (on) {mfaPane.setAttribute('aria-busy', 'true');}
        else {mfaPane.removeAttribute('aria-busy');}
    }

    async function mfaPost(path, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
        try {
            const res = await fetch(`${API_BASE}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Authorization: `Bearer ${mfaToken}`,
                },
                body: JSON.stringify(body || {}),
                signal: controller.signal,
            });
            const data = await res.json().catch(() => ({}));
            return { res, data };
        } finally {
            clearTimeout(timer);
        }
    }

    function mfaNetworkError(e) {
        return e && e.name === 'AbortError'
            ? 'انتهت مهلة الاتصال بالخادم — حاول مجددًا'
            : 'تعذّر الوصول إلى الخادم — تحقق من اتصال الإنترنت';
    }

    function ticketExpired(data) {
        return Boolean(data && (data.error === 'MFA_TICKET_EXPIRED' || data.error === 'TOKEN_INVALID'));
    }

    async function beginEnrollment() {
        qrImg.hidden = true;
        qrLoading.hidden = false;
        qrLoading.textContent = 'جارٍ تجهيز رمز QR…';
        secretEl.textContent = '';
        try {
            const { res, data } = await mfaPost('/auth/mfa/setup', {});
            if (!res.ok || !data.secret) {
                enrollError.textContent = serverMessage(data, 'تعذر بدء تسجيل المصادقة الثنائية — حاول مجددًا');
                qrLoading.textContent = 'تعذّر تجهيز التسجيل — ارجع وأعد المحاولة.';
                return;
            }
            if (data.qr_data_url) {
                qrImg.src = data.qr_data_url;
                qrImg.hidden = false;
                qrLoading.hidden = true;
            } else {
                qrLoading.textContent = 'تعذّر رسم رمز QR — استخدم المفتاح اليدوي أدناه.';
            }
            secretEl.textContent = data.secret;
            focusQuiet(enrollCodeInput);
        } catch (e) {
            enrollError.textContent = mfaNetworkError(e);
        }
    }

    async function submitMfaCode() {
        if (busy) {return;}
        const code = mfaCodeInput.value.trim();
        const recovery = mfaRecoveryInput.value.trim();
        if (recoveryMode ? !recovery : !/^\d{6}$/.test(code)) {
            mfaError.textContent = recoveryMode ? 'أدخل رمز الاسترداد كما ظهر عند التسجيل' : 'الرمز مكوّن من 6 أرقام';
            focusQuiet(recoveryMode ? mfaRecoveryInput : mfaCodeInput);
            return;
        }
        setMfaBusy(true);
        mfaError.textContent = '';
        try {
            const { res, data } = await mfaPost('/auth/mfa/verify',
                recoveryMode ? { recovery_code: recovery } : { code });
            if (!res.ok || !data.access_token) {
                if (ticketExpired(data)) {
                    backToPassword('انتهت مهلة التحقق — أعد إدخال كلمة المرور.');
                    return;
                }
                mfaError.textContent = serverMessage(data, 'تعذر التحقق من الرمز — حاول مجددًا');
                if (el.isConnected) {focusQuiet(recoveryMode ? mfaRecoveryInput : mfaCodeInput);}
                return;
            }
            publishAndEnter(data);
        } catch (e) {
            mfaError.textContent = mfaNetworkError(e);
        } finally {
            if (el.isConnected) {setMfaBusy(false);}
            else {busy = false;}
        }
    }

    async function submitEnrollment() {
        if (busy) {return;}
        const code = enrollCodeInput.value.trim();
        if (!/^\d{6}$/.test(code)) {
            enrollError.textContent = 'أدخل الرمز الظاهر في التطبيق (6 أرقام)';
            focusQuiet(enrollCodeInput);
            return;
        }
        setMfaBusy(true);
        enrollError.textContent = '';
        try {
            const { res, data } = await mfaPost('/auth/mfa/confirm', { code });
            if (!res.ok || !data.access_token) {
                if (ticketExpired(data)) {
                    backToPassword('انتهت مهلة التسجيل — أعد إدخال كلمة المرور.');
                    return;
                }
                enrollError.textContent = serverMessage(data, 'تعذر تأكيد الرمز — تحقق من ساعة الجهاز وحاول مجددًا');
                return;
            }
            pendingSession = data;
            renderRecoveryCodes(data.recovery_codes || []);
            showMfaStep('codes');
        } catch (e) {
            enrollError.textContent = mfaNetworkError(e);
        } finally {
            if (el.isConnected) {setMfaBusy(false);}
            else {busy = false;}
        }
    }

    function renderRecoveryCodes(codes) {
        recoveryCodes = Array.isArray(codes) ? codes.slice() : [];
        codesList.replaceChildren();
        recoveryCodes.forEach((entry) => {
            const li = document.createElement('li');
            li.textContent = entry;
            codesList.append(li);
        });
    }

    function publishAndEnter(payload) {
        if (payload.access_token) {window._jwt = payload.access_token;}
        if (payload.app_key) {window._appKey = payload.app_key;}
        try {
            if (payload.refresh_token && typeof window.KARIM_RTset === 'function') {
                window.KARIM_RTset(payload.refresh_token);
            }
        } catch { /* storage blocked — memory session still valid */ }
        const user = payload.user && typeof payload.user === 'object' ? payload.user : {};
        // The credential has served its purpose — drop it now, not on unload.
        passInput.value = '';
        if (typeof ctx.onSuccess === 'function') {
            ctx.onSuccess({ role: user.role || null, user });
        }
    }

    async function doSubmit(event) {
        event.preventDefault();
        if (busy) {return;}
        const username = userInput.value.trim();
        const password = passInput.value;
        if (!username || !password) {
            fail('أدخل اسم المستخدم وكلمة المرور');
            ((!username ? userInput : passInput)).focus();
            return;
        }
        setBusy(true);
        fail('');
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
            let res;
            try {
                res = await fetch(`${API_BASE}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ username, password }),
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timer);
            }
            const data = await res.json().catch(() => ({}));
            // كلمة المرور صحيحة ⇢ عامل ثانٍ مطلوب. التذكرة قصيرة العمر ولا
            // تفتح أي واجهة برمجية أخرى — الجلسة تُصدر من خطوة التحقق فقط.
            if (data && data.mfa_required && data.mfa_token) {
                mfaToken = data.mfa_token;
                passInput.value = '';
                enterMfa('verify', data.message);
                return;
            }
            if (data && data.mfa_enrollment_required && data.mfa_token) {
                mfaToken = data.mfa_token;
                passInput.value = '';
                enterMfa('enroll', data.message);
                beginEnrollment();
                return;
            }
            if (data && data.password_change_required && data.access_token) {
                fail('');
                errBox.innerHTML = '';
                const link = document.createElement('a');
                link.href = 'index.html';
                link.textContent = 'فتح النظام الحالي لإتمام تغيير كلمة المرور';
                errBox.append('تغيير كلمة المرور مطلوب قبل الدخول — يُتم من النظام الحالي فقط. ');
                errBox.append(link);
                return;
            }
            if (!res.ok || !data.access_token) {
                fail(serverMessage(data, 'بيانات تسجيل الدخول غير صحيحة'));
                passInput.focus();
                try { passInput.setSelectionRange(passInput.value.length, passInput.value.length); } catch { /* older engines */ }
                return;
            }
            publishAndEnter(data);
        } catch (e) {
            // Network-level failure (DNS/TCP/TLS/reset, or a tunnel flap):
            // guide action instead of a dead-end sentence. Manual retry only —
            // no auto-retry on auth calls (each attempt is a counted event).
            if (e && e.name === 'AbortError') {
                fail('انتهت مهلة الاتصال بالخادم (15 ثانية) — تحقق من الإنترنت وحاول مجددًا');
                return;
            }
            // The POST never completed. Ask one cheap question before
            // concluding: can this device GET anything from the API host?
            // GET-ok + POST-dead = something on the device/path kills the
            // login request itself (extension, VPN, proxy browser, DPI).
            // GET-dead too = the device has no route to the server at all.
            let apiReachable;
            try {
                const probe = new AbortController();
                const probeTimer = setTimeout(() => probe.abort(), 8000);
                const health = await fetch(`${API_BASE}/health`, {
                    headers: { Accept: 'application/json' },
                    signal: probe.signal,
                }).finally(() => clearTimeout(probeTimer));
                apiReachable = !!health.ok;
            } catch { apiReachable = false; }
            fail(apiReachable
                ? 'الاتصال بالخادم سليم لكن طلب الدخول لم يصل — جرّب متصفحًا آخر، أو أوقف الـVPN/مانع الإعلانات وشبكة التوفير ثم حاول مجددًا'
                : 'تعذّر الوصول إلى الخادم من هذا الجهاز — تحقق من اتصال الإنترنت ثم اضغط دخول مجددًا');
        } finally {
            if (el.isConnected) {setBusy(false);}
            else {busy = false;}
        }
    }

    async function doResume() {
        if (busy) {return;}
        setBusy(true);
        fail('');
        try {
            const session = await ensureSession({ rotate: true });
            if (!session) {
                fail('لا جلسة صالحة على هذا الجهاز — سجّل الدخول بالاسم وكلمة المرور.');
                return;
            }
            if (typeof ctx.onSuccess === 'function') {ctx.onSuccess(session);}
        } finally {
            if (el.isConnected) {setBusy(false);}
            else {busy = false;}
        }
    }

    form.addEventListener('submit', doSubmit);
    q('[data-v2-resume]')?.addEventListener('click', doResume);
    q('[data-v2-forgot]')?.addEventListener('click', () => {
        const panel = q('[data-v2-forgot-panel]');
        if (!panel) {return;}
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {q('[data-v2-fp="user"]')?.focus();}
    });
    q('[data-v2-fp-go]')?.addEventListener('click', async () => {
        if (busy) {return;}
        const errBox = q('[data-v2-fp-error]');
        const v = (n) => q(`[data-v2-fp="${n}"]`)?.value ?? '';
        const username = v('user').trim();
        const code = v('code').trim();
        const np = v('new');
        const np2 = v('new2');
        const fpFail = (m) => {errBox.textContent = m;};
        if (!username || !code || !np) {fpFail('أكمل اسم المستخدم والرمز وكلمة المرور الجديدة'); return;}
        if (!/^\d{6}$/.test(code)) {fpFail('الرمز يتكون من 6 أرقام'); return;}
        if (np !== np2) {fpFail('كلمتا المرور غير متطابقتين'); return;}
        if (np.length < 12 || !/[A-Za-z]/.test(np) || !/\d/.test(np)) {fpFail('الجديدة ضعيفة: 12 حرفًا على الأقل مع حرف ورقم'); return;}
        setBusy(true);
        fpFail('');
        try {
            await resetPassword({ username, code, new_password: np });
            q('[data-v2-fp="new"]').value = '';
            q('[data-v2-fp="new2"]').value = '';
            q('[data-v2-fp="code"]').value = '';
            fail('تم تغيير كلمة المرور بنجاح — سجّل الدخول بكلمة المرور الجديدة');
        } catch (e) {
            fpFail((e && e.message) || 'تعذر الاتصال بالخادم — حاول مرة أخرى');
        } finally {
            if (el.isConnected) {setBusy(false);}
            else {busy = false;}
        }
    });
    q('[data-v2-showpass]')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const show = passInput.type === 'password';
        passInput.type = show ? 'text' : 'password';
        btn.textContent = show ? 'إخفاء' : 'إظهار';
        btn.setAttribute('aria-pressed', String(show));
        btn.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    });
    passInput.addEventListener('keyup', (e) => {
        let on = false;
        try { on = !!(e.getModifierState && e.getModifierState('CapsLock')); } catch { /* unsupported */ }
        capsHint.hidden = !on;
    });

    q('[data-v2-mfa-verify]')?.addEventListener('click', submitMfaCode);
    q('[data-v2-mfa-confirm]')?.addEventListener('click', submitEnrollment);
    mfaCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {e.preventDefault(); submitMfaCode();}
    });
    enrollCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {e.preventDefault(); submitEnrollment();}
    });
    q('[data-v2-mfa-recovery-toggle]')?.addEventListener('click', (e) => {
        recoveryMode = !recoveryMode;
        mfaRecoveryField.hidden = !recoveryMode;
        mfaCodeInput.closest('.erp-field').hidden = recoveryMode;
        mfaError.textContent = '';
        e.currentTarget.textContent = recoveryMode ? 'استخدام رمز التطبيق' : 'أستخدم رمز استرداد';
        focusQuiet(recoveryMode ? mfaRecoveryInput : mfaCodeInput);
    });
    el.querySelectorAll('[data-v2-mfa-back]').forEach((btn) => {
        btn.addEventListener('click', () => backToPassword(''));
    });
    q('[data-v2-mfa-copy]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const text = recoveryCodes.join('\n');
        try {
            await navigator.clipboard.writeText(text);
            btn.textContent = 'تم النسخ';
        } catch {
            // Clipboard blocked (insecure origin/permission): select the list
            // so the user can copy it without hunting for the button again.
            try {
                const range = document.createRange();
                range.selectNodeContents(codesList);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            } catch { /* older engines */ }
            btn.textContent = 'حدّدت الرموز — انسخها الآن';
        }
    });
    q('[data-v2-mfa-done]')?.addEventListener('click', () => {
        if (pendingSession) {publishAndEnter(pendingSession);}
    });

    try { userInput.focus({ preventScroll: true }); } catch { try { userInput.focus(); } catch { /* headless */ } }

    return {
        el,
        destroy() {
            try { passInput.value = ''; } catch { /* already detached */ }
            try {
                mfaCodeInput.value = '';
                mfaRecoveryInput.value = '';
                enrollCodeInput.value = '';
                codesList.replaceChildren();
            } catch { /* already detached */ }
            mfaToken = null;
            pendingSession = null;
            recoveryCodes = [];
            el.remove();
        },
    };
}
