/**
 * zkteco/routes.js — واجهة REST لمزامنة البصمة داخل ERP
 * ────────────────────────────────────────────────────────────────────────────
 * /api/zkteco
 *   GET  /status                ملخص حي للمحرك والأجهزة          (admin/hr/manager)
 *   GET  /devices               قائمة الأجهزة + حالتها           (admin/hr/manager)
 *   POST /devices               إضافة جهاز                        (admin/hr)
 *   PUT  /devices/:id           تعديل جهاز                        (admin/hr)
 *   DELETE /devices/:id         حذف جهاز                          (admin/hr)
 *   POST /devices/:id/test      فحص اتصال حقيقي (مصافحة + هوية)  (admin/hr)
 *   POST /devices/:id/sync      مزامنة الآن                       (admin/hr)
 *   GET  /devices/:id/users     مستخدمو الجهاز من الذاكرة نفسها  (admin/hr)
 *   POST /devices/:id/import-users استيراد مستخدمي الجهاز كموظفين (admin/hr)
 *   GET  /mappings              ربط الموظفين بالأرقام             (admin/hr/manager)
 *   PUT  /mappings/:employeeId  تعيين رقم بصمة لموظف              (admin/hr)
 *   POST /mappings/auto         ربط تلقائي بالرقم الوظيفي         (admin/hr)
 *   GET  /logs                  سجل البصمات الخام                 (admin/hr/manager)
 *   GET  /my-punches            بصماتي اليوم (بوابة الموظف)       (أي مستخدم)
 */

'use strict';

const express = require('express');
const { pool } = require('../shared-pool');
const { jwtAuth, requireRole } = require('../cashier-module/jwt-middleware');
const { logger } = require('../logger');
const { ZKError } = require('./client');

const router = express.Router();
const READ_ROLES = ['admin', 'hr', 'manager', 'accountant'];
const WRITE_ROLES = ['admin', 'hr'];

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function isValidIPv4(ip) {
    if (!IP_RE.test(ip)) {return false;}
    return ip.split('.').every(o => Number(o) <= 255);
}

function deviceStatusView(row, engineState) {
    return {
        ...row,
        live: engineState ? {
            syncing: engineState.syncing,
            lastAttemptAt: engineState.lastAttemptAt,
            lastResultAt: engineState.lastResultAt,
            lastError: engineState.lastError,
            consecutiveFailures: engineState.consecutiveFailures,
        } : null,
    };
}

function validateDevicePayload(body, { partial = false } = {}) {
    const errors = [];
    const out = {};
    if (body.name !== undefined || !partial) {
        const name = String(body.name || '').trim();
        if (!name || name.length > 100) {errors.push('اسم الجهاز مطلوب (حتى 100 حرف)');}
        else {out.name = name;}
    }
    if (body.ipAddress !== undefined || !partial) {
        const ip = String(body.ipAddress || '').trim();
        if (!isValidIPv4(ip)) {errors.push('عنوان IP غير صالح (مثال: 192.168.1.201)');}
        else {out.ipAddress = ip;}
    }
    if (body.port !== undefined) {
        const port = Number(body.port) || 4370;
        if (port < 1 || port > 65535) {errors.push('المنفذ غير صالح');}
        else {out.port = port;}
    }
    if (body.commKey !== undefined && body.commKey !== '') {
        const key = Number(body.commKey);
        if (!Number.isInteger(key) || key < 0 || key > 65535) {errors.push('مفتاح الاتصال (Comm Key) بين 0 و 65535');}
        else {out.commKey = key;}
    }
    if (body.enabled !== undefined) {out.enabled = Boolean(body.enabled);}
    if (body.syncIntervalSeconds !== undefined) {
        const s = Number(body.syncIntervalSeconds) || 30;
        if (s < 5 || s > 86400) {errors.push('فترة المزامنة بين 5 و 86400 ثانية');}
        else {out.syncIntervalSeconds = s;}
    }
    return { errors, out };
}

