'use strict';
/** tenant/service — حلّ هوية المستأجر في الخادم فقط (fail-closed). A3.2: المصدر الفعلي. */
const resolution = require('./resolution');
const legacy = require('../../tenant-context');

module.exports = {
    ENFORCE: resolution.ENFORCE,
    resolveTenantForUser: resolution.resolveTenantForUser,
    tenantContext: legacy.tenantContext,
    setTenantLocal: resolution.setTenantLocal,
};
