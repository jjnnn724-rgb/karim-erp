'use strict';
/**
 * auth/pure — دوال مصادقة نقية نُقلت فعليًا من jwt-middleware (A3.1).
 * لا استيراد من jwt-middleware ⇒ لا دورة اعتماد.
 */

/** M-2: الحد الأدنى 12 حرفًا + حرف+latin ورقم. */
function isStrongPassword(value) {
    return typeof value === 'string' && value.length >= 12 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function publicUserOf(user) {
    return { id: user.id, name: user.name, role: user.role, username: user.username, dept_code: user.dept_code || null };
}

module.exports = { isStrongPassword, publicUserOf };