// ─── ملخص المحرك ─────────────────────────────────────────────────────────────
// PERF: عدّادات totals تمسح جداول كبيرة — تُحفظ 20 ثانية في الذاكرة.
// القراءة فقط ولا تمس أي كتابة — آمنة تمامًا على المزامنة الحية.
let _statusCache = null;
let _statusCacheAt = 0;
const STATUS_TTL_MS = 20_000;
router.get('/status', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        if (_statusCache && Date.now() - _statusCacheAt < STATUS_TTL_MS) {
            return res.json(_statusCache);
        }
        const engine = req.app.locals.attendanceEngine;
        const devices = (await pool.query(
            `SELECT id, name, "ipAddress", port, status, "lastSyncAt", "lastError",
                    "totalSynced", enabled
             FROM attendance_devices ORDER BY id`
        )).rows;
        const totals = (await pool.query(
            `SELECT COUNT(*)::int AS logs,
                    COUNT(*) FILTER (WHERE "employeeId" IS NULL)::int AS unmapped,
                    COUNT(*) FILTER (WHERE "attendanceTime" >=
                        date_trunc('day', NOW() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh')::int AS today
             FROM attendance_logs`
        )).rows[0];
        // مؤشر الربط: موظفون نشطون مربوطون برقم بصمة مقابل غير المربوطين
        const link = (await pool.query(
            `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS employees,
                    COUNT(*) FILTER (WHERE status = 'active' AND "deviceUserId" IS NOT NULL AND "deviceUserId" <> '')::int AS "linkedEmployees"
             FROM employees`
        )).rows[0];
        totals.employees = link.employees || 0;
        totals.linkedEmployees = link.linkedEmployees || 0;
        totals.unlinkedEmployees = Math.max(0, totals.employees - totals.linkedEmployees);
        const payload = {
            running: engine ? engine.running : false,
            devices: devices.map(d => deviceStatusView(d, engine?.getStatus().devices.find(s => s.id === d.id))),
            totals,
        };
        _statusCache = payload;
        _statusCacheAt = Date.now();
        res.json(payload);
    } catch (error) {
        logger.error('[zkteco/status]', error);
        res.status(500).json({ error: 'ZK_STATUS_FAILED', message: 'تعذر جلب حالة مزامنة البصمة' });
    }
});

// ─── إدارة الأجهزة ───────────────────────────────────────────────────────────
router.get('/devices', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const engine = req.app.locals.attendanceEngine;
        const { rows } = await pool.query('SELECT * FROM attendance_devices ORDER BY id');
        const states = engine ? engine.getStatus().devices : [];
        res.json(rows.map(r => deviceStatusView(r, states.find(s => s.id === r.id))));
    } catch (error) {
        logger.error('[zkteco/devices]', error);
        res.status(500).json({ error: 'ZK_DEVICES_FAILED', message: 'تعذر جلب أجهزة البصمة' });
    }
});

router.post('/devices', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const { errors, out } = validateDevicePayload(req.body || {});
        if (errors.length) {return res.status(422).json({ error: 'ZK_DEVICE_INVALID', message: errors.join(' — ') });}
        const dup = await pool.query(
            'SELECT id FROM attendance_devices WHERE "ipAddress" = $1 AND port = $2 LIMIT 1',
            [out.ipAddress, out.port || 4370]
        );
        if (dup.rows[0]) {return res.status(409).json({ error: 'ZK_DEVICE_DUPLICATE', message: 'هناك جهاز مسجل بنفس العنوان والمنفذ' });}
        const { rows } = await pool.query(
            `INSERT INTO attendance_devices (name, "ipAddress", port, "commKey", enabled, "syncIntervalSeconds")
             VALUES ($1, $2, $3, $4, COALESCE($5, true), COALESCE($6, 30)) RETURNING *`,
            [out.name, out.ipAddress, out.port || 4370, out.commKey || 0, out.enabled, out.syncIntervalSeconds]
        );
        logger.info(`[zkteco] أُضيف جهاز بصمة: ${out.name} (${out.ipAddress}) بواسطة ${req.user.username}`);
        res.status(201).json(rows[0]);
    } catch (error) {
        logger.error('[zkteco/devices:create]', error);
        res.status(500).json({ error: 'ZK_DEVICE_CREATE_FAILED', message: 'تعذر إضافة الجهاز' });
    }
});

