/**
 * attendance-portal-routes.js — بوابة البصمة الذاتية للموظف (Express wiring)
 * ────────────────────────────────────────────────────────────────────────────
 * المواصفة: docs/SPEC-employee-pwa-attendance-geofence-v1.md §5
 * الخطة: docs/PLAN-safe-rollout-playbook-v1.md (الخطوة S2)
 *
 * قواعد صارمة:
 *   • كل الحكم الأمني في punch-portal-logic.js (نقي ومُختبَر) — هنا توصيل فقط.
 *   • كل محاولة (ناجحة أو مرفوضة) تُسجَّل في punch_attempts — الشفافية جزء من العدالة.
 *   • الميزة تولد مغلقة (punch_portal_enabled=false) — فتحها قرار إداري من الإعدادات.
 *   • الزمن المرجعي = ساعة السيرفر دائمًا (لا نثق بساعة الجهاز).
 *   • الموقع يُقرأ لحظة البصمة فقط — لا تتبع خلفي بأي شكل.
 */
'use strict';

const express = require('express');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { evaluatePunch, resolvePunchSettings } = require('./punch-portal-logic');

const router = express.Router();

// ─── الإعدادات الحية (من punch_settings — التغيير ينعكس بلا إعادة تشغيل) ────

async function loadPunchSettings() {
    try {
        const { rows } = await pool.query('SELECT key, value FROM punch_settings');
        return resolvePunchSettings(rows, process.env);
    } catch (e) {
        logger.error('[punch-portal] تعذر قراءة الإعدادات — الافتراضي: الميزة مغلقة:', e.message);
        // fail-safe: أي خلل في الإعدادات = الميزة مغلقة
        return resolvePunchSettings([], process.env);
    }
}

/** ربط الحساب بملف الموظف — بلا ملف موظف لا توجد بصمة ذاتية */
async function getEmployeeForUser(userId) {
    const { rows } = await pool.query(
        'SELECT id, name, "employeeId" FROM employees WHERE "userId" = $1 LIMIT 1',
        [userId]
    );
    return rows[0] || null;
}

async function getBoundDevice(userId) {
    const { rows } = await pool.query(
        'SELECT device_id FROM punch_devices WHERE user_id = $1 AND active = TRUE LIMIT 1',
        [userId]
    );
    return rows[0]?.device_id || null;
}

