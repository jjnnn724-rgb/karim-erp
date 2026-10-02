/**
 * login-boot.js — بديل خارجي للسكربتات الداخلية في index.html.
 * السبب: CSP الخادم (nonce لكل طلب) يحظر أي <script> داخلي في ملف ثابت —
 * كانت 3 كتل محظورة: جامِع الأخطاء، زر العين، تحذير CapsLock، تسجيل الـ SW.
 * ملف خارجي = يعمل تحت 'self' بدون nonce.
 */
'use strict';

// ─── جامِع أخطاء الواجهة (كان مكررًا مرتين في <head>) ───
window.__errs = window.__errs || [];
window.addEventListener('error', function (e) {
    window.__errs.push('JS: ' + String(e.message).slice(0, 200) + ' @ ' + String(e.filename || '').split('/').pop() + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', function (e) {
    window.__errs.push('REJ: ' + String((e.reason && e.reason.message) || e.reason).slice(0, 200));
});

// ─── عين إظهار/إخفاء كلمة المرور (صفحة الدخول) ───
function toggleLoginPassword(btn) {
    const inp = document.getElementById('lp');
    if (!inp) {return;}
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    const icon = btn.querySelector('.ji');
    if (icon) { const ni = document.createElement('i'); ni.className = 'ji'; ni.setAttribute('data-i', show ? 'eye-off' : 'eye'); icon.replaceWith(ni); }
    btn.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    inp.focus({ preventScroll: true });
}
window.toggleLoginPassword = toggleLoginPassword;

// ─── تحذير Caps Lock (تفصيلة احترافية لمنع فشل الدخول الصامت) ───
(function () {
    const lp = document.getElementById('lp');
    const warn = document.getElementById('capsWarn');
    if (!lp || !warn || !window.addEventListener) {return;}
    function check(e) {
        let on = false;
        try { on = !!(e && e.getModifierState && e.getModifierState('CapsLock')); } catch (_) {}
        warn.classList.toggle('on', on);
    }
    lp.addEventListener('keyup', check);
    lp.addEventListener('keydown', function (e) { if (e && e.key === 'CapsLock') { check(e); } });
    lp.addEventListener('blur', function () { warn.classList.remove('on'); });
})();

// ─── دخول احتياطي مستقل (2026-09-30): يعمل حتى لو main.js/app.js فشلا تمامًا ───
// login-boot.js ملف defer مستقل بلا استيرادات — يُربط أولًا. القاعدة:
//   • doLogin الأصلي موجود → لا نفعل شيئًا (مستمع main.js يتولى، بلا ازدواج).
//   • غير موجود → ننفذ دخول طوارئ بنفس البروتوكول ثم reload (app.js يستعيد
//     الجلسة من رمز التحديث تلقائيًا عبر KARIM_RT).
(function () {
    const RT_KEY = 'karim_rt_v1';
    function apiBase() { return window.API_BASE || (window.location.origin + '/api'); }
    function showErr(msg) {
        const el = document.getElementById('lerr');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
        if (typeof window.toast === 'function') { window.toast(msg, 'error'); }
        else if (typeof alert === 'function' && !el) { alert(msg); }
    }
    function setBusy(btn, on, orig) {
        if (!btn) {return '';}
        if (on) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); return btn.innerHTML; }
        btn.disabled = false; btn.removeAttribute('aria-busy');
        if (orig) { btn.innerHTML = orig; }
        return '';
    }
    async function emergencyLogin() {
        const lu = document.getElementById('lu');
        const lp = document.getElementById('lp');
        const btn = document.getElementById('loginBtn');
        const username = (lu && lu.value || '').trim();
        const password = (lp && lp.value || '').trim();
        if (!username || !password) { showErr('أدخل اسم المستخدم وكلمة المرور'); return; }
        if (btn && btn.disabled) {return;}
        const orig = setBusy(btn, true);
        try {
            const r = await fetch(apiBase() + '/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ username: username, password: password }),
            });
            const data = await r.json().catch(function () { return {}; });
            if (!r.ok || !data.access_token) {
                setBusy(btn, false, orig);
                showErr((data && (data.message || data.error)) || 'بيانات تسجيل الدخول غير صحيحة');
                return;
            }
            if (data.password_change_required) {
                setBusy(btn, false, orig);
                showErr('يجب تغيير كلمة المرور الأولية — تواصل مع مدير النظام');
                return;
            }
            try { if (data.refresh_token) { localStorage.setItem(RT_KEY, data.refresh_token); } } catch (_) {}
            window._jwt = data.access_token;
            location.reload();
        } catch (e) {
            setBusy(btn, false, orig);
            showErr('فشل الاتصال بالخادم');
        }
    }
    function onClick() {
        if (typeof window.doLogin === 'function') {return;} // المسار الطبيعي يتولى
        emergencyLogin();
    }
    function onEnter(e) {
        if (!e || e.key !== 'Enter') {return;}
        if (typeof window.doLogin === 'function') { try { window.doLogin(); } catch (_) {} return; }
        emergencyLogin();
    }
    const btn = document.getElementById('loginBtn');
    if (btn && !btn.dataset.fallbackBound) { btn.addEventListener('click', onClick); btn.dataset.fallbackBound = 'true'; }
    const lp = document.getElementById('lp');
    if (lp && !lp.dataset.fallbackBound) { lp.addEventListener('keydown', onEnter); lp.dataset.fallbackBound = 'true'; }
})();

// ─── تسجيل الـ Service Worker ───
// ملاحظة: isSecureContext = false حين يفتح الجوال الشبكة الداخلية بشهادة غير
// موثوقة (تجاوز تحذير الشهادة) — عندها لا يسجل الـ SW ولا يظهر خيار تثبيت
// الـ PWA؛ الحل بيئي: تثبيت شهادة الـ CA على الجوال أو الدخول عبر نطاق التونل.
if ('serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(function () {});
    });
}