router.put('/devices/:id', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { errors, out } = validateDevicePayload(req.body || {}, { partial: true });
        if (errors.length) {return res.status(422).json({ error: 'ZK_DEVICE_INVALID', message: errors.join(' — ') });}
        const keys = Object.keys(out);
        if (!keys.length) {return res.status(422).json({ error: 'ZK_DEVICE_EMPTY', message: 'لا يوجد ما يُحدّث' });}
        const sets = keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
        const values = keys.map(k => out[k]);
        const { rows } = await pool.query(
            `UPDATE attendance_devices SET ${sets} WHERE id = $1 RETURNING *`,
            [id, ...values]
        );
        if (!rows[0]) {return res.status(404).json({ error: 'ZK_DEVICE_NOT_FOUND', message: 'الجهاز غير موجود' });}
        if (out.enabled === false) {
            await pool.query(`UPDATE attendance_devices SET status = 'disabled' WHERE id = $1`, [id]);
        } else if (out.enabled === true) {
            await pool.query(`UPDATE attendance_devices SET status = 'unknown' WHERE id = $1 AND status = 'disabled'`, [id]);
        }
        res.json(rows[0]);
    } catch (error) {
        logger.error('[zkteco/devices:update]', error);
        res.status(500).json({ error: 'ZK_DEVICE_UPDATE_FAILED', message: 'تعذر تحديث الجهاز' });
    }
});

router.delete('/devices/:id', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { rows } = await pool.query('DELETE FROM attendance_devices WHERE id = $1 RETURNING name', [id]);
        if (!rows[0]) {return res.status(404).json({ error: 'ZK_DEVICE_NOT_FOUND', message: 'الجهاز غير موجود' });}
        res.json({ ok: true, message: `حُذف الجهاز "${rows[0].name}" مع سجل بصماته الخام` });
    } catch (error) {
        logger.error('[zkteco/devices:delete]', error);
        res.status(500).json({ error: 'ZK_DEVICE_DELETE_FAILED', message: 'تعذر حذف الجهاز' });
    }
});

/** فحص اتصال حقيقي — مصافحة بروتوكول + هوية (منفذ مفتوح وحده لا يكفي) */
router.post('/devices/:id/test', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const id = Number(req.params.id);
    try {
        const engine = req.app.locals.attendanceEngine;
        const { rows } = await pool.query('SELECT * FROM attendance_devices WHERE id = $1', [id]);
        if (!rows[0]) {return res.status(404).json({ error: 'ZK_DEVICE_NOT_FOUND', message: 'الجهاز غير موجود' });}
        const result = await engine.probeDevice(rows[0]);
        res.json({
            ok: true,
            message: `تم الاتصال بنجاح: ${result.identity.deviceName || rows[0].name} — تسلسلي ${result.identity.serial || 'غير متاح'} — ${result.sizes ? `${result.sizes.users} مستخدم / ${result.sizes.records} بصمة` : ''}`,
            identity: result.identity,
            sizes: result.sizes,
            usersCount: Array.isArray(result.users) ? result.users.length : null,
        });
    } catch (error) {
        res.status(502).json({ ok: false, error: 'ZK_PROBE_FAILED', message: error.message });
    }
});

router.post('/devices/:id/sync', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const id = Number(req.params.id);
    try {
        const engine = req.app.locals.attendanceEngine;
        const result = await engine.syncDeviceById(id);
        res.json({ ok: true, message: `المزامنة تمت: قراءة ${result.read} — جديد ${result.inserted} — ربط حضور ${result.writeBacks}`, ...result });
    } catch (error) {
        if (error instanceof ZKError && error.code === 'ZK_DEVICE_NOT_FOUND') {
            return res.status(404).json({ error: error.code, message: 'الجهاز غير موجود' });
        }
        res.status(502).json({ ok: false, error: 'ZK_SYNC_FAILED', message: `فشلت المزامنة: ${error.message}` });
    }
});

/** مستخدمو الجهاز كما في ذاكرته الفعلية (لشاشة الربط) */
router.get('/devices/:id/users', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const id = Number(req.params.id);
    try {
        const { rows } = await pool.query('SELECT * FROM attendance_devices WHERE id = $1', [id]);
        if (!rows[0]) {return res.status(404).json({ error: 'ZK_DEVICE_NOT_FOUND', message: 'الجهاز غير موجود' });}
        const engine = req.app.locals.attendanceEngine;
        // نجرب عبر محرك المزامنة ليعمل أيضا مع الرد عن بعد
        const probe = await engine.probeDevice(rows[0]);
        res.json({ ok: true, users: probe.users || [] });
    } catch (error) {
        res.status(502).json({ ok: false, error: 'ZK_USERS_FAILED', message: error.message });
    }
});

