'use strict';
/** PUT /api/tenants/:id/zatca — محمي بـjwtAuth + دور admin/manager. */
const express = require('express');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { pool } = require('./shared-pool');
const { saveTenantZatcaConfig } = require('./modules/fiscal/tenant-config');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.put('/tenants/:id/zatca', jwtAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    try {
        const saved = await saveTenantZatcaConfig(pool, req.params.id, req.body || {});
        return res.json({ ok: true, ...saved });
    } catch (e) {
        const status = e.code === 'INVALID_TENANT' || e.code === 'INVALID_ZATCA_CONFIG' ? 422 : 500;
        return res.status(status).json({ ok: false, error: e.code || 'ZATCA_CONFIG_FAILED', details: e.details });
    }
}));

module.exports = router;
