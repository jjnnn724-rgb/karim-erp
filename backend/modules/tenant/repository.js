'use strict';
/** tenant/repository — طبقة الوصول الواحدة: BEGIN → SET LOCAL → استعلام → COMMIT. */
const db = require('../../tenant-db');

module.exports = {
    withTenantTx: db.withTenantTx,
    tenantQuery: db.tenantQuery,
};