/** مستخدمو الجهاز المخزنون (أسماء + بصمات + الموظف المرتبط) — سريع بلا اتصال بالجهاز */
router.get('/devices/:id/stored-users', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    const id = Number(req.params.id);
    try {
        const { rows } = await pool.query(
            `SELECT u."userId" AS "userId", u.name, u.privilege, u.card, u.punches, u."lastSeenAt",
                    e.id AS "employeeId", e.name AS "employeeName", false AS "archived",
                    (SELECT COUNT(*)::int FROM attendance_logs l WHERE l."deviceId" = u."deviceId" AND l."deviceUserId" = u."userId") AS "totalPunches"
               FROM zk_device_users u LEFT JOIN employees e
                 ON e."deviceUserId" = u."userId" OR e."employeeId" = u."userId"
              WHERE u."deviceId" = $1
              UNION ALL
             SELECT l."deviceUserId" AS "userId", NULL AS name, NULL AS privilege, NULL AS card, 0 AS punches, NULL AS "lastSeenAt",
                    e.id AS "employeeId", e.name AS "employeeName", true AS "archived",
                    COUNT(*)::int AS "totalPunches"
               FROM attendance_logs l LEFT JOIN employees e
                 ON e."deviceUserId" = l."deviceUserId" OR e."employeeId" = l."deviceUserId"
              WHERE l."deviceId" = $1 AND NOT EXISTS (SELECT 1 FROM zk_device_users u WHERE u."deviceId" = $1 AND u."userId" = l."deviceUserId")
              GROUP BY l."deviceUserId", e.id, e.name
              ORDER BY 1`, [id]);
        res.json({ ok: true, count: rows.length, users: rows });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'ZK_STORED_USERS_FAILED', message: error.message });
    }
});

/** استيراد مستخدمي الجهاز كموظفين: الرقم الوظيفي = رقم البصمة (بلا تعارض) */
router.post('/devices/:id/import-users', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const id = Number(req.params.id);
    try {
        const { rows } = await pool.query('SELECT * FROM attendance_devices WHERE id = $1', [id]);
        if (!rows[0]) {return res.status(404).json({ error: 'ZK_DEVICE_NOT_FOUND', message: 'الجهاز غير موجود' });}
        // القسم (اختياري) — يجب أن يكون كود قسم موجودًا وإلا يُترك فارغًا
        let department = null;
        const deptCode = String(req.body?.department || '').trim().slice(0, 50);
        if (deptCode) {
            const dep = await pool.query('SELECT code FROM "hrDepartments" WHERE code = $1 LIMIT 1', [deptCode]);
            if (!dep.rows[0]) {return res.status(422).json({ error: 'ZK_DEPT_INVALID', message: 'كود القسم غير موجود' });}
            department = deptCode;
        }
        const wanted = Array.isArray(req.body?.userIds) && req.body.userIds.length
            ? new Set(req.body.userIds.map(v => String(v ?? '').trim()).filter(Boolean))
            : null;
        const engine = req.app.locals.attendanceEngine;
        const probe = await engine.probeDevice(rows[0]);
        const users = Array.isArray(probe.users) ? probe.users : [];
        // الأرقام المحجوزة (بصيغها) لمنع أي تعارض
        const taken = new Set();
        const collectTaken = (v) => {
            const s = String(v ?? '').trim();
            if (!s) {return;}
            taken.add(s);
            if (/^\d+$/.test(s)) {taken.add(String(Number(s)));}
        };
        (await pool.query('SELECT "employeeId", "deviceUserId" FROM employees')).rows
            .forEach(e => { collectTaken(e.employeeId); collectTaken(e.deviceUserId); });
        let created = 0, skipped = 0;
        const createdRows = [], skippedIds = [];
        for (const u of users) {
            const uid = String(u.userId ?? '').trim();
            if (!uid) { skipped++; continue; }
            if (wanted && !wanted.has(uid)) {continue;}
            const forms = [uid];
            if (/^\d+$/.test(uid)) {forms.push(String(Number(uid)));}
            if (forms.some(f => taken.has(f))) { skipped++; skippedIds.push(uid); continue; }
            const name = String(u.name ?? '').trim().slice(0, 255) || `موظف ${uid}`;
            const newId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
            try {
                const ins = await pool.query(
                    `INSERT INTO employees (id, name, "employeeId", "deviceUserId", department, status, salary)
                     VALUES ($1, $2, $3, $4, $5, 'active', 0)
                     RETURNING id, name, "employeeId"`,
                    [newId, name, uid, uid, department]
                );
                forms.forEach(f => taken.add(f));
                taken.add(uid);
                created++;
                createdRows.push(ins.rows[0]);
            } catch (e) {
                if (e.code === '23505') { skipped++; skippedIds.push(uid); taken.add(uid); continue; }
                throw e;
            }
        }
        logger.info(`[zkteco] استيراد مستخدمي الجهاز ${rows[0].name}: جديد ${created} — متخطى ${skipped} بواسطة ${req.user.username}`);
        res.json({
            ok: true, total: users.length, created, skipped,
            skippedIds: skippedIds.slice(0, 200),
            createdList: createdRows.slice(0, 200),
            message: created
                ? `تم إنشاء ${created} موظفًا من جهاز البصمة (الرقم الوظيفي = رقم البصمة)${skipped ? ` — تُخطي ${skipped} موجود مسبقًا` : ''}`
                : 'لا يوجد مستخدمون جدد للاستيراد — الكل موجود مسبقًا',
        });
    } catch (error) {
        logger.error('[zkteco/devices:import-users]', error);
        res.status(502).json({ ok: false, error: 'ZK_IMPORT_FAILED', message: `تعذر الاستيراد من الجهاز: ${error.message}` });
    }
});

