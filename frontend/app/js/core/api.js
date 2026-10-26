/**
 * core/api.js — single API client: API_BASE + apiFetch + error-code mapping
 *   (extracted verbatim from app.js — EXTRACTION-006).
 * Bridge policy: mounted on window by js/main.js (BRIDGE-006). realtime.js reads window.API_BASE.
 * Call-time external deps (all window-guaranteed): KARIM_RTget/KARIM_RTclear/refreshSession/doLogout
 * (top-level declarations in app.js), toast (BRIDGE-004).
 */
const API_BASE = window.location.origin + '/api';

async function apiFetch(path, options = {}) {
    const buildHeaders = () => {
        const h = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
        if (window._jwt) {h['Authorization'] = 'Bearer ' + window._jwt;}
        if (window._appKey) {h['x-api-key'] = window._appKey;}
        return h;
    };
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30000); let res = await fetch(API_BASE + path, Object.assign({}, options, { headers: buildHeaders(), signal: controller.signal })); clearTimeout(timeout);
    // 429: ازدحام بدء التشغيل (عشرات الكيانات × صفحات) — إعادة بانتظار Retry-After
    if (res.status === 429 && (options._rateRetries || 0) < 5) {
        const waitMs = Math.min(15000, (Number(res.headers.get('Retry-After')) || 2) * 1000 + Math.random() * 500);
        await new Promise((r) => setTimeout(r, waitMs));
        return apiFetch(path, Object.assign({}, options, { _rateRetries: (options._rateRetries || 0) + 1 }));
    }
    // دوران مفتاح التطبيق: الجلسة بدأت قبل تفعيل API_KEY أو دُوّر المفتاح.
    // التحديث الصامت يجلب مفتاحًا جديدًا ثم إعادة واحدة بالمفتاح الجديد.
    if (res.status === 401 && !options._keyRetried && KARIM_RTget() && typeof refreshSession === 'function') {
        let needKey = false;
        try { const e = await res.clone().json(); needKey = !!(e && e.error === 'API_KEY_REQUIRED'); } catch (_) {}
        if (needKey && await refreshSession()) {
            return apiFetch(path, Object.assign({}, options, { _keyRetried: true }));
        }
    }
    if (res.status === 401 && !options._retried && KARIM_RTget()) {
        if (await refreshSession()) {
            res = await fetch(API_BASE + path, Object.assign({}, options, { headers: buildHeaders() }));
            if (res.status !== 401) {
                let data2 = null;
                try { data2 = await res.json(); } catch (_) { /* 204 */ }
                if (!res.ok) {throw new Error((data2 && (data2.message || data2.error)) || `فشل الطلب (${res.status})`);}
                return data2;
            }
        }
    }
    if (res.status === 401) {
        KARIM_RTclear();
        toast('انتهت الجلسة، الرجاء تسجيل الدخول مجددًا', 'error');
        doLogout();
        throw new Error('UNAUTHORIZED');
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* e.g. 204 No Content */ }
    if (!res.ok) {
        const info = serverErrorInfo(data);
        const err = new Error(info.message || (info.code && SERVER_CODE_AR[info.code]) || `فشل الطلب (${res.status})`);
        if (info.code) {err.code = info.code;}
        throw err;
    }
    return data;
}

const SERVER_CODE_AR = {
    INVALID_CREDENTIALS: 'بيانات تسجيل الدخول غير صحيحة',
    PASSWORD_MIGRATION_REQUIRED: 'كلمة المرور تحتاج ترحيلًا أمنيًا — تواصل مع مسؤول النظام',
    PASSWORD_CHANGE_REQUIRED: 'يجب تغيير كلمة المرور قبل المتابعة',
    ACCOUNT_DISABLED: 'تم إيقاف هذا الحساب — تواصل مع المسؤول',
    TOKEN_EXPIRED: 'انتهت الجلسة — سجّل الدخول مجددًا',
    TOKEN_INVALID: 'جلسة غير صالحة — سجّل الدخول مجددًا',
    UNAUTHORIZED: 'غير مصرح — سجّل الدخول مجددًا',
    FORBIDDEN: 'لا تملك صلاحية هذه العملية',
    API_KEY_REQUIRED: 'خطأ إعداد الاتصال — حدّث الصفحة',
    API_KEY_INVALID: 'خطأ إعداد الاتصال — حدّث الصفحة',
    RATE_LIMITED: 'محاولات كثيرة — انتظر قليلًا وحاول مجددًا',
    CATCH_WEIGHT_REQUIRED: 'صنف الوزن المتغير: أدخل الوزن الفعلي وعدد الكراتين',
    INSUFFICIENT_STOCK: 'الرصيد المتاح لا يكفي',
    NOT_FOUND: 'العنصر غير موجود',
    VALIDATION_ERROR: 'بيانات غير صالحة — تحقق من الحقول',
    INTERNAL_ERROR: 'حدث خطأ داخلي في النظام — حاول مجددًا',
};
function serverErrorInfo(data){
    if(!data || typeof data !== 'object') {return {};}
    const e = data.error;
    if(e && typeof e === 'object') {return { code: e.code || null, message: e.message || null };}
    return { code: typeof e === 'string' ? e : null, message: data.message || null };
}

export { API_BASE, apiFetch, SERVER_CODE_AR, serverErrorInfo };
