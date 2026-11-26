'use strict';
/**
 * tenant-pilot-routes.js — نسخة معزولة من CRUD لديانة leaveTypes.
 *
 * نفس المسارات/الأدوار/الشكل العام للـCRUD العام، لكن كل استعلام يعمل داخل
 * transaction مع `SET LOCAL app.tenant_id` ويُصفَّى بـtenant_id. تُركَّب
 * **قبل** حلقة الكيانات العامة في server.js فتأخذ الأسبقية على /api/leaveTypes.
 */
const express = require('express');
const { randomInt } = require('crypto');
const { jwtAuth } = require('./cashier-module/jwt-middleware');
const { requireRoleOrPerm, permForEntity } = require('./permissions');
const { filterBody, getSchema } = require('./schema-registry');
const { tenantContext } = require('./tenant-context');
const { withTenantTx } = require('./tenant-db');
const { generalLimiter, crudLimiter } = require('./rate-limiter');
const { logger } = require('./logger');

const router = express.Router();
const ENTITY = 'leaveTypes';
const READ_ROLES = ['admin', 'manager', 'accountant', 'auditor']; // مطابق لـSENSITIVE_READ_ROLES
const WRITE_ROLES = ['admin', 'manager', 'hr']; // مطابق لـOPEN_ENTITY_WRITE_ROLES.leaveTypes

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Shadow authorization: RLS يُخفي الصف، لكن نُسجّل محاولة الوصول لمراجعة الغد. */
function recordDenial(req, action) {
    logger.warn('[tenant-shadow] cross-tenant attempt blocked', {
        entity: ENTITY,
        action,
        tenantId: req.tenantId,
        userId: req.user?.id,
        role: req.user?.role,
        requestId: req.requestId || null,
    });
}

function newLegacyId(body) {
    const schema = getSchema(ENTITY);
    if (schema?.protected?.includes('id') && body.id === undefined) {
        return { ...body, id: Date.now() * 1000 + randomInt(0, 999999) };
    }
    return body;
}

function paging(req) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    return { page, limit, offset: (page - 1) * limit };
}

router.get(
    '/',
    jwtAuth,
    tenantContext(),
    requireRoleOrPerm(READ_ROLES, permForEntity(ENTITY, 'read')),
    generalLimiter,
    asyncHandler(async (req, res) => {
        const { page, limit, offset } = paging(req);
        const rows = await withTenantTx(req.tenantId, (client) =>
            client.query(
                `SELECT * FROM public."leaveTypes" WHERE tenant_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3`,
                [req.tenantId, limit, offset],
            ),
        );
        const count = await withTenantTx(req.tenantId, (client) =>
            client.query(`SELECT COUNT(*)::int AS total FROM public."leaveTypes" WHERE tenant_id = $1`, [req.tenantId]),
        );
        const total = count.rows[0]?.total ?? 0;
        res.json({
            data: rows.rows,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    }),
);

router.get(
    '/:id',
    jwtAuth,
    tenantContext(),
    requireRoleOrPerm(READ_ROLES, permForEntity(ENTITY, 'read')),
    asyncHandler(async (req, res) => {
        const row = await withTenantTx(req.tenantId, (client) =>
            client.query(`SELECT * FROM public."leaveTypes" WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId]),
        );
        if (!row.rows.length) {
            recordDenial(req, 'read');
            return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود.' });
        }
        return res.json(row.rows[0]);
    }),
);

router.post(
    '/',
    jwtAuth,
    tenantContext(),
    requireRoleOrPerm(WRITE_ROLES, permForEntity(ENTITY, 'write')),
    crudLimiter,
    asyncHandler(async (req, res) => {
        const { filtered, errors, removedKeys } = filterBody(ENTITY, req.body || {}, 'create');
        if (errors?.length || removedKeys?.length) {
            return res.status(400).json({ error: 'INVALID_PAYLOAD', message: errors?.[0] || 'بيانات غير مسموحة' });
        }
        if (!String(filtered.name || '').trim()) {
            return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'الاسم مطلوب' });
        }
        const body = newLegacyId(filtered);
        // SQL ثابت بالكامل — الأعمدة من مخطط معلن، ولا استيفاء نصي ديناميكي.
        const created = await withTenantTx(req.tenantId, (client) =>
            client.query(
                `INSERT INTO public."leaveTypes" ("id","name","days","icon","paid")
                 VALUES ($1,$2,$3,$4,$5) RETURNING *`,
                [body.id, body.name, body.days ?? null, body.icon ?? null, body.paid ?? null],
            ),
        );
        return res.status(201).json(created.rows[0]);
    }),
);

router.put(
    '/:id',
    jwtAuth,
    tenantContext(),
    requireRoleOrPerm(WRITE_ROLES, permForEntity(ENTITY, 'write')),
    crudLimiter,
    asyncHandler(async (req, res) => {
        const { filtered, errors, removedKeys } = filterBody(ENTITY, req.body || {}, 'update');
        if (errors?.length || removedKeys?.length) {
            return res.status(400).json({ error: 'INVALID_PAYLOAD', message: errors?.[0] || 'بيانات غير مسموحة' });
        }
        if (!Object.keys(filtered).length) {
            return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'لا توجد حقول للتحديث' });
        }
        // SQL ثابت مع أقنعة "هل أُرسل الحقل" — يسمح بتفراغ قيمة إلى NULL بلا بناء نصي.
        const updated = await withTenantTx(req.tenantId, (client) =>
            client.query(
                `UPDATE public."leaveTypes" SET
                    "name" = CASE WHEN $5 THEN $1 ELSE "name" END,
                    "days" = CASE WHEN $6 THEN $2 ELSE "days" END,
                    "icon" = CASE WHEN $7 THEN $3 ELSE "icon" END,
                    "paid" = CASE WHEN $8 THEN $4 ELSE "paid" END
                  WHERE id = $9 AND tenant_id = $10 RETURNING *`,
                [
                    filtered.name ?? null,
                    filtered.days ?? null,
                    filtered.icon ?? null,
                    filtered.paid ?? null,
                    Object.hasOwn(filtered, 'name'),
                    Object.hasOwn(filtered, 'days'),
                    Object.hasOwn(filtered, 'icon'),
                    Object.hasOwn(filtered, 'paid'),
                    req.params.id,
                    req.tenantId,
                ],
            ),
        );
        if (!updated.rows.length) {
            recordDenial(req, 'update');
            return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود.' });
        }
        return res.json(updated.rows[0]);
    }),
);

router.delete(
    '/:id',
    jwtAuth,
    tenantContext(),
    requireRoleOrPerm(WRITE_ROLES, permForEntity(ENTITY, 'write')),
    crudLimiter,
    asyncHandler(async (req, res) => {
        const removed = await withTenantTx(req.tenantId, (client) =>
            client.query(`DELETE FROM public."leaveTypes" WHERE id = $1 AND tenant_id = $2 RETURNING *`, [req.params.id, req.tenantId]),
        );
        if (!removed.rows.length) {
            recordDenial(req, 'delete');
            return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود.' });
        }
        return res.json(removed.rows[0]);
    }),
);

module.exports = router;
