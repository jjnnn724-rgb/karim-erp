'use strict';
/**
 * auth/controller — نقطة دخول handlers المصادقة.
 * المرحلة 1 من الاستخراج: تُعاد تصدير الدوال الحالية دون تغيير سلوك (عقد محفوظ).
 */
const legacy = require('../../cashier-module/jwt-middleware');

module.exports = {
    loginHandler: legacy.loginHandler,
    changePasswordHandler: legacy.changePasswordHandler,
    refreshHandler: legacy.refreshHandler,
    logoutHandler: legacy.logoutHandler,
};
