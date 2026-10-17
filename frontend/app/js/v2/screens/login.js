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

import { API_BASE, SERVER_CODE_AR } from '../../core/api.js?v=4.9.149';
import { installApiFetchBridge, ensureSession, readRefreshToken } from '../session.js?v=4.9.149';
import { resetPassword } from '../data/shell-repo.js?v=4.9.149';

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
          <div class="erp-card__body erp-stack">
            <div class="erp-login-brand" aria-hidden="true">
              <span class="erp-login-mark"><i class="ji" data-i="layout-dashboard"></i></span>
            </div>
            <h2 class="erp-login-title" id="v2login-title">تسجيل الدخول
              <span class="erp-eyebrow" dir="ltr" lang="en">Sign In</span>
            </h2>
            <p class="erp-text-sm erp-text-muted erp-login-center">جلسة حقيقية على نفس خادم النظام —
              لا حسابات تجريبية هنا.</p>
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
                <label class="erp-label" for="v2fp-new">كلمة المرور الجديدة (8 حروف على الأقل مع حروف وأرقام)</label>
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
        if (np.length < 8 || !/[A-Za-z]/.test(np) || !/\d/.test(np)) {fpFail('الجديدة ضعيفة: 8 حروف على الأقل مع حرف ورقم'); return;}
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

    try { userInput.focus({ preventScroll: true }); } catch { try { userInput.focus(); } catch { /* headless */ } }

    return {
        el,
        destroy() {
            try { passInput.value = ''; } catch { /* already detached */ }
            el.remove();
        },
    };
}