// ─── ربط الموظفين بأرقام البصمة ──────────────────────────────────────────────
router.get('/mappings', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT e.id, e.name, e."employeeId", e.department, e.status, e."deviceUserId",
                    (SELECT COUNT(*)::int FROM attendance_logs l
                      WHERE l."employeeId" = e.id
                        AND l."attendanceTime" >=
                            date_trunc('day', NOW() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh') AS "todayPunches"
             FROM employees e
             ORDER BY e.name`
        );
        const unmapped = (await pool.query(
            `SELECT l."deviceId", l."deviceUserId", COUNT(*)::int AS punches, MAX(l."attendanceTime") AS "lastPunch"
             FROM attendance_logs l WHERE l."employeeId" IS NULL
             GROUP BY l."deviceId", l."deviceUserId" ORDER BY punches DESC LIMIT 100`
        )).rows;
        res.json({ employees: rows, unmapped });
    } catch (error) {
        logger.error('[zkteco/mappings]', error);
        res.status(500).json({ error: 'ZK_MAPPINGS_FAILED', message: 'تعذر جلب ربط الموظفين' });
    }
});

router.put('/mappings/:employeeId', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const employeeId = Number(req.params.employeeId);
        const raw = req.body?.deviceUserId;
        const deviceUserId = raw == null || String(raw).trim() === '' ? null : String(raw).trim().slice(0, 64);
        if (deviceUserId) {
            // رقم واحد لموظف واحد — منع الربط المزدوج
            const clash = await pool.query(
                `SELECT id, name FROM employees WHERE "deviceUserId" = $1 AND id <> $2 LIMIT 1`,
                [deviceUserId, employeeId]
            );
            if (clash.rows[0]) {
                return res.status(409).json({ error: 'ZK_MAPPING_CLASH', message: `الرقم ${deviceUserId} مرتبط بالفعل بالموظف "${clash.rows[0].name}"` });
            }
        }
        const { rows } = await pool.query(
            `UPDATE employees SET "deviceUserId" = $1 WHERE id = $2
             RETURNING id, name, "employeeId", "deviceUserId"`,
            [deviceUserId, employeeId]
        );
        if (!rows[0]) {return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: 'الموظف غير موجود' });}
        res.json(rows[0]);
    } catch (error) {
        logger.error('[zkteco/mappings:update]', error);
        res.status(500).json({ error: 'ZK_MAPPING_FAILED', message: 'تعذر حفظ الربط' });
    }
});

/** ربط تلقائي: كل موظف بلا رقم بصمة يأخذ رقمه الوظيفي إن وُجد كمستخدم على جهاز */
router.post('/mappings/auto', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        // أرقام المستخدمين الفعلية الموجودة على الأجهزة (إن استُخدمت قائمة محلية)
        const deviceId = Number(req.body?.deviceId) || null;
        let deviceUserIds = null;
        if (deviceId) {
            try {
                const engine = req.app.locals.attendanceEngine;
                const { rows } = await pool.query('SELECT * FROM attendance_devices WHERE id = $1', [deviceId]);
                if (rows[0]) {
                    const probe = await engine.probeDevice(rows[0]);
                    deviceUserIds = new Set((probe.users || []).map(u => String(u.userId)));
                }
            } catch (_) { deviceUserIds = null; }
        }
        const { rows } = await pool.query(
            `SELECT id, name, "employeeId" FROM employees
             WHERE ("deviceUserId" IS NULL OR "deviceUserId" = '')
               AND "employeeId" IS NOT NULL AND "employeeId" <> ''`
        );
        let linked = 0;
        const linkedNames = [];
        for (const emp of rows) {
            if (deviceUserIds && !deviceUserIds.has(String(emp.employeeId))) {continue;}
            const clash = await pool.query(
                'SELECT id FROM employees WHERE "deviceUserId" = $1 LIMIT 1', [String(emp.employeeId)]
            );
            if (clash.rows[0]) {continue;}
            await pool.query('UPDATE employees SET "deviceUserId" = $1 WHERE id = $2', [String(emp.employeeId), emp.id]);
            linked += 1;
            linkedNames.push(emp.name);
        }
        res.json({ ok: true, linked, linkedNames: linkedNames.slice(0, 50),
            message: linked ? `تم ربط ${linked} موظفًا تلقائيًا برقمه الوظيفي` : 'لا يوجد موظفون بحاجة لربط تلقائي' });
    } catch (error) {
        logger.error('[zkteco/mappings:auto]', error);
        res.status(500).json({ error: 'ZK_AUTO_LINK_FAILED', message: 'فشل الربط التلقائي' });
    }
});

// ─── سجل البصمات ─────────────────────────────────────────────────────────────
router.get('/logs', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
        const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
        const onlyUnmapped = req.query.unmapped === '1';
        const params = [];
        let where = 'TRUE';
        if (employeeId) { params.push(employeeId); where += ` AND l."employeeId" = $${params.length}`; }
        if (onlyUnmapped) {where += ' AND l."employeeId" IS NULL';}
        params.push(limit);
        const { rows } = await pool.query(
            `SELECT l.id, l."deviceUserId", l."employeeId", e.name AS "employeeName",
                    e."employeeId" AS "employeeNumber", l."attendanceTime", l."verifyType",
                    l."punchState", l."syncedAt", d.name AS "deviceName", d."ipAddress"
             FROM attendance_logs l
             LEFT JOIN attendance_devices d ON d.id = l."deviceId"
             LEFT JOIN employees e ON e.id = l."employeeId"
             WHERE ${where}
             ORDER BY l."attendanceTime" DESC LIMIT $${params.length}`,
            params
        );
        res.json(rows);
    } catch (error) {
        logger.error('[zkteco/logs]', error);
        res.status(500).json({ error: 'ZK_LOGS_FAILED', message: 'تعذر جلب سجل البصمات' });
    }
});

// ─── تصدير سجل البصمات CSV (فلاتر + حد أقصى 100 ألف صف) ────────────────────────
router.get('/logs/export', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? req.query.from : null;
        const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? req.query.to : null;
        const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
        const onlyUnmapped = req.query.unmapped === '1';
        const params = [];
        let where = 'TRUE';
        if (from) { params.push(from); where += ` AND l."attendanceTime" >= $${params.length}::date`; }
        if (to) { params.push(to); where += ` AND l."attendanceTime" < ($${params.length}::date + INTERVAL '1 day')`; }
        if (employeeId) { params.push(employeeId); where += ` AND l."employeeId" = $${params.length}`; }
        if (onlyUnmapped) {where += ' AND l."employeeId" IS NULL';}
        const { rows } = await pool.query(
            `SELECT TO_CHAR(l."attendanceTime" AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS day,
                    TO_CHAR(l."attendanceTime" AT TIME ZONE 'Asia/Riyadh', 'HH24:MI:SS') AS time,
                    COALESCE(e.name, '') AS emp, COALESCE(e."employeeId",'') AS emp_no,
                    COALESCE(l."deviceUserId",'') AS fp, l."punchState", l."verifyType",
                    COALESCE(d.name,'') AS dev
             FROM attendance_logs l
             LEFT JOIN attendance_devices d ON d.id = l."deviceId"
             LEFT JOIN employees e ON e.id = l."employeeId"
             WHERE ${where}
             ORDER BY l."attendanceTime" DESC LIMIT 100000`,
            params
        );
        const punchName = (s) => s === 0 ? 'دخول' : s === 1 ? 'خروج' : `حالة ${s}`;
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = ['\uFEFFالتاريخ,الوقت,الموظف,الرقم الوظيفي,رقم البصمة,الحركة,طريقة التحقق,الجهاز'];
        for (const r of rows) {lines.push([r.day, r.time, esc(r.emp), esc(r.emp_no), esc(r.fp), punchName(r.punchState), r.verifyType ?? '', esc(r.dev)].join(','));}
        const fname = `fingerprints-${from || 'all'}_${to || 'all'}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
        res.send(lines.join('\n'));
    } catch (error) {
        logger.error('[zkteco/logs/export]', error);
        res.status(500).json({ error: 'ZK_EXPORT_FAILED', message: 'تعذر التصدير' });
    }
});

// ─── مؤشر البصمات — سحب جميع البصمات من تاريخ محدد ──────────────────
router.get('/fingerprints', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const from = req.query.from || '2025-09-01';
        const to = req.query.to || new Date().toISOString().slice(0, 10);
        const { rows } = await pool.query(
            `SELECT l.id, TO_CHAR(l."attendanceTime" AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI:SS') AS "punchTime",
                    COALESCE(e.name, 'غير مربوط') AS "employeeName", COALESCE(e."employeeId",'') AS "employeeNumber",
                    COALESCE(l."deviceUserId",'') AS "fingerprint", l."punchState", l."verifyType",
                    COALESCE(d.name,'') AS "deviceName"
             FROM attendance_logs l
             LEFT JOIN attendance_devices d ON d.id = l."deviceId"
             LEFT JOIN employees e ON e.id = l."employeeId"
             WHERE l."attendanceTime" >= $1::date AND l."attendanceTime" < ($2::date + INTERVAL '1 day')
             ORDER BY l."attendanceTime" ASC`,
            [from, to]
        );
        res.json({ ok:true, from, to, count: rows.length, fingerprints: rows });
    } catch (error) {
        logger.error('[zkteco/fingerprints]', error);
        res.status(500).json({ error: 'FINGERPRINTS_FAILED', message: 'تعذر جلب البصمات' });
    }
});