/** سجل التدقيق: يُكتب لكل محاولة — فشل التسجيل نفسه لا يمنع رفض محاولة خطرة */
async function auditAttempt(entry) {
    try {
        await pool.query(
            `INSERT INTO punch_attempts
                (user_id, username, employee_id, remote_ip, network_ok, has_location,
                 accuracy_m, fix_age_s, distance_m, radius_m, device_id, decision, reject_code, engine_result)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [entry.userId, entry.username, entry.employeeId, entry.remoteIp, entry.networkOk,
                entry.hasLocation, entry.accuracyM, entry.fixAgeS, entry.distanceM,
                entry.radiusM, entry.deviceId, entry.decision, entry.rejectCode,
                entry.engine_result ? JSON.stringify(entry.engine_result) : null]
        );
    } catch (e) {
        logger.error('[punch-portal] فشل تدقيق المحاولة (لا يوقف الحكم):', e.message);
    }
}

// ─── حالة البوابة للموظف (تقرأها الواجهة قبل عرض الزر) ──────────────────────

router.get('/status', jwtAuth, async (req, res, next) => {
    try {
        const settings = await loadPunchSettings();
        const employee = await getEmployeeForUser(req.user.id);
        const boundDevice = settings.deviceBinding && employee
            ? await getBoundDevice(req.user.id) : null;
        res.json({
            ok: true,
            enabled: settings.portalEnabled,
            geofence: settings.geofenceEnabled,
            deviceBinding: settings.deviceBinding,
            radiusMeters: settings.radiusMeters,
            hasEmployeeProfile: Boolean(employee),
            employeeName: employee?.name || null,
            deviceBound: Boolean(boundDevice),
        });
    } catch (e) { next(e); }
});

// ─── البصمة الذاتية ─────────────────────────────────────────────────────────

router.post('/punch', jwtAuth, requireRole('admin', 'hr', 'manager', 'cashier', 'kitchen', 'warehouse', 'waiter', 'employee'), async (req, res, next) => {
    try {
        const settings = await loadPunchSettings();

        // IP الاتصال الفعلي (لا يوجد بروكسي أمام السيرفر — socket هو المرجع)
        const remoteIp = req.socket?.remoteAddress || req.ip || '';
        const deviceId = String(req.headers['x-device-id'] || req.body?.deviceId || '').trim().slice(0, 80) || null;

        const loc = req.body?.location || null;
        const evaluateInput = {
            remoteIp,
            deviceId,
            location: loc ? {
                lat: Number(loc.lat),
                lng: Number(loc.lng),
                accuracy: Number(loc.accuracy),
                fixAgeS: Number.isFinite(Number(loc.fixAgeS)) ? Number(loc.fixAgeS) : 0,
                mocked: loc.mocked === true,
            } : null,
            boundDeviceId: null, // يُملأ بعد الربط أدناه
        };

        const settings2 = { ...settings };
        // L4: جلب الجهاز المربوط (قبل الحكم حتى يُسجَّل في التفاصيل)
        const employee = await getEmployeeForUser(req.user.id);
        if (settings.deviceBinding) {
            const bound = employee ? await getBoundDevice(req.user.id) : null;
            evaluateInput.boundDeviceId = bound;
        }

        const verdict = evaluatePunch(settings2, evaluateInput);

        const auditBase = {
            userId: req.user.id,
            username: req.user.username || null,
            employeeId: employee?.id ?? null,
            remoteIp,
            networkOk: verdict.details.networkOk,
            hasLocation: verdict.details.hasLocation,
            accuracyM: verdict.details.accuracyM,
            fixAgeS: verdict.details.fixAgeS,
            distanceM: verdict.details.distanceM,
            radiusM: settings.radiusMeters,
            deviceId,
        };

        // الأسباب البنيوية قبل لمس محرك الحضور
        if (verdict.rejectCode === 'PUNCH_PORTAL_DISABLED') {
            await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: verdict.rejectCode });
            return res.status(403).json({ ok: false, error: verdict.rejectCode, message: 'البصمة الذاتية عبر البوابة غير مفعّلة حاليًا' });
        }
        if (!employee) {
            await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: 'PUNCH_NO_EMPLOYEE_PROFILE' });
            return res.status(422).json({ ok: false, error: 'PUNCH_NO_EMPLOYEE_PROFILE', message: 'لم يتم ربط حسابك بملف موظف — تواصل مع الموارد البشرية' });
        }
        if (verdict.decision !== 'accepted') {
            await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: verdict.rejectCode });
            const messages = {
                PUNCH_OUT_OF_NETWORK: 'لا يمكن البصمة من خارج شبكة المطعم',
                PUNCH_LOCATION_REQUIRED: 'تعذر الحصول على موقعك — فعّل تحديد الموقع وأعد المحاولة',
                PUNCH_LOCATION_MOCKED: 'تم رصد محاولة موقع مزيف — البصمة مرفوضة',
                PUNCH_LOCATION_WEAK: 'إشارة الموقع ضعيفة أو قديمة — انتظر لحظات وأعد المحاولة قرب نافذة مفتوحة',
                PUNCH_OUT_OF_RANGE: 'أنت خارج نطاق المطعم — البصمة متاحة من داخل المطعم فقط',
                PUNCH_DEVICE_REQUIRED: 'معرّف الجهاز مفقود — سجل الدخول من التطبيق من جديد',
                PUNCH_DEVICE_MISMATCH: 'هذا الجهاز غير مربوط بحسابك — تواصل مع الموارد البشرية لفك الربط',
            };
            const statusMap = {
                PUNCH_OUT_OF_NETWORK: 403, PUNCH_OUT_OF_RANGE: 403,
                PUNCH_LOCATION_MOCKED: 403, PUNCH_DEVICE_MISMATCH: 403,
                PUNCH_LOCATION_REQUIRED: 422, PUNCH_LOCATION_WEAK: 422,
                PUNCH_DEVICE_REQUIRED: 422,
            };
            return res.status(statusMap[verdict.rejectCode] || 403).json({
                ok: false, error: verdict.rejectCode,
                message: messages[verdict.rejectCode] || 'تم رفض البصمة',
                distanceM: verdict.details.distanceM,
                radiusM: settings.radiusMeters,
            });
        }

        // L4: أول بصمة ناجحة تربط الجهاز
        if (settings.deviceBinding && deviceId) {
            const bound = await getBoundDevice(req.user.id);
            if (!bound) {
                await pool.query(
                    `INSERT INTO punch_devices (user_id, device_id, bound_ip)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (user_id, device_id) DO UPDATE SET active = TRUE, last_seen_at = NOW()`,
                    [req.user.id, deviceId, remoteIp]
                );
            }
        }

        // الزمن المرجعي = ساعة السيرفر بتوقيت العمل (آسيا/الرياض) — نفس منطق الأجهزة
        const now = new Date();
        const riyadh = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        });
        const parts = {};
        for (const p of riyadh.formatToParts(now)) {parts[p.type] = p.value;}
        const wall = {
            date: `${parts.year}-${parts.month}-${parts.day}`,
            hour: Number(parts.hour) % 24,
            minute: Number(parts.minute),
            time: `${parts.hour}:${parts.minute}`,
        };

        // القلب: نفس محرك الحضور الذكي القائم — لا منطق موازٍ إطلاقًا
        const { engine } = require('./attendance-engine');
        const result = await engine.processPunch({
            employeeId: employee.id,
            punchState: null, // البوابة بلا أزرار دخول/خروج — التصنيف الذكي يقرر
            instant: now,
            wall,
            device: { name: 'بوابة الجوال' },
            source: 'portal',
        });

        if (!result.action || result.error) {
            await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: 'PUNCH_ENGINE_ERROR' });
            return res.status(422).json({ ok: false, error: 'PUNCH_ENGINE_ERROR', message: 'تعذر تسجيل البصمة — راجع الإدارة' });
        }

        await auditAttempt({
            ...auditBase,
            decision: 'accepted',
            engine_result: { action: result.action, decision: result.decision },
        });

        return res.json({
            ok: true,
            action: result.action, // 'check_in' | 'check_out' (من محرك الحضور الذكي)
            decision: result.decision,
            at: now.toISOString(),
        });
    } catch (e) {
        logger.error('[punch-portal] punch failed:', e.message);
        return next(e);
    }
});

module.exports = router;
