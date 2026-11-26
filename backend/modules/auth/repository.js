'use strict';
/** auth/repository — الوصول للبيانات/ال-cache (واجهة مستقرة للاستخراج اللاحق). */
const legacy = require('../../cashier-module/jwt-middleware');

module.exports = {
    isUserActive: legacy.isUserActive,
    invalidateActiveCache: legacy.invalidateActiveCache,
    ensureRefreshSessionColumns: legacy.ensureRefreshSessionColumns,
};