// ─── بوابة الموظف: بصماتي ─────────────────────────────────────────────
router.get('/my-punches', jwtAuth, async (req, res) => {
    try {
        const own = await pool.query('SELECT id, name, "employeeId", "deviceUserId" FROM employees WHERE "userId" = $1 LIMIT 1', [req.user.id]);
        const emp = own.rows[0];
        if (!emp) {
            return res.json({ linked: false, hasEmployeeProfile: false, deviceUserId: null, employeeNumber: null,
                punches: [], todayRecord: null, devices: { enabled: 0, online: 0 } });
        }
        const punches = (await pool.query(
            `SELECT l."attendanceTime", l."punchState", l."verifyType", d.name AS "deviceName"
             FROM attendance_logs l LEFT JOIN attendance_devices d ON d.id = l."deviceId"
             WHERE l."employeeId" = $1
               AND l."attendanceTime" >=
                   date_trunc('day', NOW() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
             ORDER BY l."attendanceTime" ASC LIMIT 50`,
            [emp.id]
        )).rows;
        const todayRecord = (await pool.query(
            `SELECT id, date, "checkIn", "checkOut", late, source, "workMinutes", notes
             FROM attendance WHERE "employeeId" = $1 AND date = TO_CHAR(NOW() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD')`,
            [emp.id]
        )).rows[0] || null;
        const devices = (await pool.query(
            `SELECT COUNT(*) FILTER (WHERE enabled)::int AS enabled,
                    COUNT(*) FILTER (WHERE enabled AND status = 'online')::int AS online
             FROM attendance_devices`
        )).rows[0] || { enabled: 0, online: 0 };
        // مؤشر الربط الواضح: البصمة مربوطة فقط عند وجود رقم بصمة فعلي للموظف
        res.json({
            linked: Boolean(emp.deviceUserId),
            hasEmployeeProfile: true,
            deviceUserId: emp.deviceUserId || null,
            employeeNumber: emp.employeeId || null,
            employee: { id: emp.id, name: emp.name },
            punches, todayRecord, devices,
        });
    } catch (error) {
        logger.error('[zkteco/my-punches]', error);
        res.status(500).json({ error: 'ZK_MY_PUNCHES_FAILED', message: 'تعذر جلب بصمات اليوم' });
    }
});

module.exports = { router };
