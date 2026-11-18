const express = require('express');
const crypto = require('crypto');
const { pool } = require('./shared-pool');
const { riyadhToday } = require('./riyadh-date'); // M20
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const { generalLimiter } = require('./rate-limiter');
const { buildMonthlyAttendanceSummaryQuery } = require('./monthly-attendance-query');
const { graceMinutes, calculateDelayParts } = require('./shift-day');
const { classifyStoredDay } = require('./shift-day-builder');
const { makeEmitScoped } = require('./realtime/guard');
const { arFuzzyPattern } = require('./ar-search');

const router = express.Router();
const QR_SECRET = process.env.EMPLOYEE_QR_SECRET || process.env.JWT_SECRET;
const ADMIN_ROLES = ['admin', 'hr'];

// SECURITY: طµظپط­ط© طھط­ظ‚ظ‚ ط§ظ„ط¨ط·ط§ظ‚ط© ط¹ط§ظ…ط© (ط¨ظ„ط§ x-api-key) â€” ظ‚ط§ط¹ط¯ط© ط¨ظٹط§ظ†ط§طھ + HTML ظ„ظƒظ„
// ظ…ط³ط­ QRطŒ ظپظٹط¬ط¨ طھظ‚ظٹظٹط¯ظ‡ط§ ظ„ظƒظ„ IP.
const cardVerifyLimiter = generalLimiter;

// HTML-escape ظ„ظƒظ„ ظ‚ظٹظ…ط© ظ…ظ† ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ طھظڈط¯ط±ط¬ ظپظٹ طµظپط­ط© ط§ظ„طھط­ظ‚ظ‚ ط§ظ„ط¹ط§ظ…ط© â€”
// ط§ظ„ط§ط³ظ…/ط§ظ„ظˆط¸ظٹظپط©/ط§ظ„ظ‚ط³ظ… طھط£طھظٹ ظ…ظ† ط¥ط¯ط®ط§ظ„ ط¨ط´ط±ظٹ ظˆ Stored XSS ظ‡ظ†ط§ طھظ†ظپط° ط¹ظ„ظ‰ ظƒظ„ ظ‡ط§طھظپ ظٹظ…ط³ط­ ط§ظ„ط¨ط·ط§ظ‚ط©.
function esc(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function requireQrSecret(res) {
    if (!QR_SECRET) {
        res.status(503).json({ error: 'EMPLOYEE_QR_SECRET_NOT_CONFIGURED', message: 'ظ„ظ… ظٹطھظ… ط¥ط¹ط¯ط§ط¯ ظ…ظپطھط§ط­ QR ظ„ظ„ظ…ظˆط¸ظپظٹظ†' });
        return false;
    }
    return true;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function encryptionKey() {
    return crypto.createHash('sha256').update(String(QR_SECRET), 'utf8').digest();
}
function encryptToken(token) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function decryptToken(value) {
    try {
        const raw = Buffer.from(String(value), 'base64url');
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const encrypted = raw.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch (_) { return null; }
}

function signQrPayload({ employeeId, cardId, version, token }) {
    return crypto.createHmac('sha256', QR_SECRET)
        .update(`${employeeId}|${cardId}|${version}|${token}`, 'utf8')
        .digest('hex');
}

function buildQrPayload(employee, token) {
    const version = Number(employee.qrVersion || 1);
    const signature = signQrPayload({ employeeId: employee.employeeId, cardId: employee.cardId, version, token });
    return {
        system: 'Karim ERP',
        type: 'employee_card',
        version: 2,
        employeeId: employee.employeeId,
        cardId: employee.cardId,
        employeeName: employee.name,
        department: employee.department,
        position: employee.position,
        qrVersion: version,
        token,
        signature,
    };
}

function generateEmployeeToken(_employee) {
    return crypto.randomBytes(32).toString('base64url');
}

async function provisionCard(client, employee) {
    if (!requireQrSecret({ status: () => ({ json: () => {} }) })) {return null;}
    const version = Math.max(1, Number(employee.qrVersion || 1));
    const token = generateEmployeeToken(employee);
    const cardId = employee.cardId || `HR-${hashToken(`${employee.id}|${employee.employeeId}`).slice(0, 16).toUpperCase()}`;
    const fingerprint = employee.digitalFingerprint || `QR-${hashToken(`${employee.id}|${employee.employeeId}`).slice(0, 16).toUpperCase()}`;
    const updated = await client.query(
        `UPDATE employees
         SET "qrTokenHash" = $1, "qrTokenEncrypted" = $2, "cardIssuedAt" = CURRENT_TIMESTAMP,
             "cardStatus" = 'active', "qrVersion" = $3, "cardId" = COALESCE("cardId", $4),
             "digitalFingerprint" = COALESCE("digitalFingerprint", $5)
         WHERE id = $6
         RETURNING *`,
        [hashToken(token), encryptToken(token), version, cardId, fingerprint, employee.id]
    );
    const persistedEmployee = updated.rows[0];
    return { employee: persistedEmployee, qrPayload: buildQrPayload({ ...persistedEmployee, cardId: persistedEmployee.cardId || cardId, qrVersion: version }, token) };
}

function canAccessEmployee(req, employee) {
    return ADMIN_ROLES.includes(req.user?.role) || Number(employee?.userId) === Number(req.user?.id);
}

function calculateMinutes(row) {
    // ط§ظ„ظ…طµط¯ط± ط§ظ„ط£ظˆظ„: ط§ظ„ظ†طµط§ظ† ط§ظ„ظ…ط¹ط±ظˆط¶ط§ظ† (HH:MM) â€” ظ…ط§ طھط±ط§ظ‡ ط§ظ„ط¹ظٹظ† ظ‡ظˆ ظ…ط§ ظٹظڈط­ط³ط¨.
    // ظٹظ…ظ†ط¹ ظ‚ظٹظ…ظ‹ط§ ط´ط§ط°ط© (25:43) ظ…ظ† ط£ط²ظ…ظ†ط© instant ظ…طھظ‚ط·ط¹ط© ط§ظ„ط£ظٹط§ظ…. ط§ظ„طھظپط§ظپ ظ„ظٹظ„ظٹ ظپظ‚ط· ط¹ظ†ط¯ out<in.
    const m = String(row.checkIn || '').match(/^(\d{1,2}):(\d{2})$/);
    const o = String(row.checkOut || '').match(/^(\d{1,2}):(\d{2})$/);
    if (m && o) {
        let diff = (Number(o[1]) * 60 + Number(o[2])) - (Number(m[1]) * 60 + Number(m[2]));
        if (diff < 0) {diff += 24 * 60;}
        return Math.max(0, diff);
    }
    if (Number.isFinite(Number(row.workMinutes))) {return Number(row.workMinutes);}
    if (row.checkInAt && row.checkOutAt) {
        return Math.max(0, Math.round((new Date(row.checkOutAt) - new Date(row.checkInAt)) / 60000));
    }
    return 0;
}

async function getEmployee(client, id) {
    const result = await client.query(`SELECT * FROM employees WHERE id = $1`, [id]);
    return result.rows[0] || null;
}

router.get('/employees/:id/card', jwtAuth, async (req, res) => {
    if (!requireQrSecret(res)) {return;}
    const employee = await getEmployee(pool, Number(req.params.id));
    if (!employee) {return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: 'ط§ظ„ظ…ظˆط¸ظپ ط؛ظٹط± ظ…ظˆط¬ظˆط¯' });}
    if (!canAccessEmployee(req, employee)) {return res.status(403).json({ error: 'FORBIDDEN', message: 'ظ„ط§ طھظ…ظ„ظƒ طµظ„ط§ط­ظٹط© ط¹ط±ط¶ ط¨ط·ط§ظ‚ط© ظ‡ط°ط§ ط§ظ„ظ…ظˆط¸ظپ' });}

    let card = { employee, qrPayload: null };
    if (!employee.qrTokenHash || !employee.qrTokenEncrypted || !employee.cardId || employee.cardStatus !== 'active') {
        card = await provisionCard(pool, employee);
    } else {
        const token = decryptToken(employee.qrTokenEncrypted);
        card.qrPayload = token ? buildQrPayload(employee, token) : null;
        if (!card.qrPayload) {card = await provisionCard(pool, employee);}
    }
    res.json({ ...card, qrAvailable: Boolean(card.qrPayload), message: card.qrPayload ? null : 'ط§ط¶ط؛ط· طھط¬ط¯ظٹط¯ QR ظ„ط¥ط¸ظ‡ط§ط± ط±ظ…ط² ط¬ط¯ظٹط¯' });
});

router.post('/employees/:id/qr/regenerate', jwtAuth, requireRole('admin', 'hr', 'manager'), async (req, res) => {
    if (!requireQrSecret(res)) {return;}
    const employee = await getEmployee(pool, Number(req.params.id));
    if (!employee) {return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: 'ط§ظ„ظ…ظˆط¸ظپ ط؛ظٹط± ظ…ظˆط¬ظˆط¯' });}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const locked = await getEmployee(client, employee.id);
        const nextVersion = Number(locked.qrVersion || 0) + 1;
        await client.query(`UPDATE employees SET "qrVersion" = $1 WHERE id = $2`, [nextVersion, locked.id]);
        const card = await provisionCard(client, { ...locked, qrVersion: nextVersion });
        await client.query('COMMIT');
        res.json({ ...card, qrAvailable: true });
    } catch (e) {
        await client.query('ROLLBACK');
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_qr_regenerate]');
        res.status(500).json({ error: 'QR_REGENERATE_FAILED', message: 'طھط¹ط°ط± طھط¬ط¯ظٹط¯ ط¨ط·ط§ظ‚ط© QR' });
    } finally { client.release(); }
});

router.get('/attendance/report', jwtAuth, async (req, res) => {
    try {
    let employeeId = req.query.employee_id ? Number(req.query.employee_id) : null;
    if (!ADMIN_ROLES.includes(req.user?.role)) {
        const own = await pool.query(`SELECT id FROM employees WHERE "userId" = $1`, [req.user.id]);
        employeeId = own.rows[0]?.id || null;
    }
    if (!employeeId) {return res.status(400).json({ error: 'EMPLOYEE_REQUIRED', message: 'ظٹط¬ط¨ طھط­ط¯ظٹط¯ ط§ظ„ظ…ظˆط¸ظپ' });}
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const from = String(req.query.from || defaultFrom).slice(0, 10);
    const to = String(req.query.to || defaultTo).slice(0, 10);
    const empRow = (await pool.query(`SELECT * FROM employees WHERE id = $1`, [employeeId])).rows[0];
    const result = await pool.query(
        `SELECT a.*, e.name, e."employeeId", e.department, e.position
         FROM attendance a JOIN employees e ON e.id = a."employeeId"
         WHERE a."employeeId" = $1 AND a.date >= $2 AND a.date <= $3
         ORDER BY a.date ASC`, [employeeId, from, to]
    );
    const records = result.rows.map(row => {
        // ط¨طµظ…ط© ظˆط§ط­ط¯ط© (ط£ظˆ ط§ظ†طµط±ط§ظپ ط¨ظ„ط§ ط¯ط®ظˆظ„) آ«طھط­طھط§ط¬ ظ…ط±ط§ط¬ط¹ط©آ» ظ„ط§ طھط®ظ…ظٹظ†ظ‹ط§ â€” ط§ظ„ظ‚ط±ط§ط±
        // ظ†ظپط³ظ‡ ط§ظ„ط°ظٹ ظٹط­ظ…ظٹ ط¨ظ†ط§ط، ط§ظ„ظٹظˆظ… (shift-day-builder) ظ…ط·ط¨ظژظ‘ظ‚ظ‹ط§ ط¹ظ„ظ‰ ط§ظ„طµظپ ط§ظ„ظ…ط­ظپظˆط¸.
        const dayState = classifyStoredDay(row, { shiftKarim: empRow?.shift_karim });
        const workMinutes = dayState.workMinutes != null ? dayState.workMinutes : calculateMinutes(row);
        return {
            ...row, workMinutes,
            status: dayState.status,
            needsReview: dayState.needsReview,
            reviewReason: dayState.reviewReason,
            ...calculateDelayParts(row, empRow),
        };
    });

    // ط§ظ„طµظپظˆظپ ط§ظ„ط؛ط§ظ…ط¶ط© (ط¨طµظ…ط© ظˆط§ط­ط¯ط© ط¨ظ„ط§ ط§ظ†طµط±ط§ظپطŒ ط£ظˆ ظ…ط¯ظ‘ط© ظ…ط´ظƒظˆظƒ ظپظٹظ‡ط§) طھظڈط³طھط¨ط¹ط¯ ظ…ظ†
    // ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ظˆطھظڈط¹ط±ط¶ ظ…ظ†ظپطµظ„ط© ظƒظ€ "ظ‚ظٹط¯ ط§ظ„ظ…ط±ط§ط¬ط¹ط©" ط¨ط¯ظ„ طھظ„ظˆظٹط« ط§ظ„ط£ط±ظ‚ط§ظ… ط§ظ„ظ…ط¹طھظ…ط¯ط©:
    // آ«ظ„ظˆ ط§ظ„ظ†ط¸ط§ظ… ظ…ط´ ظ…طھط£ظƒط¯ â†’ ظٹط³ط£ظ„طŒ ظ…ط´ ظٹط®ظ…ظ†آ» (ظ‚ط±ط§ط± ط§ظ„ظ…ط§ظ„ظƒ 2026-11-07).
    const countable = records.filter(r => !r.needsReview);
    const reviewRows = records.filter(r => r.needsReview);
    const reviewMinutes = reviewRows.reduce((s, r) => s + (r.lateMinutes || 0), 0);
    const totalLateMinutes = countable.reduce((s, r) => s + (r.lateMinutes || 0), 0);
    const empWorkDayMinutes = (Number(empRow?.shift_karim) > 0 ? Number(empRow.shift_karim) : 10) * 60;
    const lateRemainingMinutes = totalLateMinutes % empWorkDayMinutes;
    // ط¯ظ‚ط§ط¦ظ‚ ط§ظ„ط¹ط¬ط² ظ‚ط¨ظ„ ط§ظ„ط³ظ…ط§ط­ظٹط© (ظˆظ‡ظٹ طµظپط± ط§ظپطھط±ط§ط¶ظٹظ‹ط§) â€” ظ‚ط±ط§ط± ط§ظ„ظ…ط§ظ„ظƒ 2026-11-07:
    // ظ…ظ† ط£ظƒظ…ظ„ ط³ط§ط¹ط§طھ ظˆط±ط¯ظٹطھظ‡ ظ„ط§ ظٹط¸ظ‡ط± ط¹ظ„ظٹظ‡ طھط£ط®ظٹط±. ظ„ظ„ط¹ط±ط¶ ظپظ‚ط·: ط§ظ„ط®طµظ… ط§ظ„ظ…ط§ظ„ظٹ ظٹظپط¶ظ„
    // ط¹ظ„ظ‰ lateMinutes ظˆط­ط¯ظ‡ (hr-routes.js:936)طŒ ظپظ„ط§ ط±ظ‚ظ… ظ‡ظ†ط§ ظٹطھط­ظˆظ‘ظ„ ظ…ط§ظ„ظ‹ط§.
    const totalArrivalRawMinutes = countable.reduce((s, r) => s + (r.arrivalLateRawMinutes || 0), 0);
    const totalEarlyRawMinutes = countable.reduce((s, r) => s + (r.earlyLeaveRawMinutes || 0), 0);
    const rawLateDays = countable
        .filter(r => (r.arrivalLateRawMinutes || 0) > 0 || (r.earlyLeaveRawMinutes || 0) > 0).length;
    const summary = {
        from, to, employeeId, daysPresent: records.filter(r => r.checkIn).length,
        completeDays: records.filter(r => r.checkIn && r.checkOut).length,
        lateDays: countable.filter(r => (r.lateMinutes || 0) > 0).length,
        reviewDays: reviewRows.length,
        reviewMinutes,
        totalMinutes: records.reduce((sum, r) => sum + r.workMinutes, 0),
        totalLateMinutes,
        totalLateHours: Number((totalLateMinutes / 60).toFixed(2)),
        lateRemainingHours: Number((lateRemainingMinutes / 60).toFixed(2)),
        workDayMinutes: empWorkDayMinutes,
        graceMinutes: graceMinutes(),
        rawLateDays,
        totalArrivalRawMinutes,
        totalEarlyRawMinutes,
        totalRawLateMinutes: totalArrivalRawMinutes + totalEarlyRawMinutes,
    };
    summary.totalKarim = Number((summary.totalMinutes / 60).toFixed(2));
    res.json({ employee: result.rows[0] ? { id: employeeId, name: result.rows[0].name, employeeId: result.rows[0].employeeId, position: result.rows[0].position, shift_start: empRow?.shift_start, shift_karim: empRow?.shift_karim, day_off: empRow?.day_off } : null, records, summary });
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_attendance_report]');
        res.status(500).json({ error: 'ATTENDANCE_REPORT_FAILED', message: 'طھط¹ط°ط± ط¬ظ„ط¨ طھظ‚ط±ظٹط± ط§ظ„ط­ط¶ظˆط± ظˆط§ظ„ط§ظ†طµط±ط§ظپ' });
    }
});

/** ط¥ط¹ط¯ط§ط¯ط§طھ ط¨ط·ط§ظ‚ط§طھ ط§ظ„ظ…ظˆط¸ظپظٹظ† (ط±ط§ط¨ط· ط§ظ„طھط­ظ‚ظ‚ + ط·ظˆط§ط±ط¦) â€” طھط­ظƒظ… ظ…ظ† ط§ظ„ظˆط§ط¬ظ‡ط© ط¨ط¯ظ„ ط§ظ„ظƒظˆط¯ */
router.get('/card-settings', jwtAuth, async (req, res) => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS hr_card_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        const rows = (await pool.query(`SELECT key, value FROM hr_card_settings`)).rows;
        const o = Object.fromEntries(rows.map(r => [r.key, r.value]));
        res.json({ ok: true, verifyBase: o.verify_base || process.env.CARD_VERIFY_BASE || 'https://192.168.1.165:5000', emergencyPhone: o.emergency_phone || process.env.EMERGENCY_PHONE || '' });
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_card_settings_get]');
        res.status(500).json({ error: 'CARD_SETTINGS_FAILED' });
    }
});
router.put('/card-settings', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS hr_card_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        const base = String(req.body?.verifyBase || '').trim().replace(/\/$/, '');
        if (base && !/^https?:\/\//i.test(base)) {return res.status(422).json({ error: 'BAD_URL', message: 'ط§ظ„ط±ط§ط¨ط· ظٹط¬ط¨ ط£ظ† ظٹط¨ط¯ط£ ط¨ظ€ http:// ط£ظˆ https://' });}
        const emg = String(req.body?.emergencyPhone || '').trim().slice(0, 30);
        if (base) {await pool.query(`INSERT INTO hr_card_settings (key, value, updated_at) VALUES ('verify_base', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [base]);}
        await pool.query(`INSERT INTO hr_card_settings (key, value, updated_at) VALUES ('emergency_phone', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [emg]);
        res.json({ ok: true });
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_card_settings_put]');
        res.status(500).json({ error: 'CARD_SETTINGS_SAVE_FAILED' });
    }
});

/** ط¨ط·ط§ظ‚ط© ط§ظ„ظ…ظˆط¸ظپ ط§ظ„ظپط§ط®ط±ط© (طھظˆظ„ظٹط¯ ط­ظٹ + ط¹ط±ط¶ ط·ط¨ط§ط¹ط©) */
router.get('/employees/:id/lux-card', jwtAuth, async (req, res) => {
    try {
    if (!ADMIN_ROLES.includes(req.user?.role)) {
        const own = await pool.query(`SELECT id FROM employees WHERE "userId" = $1`, [req.user.id]);
        if (!own.rows[0] || Number(own.rows[0].id) !== Number(req.params.id)) {
            return res.status(403).json({ error: 'FORBIDDEN', message: 'ط¨ط·ط§ظ‚طھظƒ ظپظ‚ط·' });
        }
    }
    const emp = (await pool.query(`SELECT * FROM employees WHERE id = $1`, [Number(req.params.id)])).rows[0];
    if (!emp) {return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: 'ط§ظ„ظ…ظˆط¸ظپ ط؛ظٹط± ظ…ظˆط¬ظˆط¯' });}
    const fp = String(emp.deviceUserId || emp.employeeId || '').trim();
    if (!fp) {return res.status(422).json({ error: 'NO_FP_NUMBER', message: 'ط§ظ„ظ…ظˆط¸ظپ ط¨ظ„ط§ ط±ظ‚ظ… ط¨طµظ…ط©' });}
    // FIX 2026-10-11 (C26): was spawnSync â€” blocked the entire Node event loop
    // for up to 60s (frozen API for ALL users). Now async spawn.
    const { spawn } = require('child_process');
    const path = require('path');
    const fs = require('fs');
    const gen = path.join(__dirname, '..', 'tools', 'employee-card', 'generate-card.js');
    const r = await new Promise((resolve) => {
        const child = spawn(process.execPath, [gen, '--fp', fp], { timeout: 60000 });
        let stderr = '';
        child.stdout?.on('data', () => {});
        child.stderr?.on('data', (d) => { stderr += d; });
        child.on('error', (err) => resolve({ status: 1, stderr: String(err) }));
        child.on('close', (code) => resolve({ status: code, stderr }));
    });
    if (r.status !== 0) {
        logger.error('[lux_card] generate failed: ' + String(r.stderr || '').slice(0, 200));
        return res.status(500).json({ error: 'CARD_FAILED', message: 'طھط¹ط°ط± طھظˆظ„ظٹط¯ ط§ظ„ط¨ط·ط§ظ‚ط©' });
    }
    const file = path.join(__dirname, '..', 'tools', 'employee-card', 'out', `card-${fp}.html`);
    res.type('html').send(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_lux_card]');
        res.status(500).json({ error: 'LUX_CARD_FAILED', message: 'طھط¹ط°ط± طھظˆظ„ظٹط¯ ط§ظ„ط¨ط·ط§ظ‚ط©' });
    }
});

/** ظƒط´ظپ ط´ظ‡ط±ظٹ ظ…ط¬ظ…ط¹ ظ„ظƒظ„ ط§ظ„ظ…ظˆط¸ظپظٹظ† (ط·ط¨ط§ط¹ط© ط¨ط£ظ‚ظ„ طµظپط­ط§طھ) */
router.get('/attendance/monthly', jwtAuth, async (req, res) => {
    try {
    if (!ADMIN_ROLES.includes(req.user?.role)) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'ط§ظ„طھظ‚ط±ظٹط± ط§ظ„ط´ظ‡ط±ظٹ ظ„ظ„ط¥ط¯ط§ط±ط© ظپظ‚ط·' });
    }
    const m = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : new Date().toISOString().slice(0, 7);
    const detail = req.query.detail === '1';
    const { rows } = await pool.query(buildMonthlyAttendanceSummaryQuery(), [m]);
    // ط­ط³ط§ط¨ ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„طھط£ط®ظٹط± ظ„ظƒظ„ ظ…ظˆط¸ظپ ط¨ط¯ظ‚ط© (ط¯ظ‚ط§ط¦ظ‚ ظپط¹ظ„ظٹط©) - ط§ط³طھط¨ط¹ط§ط¯ ط£ظٹط§ظ… ط§ظ„ط¥ط¬ط§ط²ط© ظˆط§ظ„طµظپظˆظپ ط§ظ„ط؛ط§ظ…ط¶ط©
    // â•گâ•گâ•گ ظ‚ط±ط§ط± ط§ظ„ظ…ط§ظ„ظƒ (2026-09): ط§ظ„ط­ط³ط§ط¨ ط¹ظ„ظ‰ ط£ط³ط§ط³ آ«ط¥طھظ…ط§ظ… ط³ط§ط¹ط§طھ ط§ظ„ظˆط±ط¯ظٹط©آ» â•گâ•گâ•گ
    // ط§ظ„ظٹظˆظ… ظ…ظƒطھظ…ظ„ ط¥ط°ط§ ط§ظ„ظ…ظ†ظپظ‘ط° >= ظ…ط·ظ„ظˆط¨ ط§ظ„ظˆط±ط¯ظٹط© (shift_karim) â€” ط§ظ„طھط£ط®ظٹط± ط§ظ„ظ…ط¹طھظ…ط¯ =
    // ظ…ط§ ظ†ظ‚طµ ظ…ظ† ط§ظ„ط³ط§ط¹ط§طھ ط¨ط£ظٹ ط·ط±ظپ (طھط£ط®ظٹط± ط¯ط®ظˆظ„ ط£ظˆ ط§ظ†طµط±ط§ظپ ظ…ط¨ظƒط±)طŒ ظˆط§ظ„ط¯ط®ظˆظ„ ط§ظ„ظ…ط¨ظƒط±
    // ظٹط؛ط·ظٹ ط§ظ„ط§ظ†طµط±ط§ظپ ط§ظ„ظ…ط¨ظƒط±. ط§ظ„ط£ظٹط§ظ… ط§ظ„ظ…ظپطھظˆط­ط©/ط§ظ„ظ…ظƒط±ط±ط© طھظڈط¹ط±ط¶ آ«ظ‚ظٹط¯ ط§ظ„ظ…ط±ط§ط¬ط¹ط©آ» ظپظ‚ط·.
    const detailed = await pool.query(
        `SELECT a."employeeId", a.date, a."checkIn", a."checkOut", a.late, e.shift_start, e.shift_karim
           FROM attendance a JOIN employees e ON e.id=a."employeeId"
          WHERE e.status='active' AND a.date LIKE $1 || '-%' AND NOT COALESCE(a.on_leave, false)`, [m]);
    const toMin = (t) => { const mm = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return mm ? Number(mm[1]) * 60 + Number(mm[2]) : null; };
    const agg = new Map();
    // ط§ظ„ظ…ط·ظ„ظˆط¨ = ط¯ظˆط§ظ… ط§ظ„ط¨ط·ط§ظ‚ط© (shift_karim) â€” ط¨ظ„ط§ ط³ط¬ظ„ظ‘ ط³ط±ظٹط§ظ†: ط§ظ„ط­ط³ط§ط¨ ظ…ظ† ط§ظ„ط¨ط·ط§ظ‚ط© ظ…ط¨ط§ط´ط±ط©.
    for (const r of detailed.rows) {
        let a = agg.get(r.employeeId);
        if (!a) { a = { completeWorkDays: 0, shortDays: 0, deficitMinutes: 0, lateInDays: 0, reviewDays: 0 }; agg.set(r.employeeId, a); }
        if (r.late) { a.lateInDays += 1; } // ط¥ط­طµط§ط¦ظٹ: ط¯ط®ظˆظ„ ط¨ط¹ط¯ ط¨ط¯ط§ظٹط© ط§ظ„ظˆط±ط¯ظٹط© (ظ„ط§ ظٹط¹ظ†ظٹ ط¹ط¬ط²ظ‹ط§ ط¥ط°ط§ ط£ظƒظ…ظ„)
        const reqHours = Number(r.shift_karim);
        const required = (reqHours > 0 ? reqHours : 10) * 60;
        const ci = toMin(r.checkIn), co = toMin(r.checkOut);
        if (ci == null || co == null) { a.reviewDays += 1; continue; } // ظٹظˆظ… ظ…ظپطھظˆط­/ط¨ظٹط§ظ†ط§طھ ظ†ط§ظ‚طµط©
        let worked = co - ci; if (co < ci) { worked += 1440; } // ط§ظ„طھظپط§ظپ ط§ظ„ظˆط±ط¯ظٹط© ط§ظ„ظ„ظٹظ„ظٹط©
        if (worked === 0) { a.reviewDays += 1; continue; } // ط¨طµظ…ط© ظ…ظƒط±ط±ط© â†’ ظ‚ظٹط¯ ط§ظ„ظ…ط±ط§ط¬ط¹ط©
        // ط¨ظ„ط§ ط³ظ…ط§ط­ظٹط© (ظ‚ط±ط§ط± ط§ظ„ظ…ط§ظ„ظƒ 2026-11-02 آ«ط­طھظٹ ظپطھط±ظ‡ ط§ظ„ط³ظ…ط§ط­ ط´ظٹظ„ظ‡ط§آ»):
        // ط£ظٹ ط¯ظ‚ظٹظ‚ط© ظ†ظ‚طµ ط¹ظ† ط§ظ„ظˆط±ط¯ظٹط© = ظٹظˆظ… ظ†ط§ظ‚طµ ظˆط§ظ„ط¹ط¬ط² ظƒط§ظ…ظ„ ظ…ظ† ط£ظˆظ„ ط¯ظ‚ظٹظ‚ط©.
        if (worked >= required) { a.completeWorkDays += 1; }
        else { a.shortDays += 1; a.deficitMinutes += (required - worked); }
    }
    const out = { month: m, employees: rows.map(r => {
        const a = agg.get(r.id) || { completeWorkDays: 0, shortDays: 0, deficitMinutes: 0, lateInDays: 0, reviewDays: 0 };
        const empWorkDayMinutes = (Number(r.shift_karim) > 0 ? Number(r.shift_karim) : 10) * 60;
        return { ...r, workDayMinutes: empWorkDayMinutes, karimHours: Number((r.minutes / 60).toFixed(1)),
            completeWorkDays: a.completeWorkDays, shortDays: a.shortDays, deficitMinutes: a.deficitMinutes,
            deficitHours: Number((a.deficitMinutes / 60).toFixed(2)), lateInDays: a.lateInDays,
            // طھظˆط§ظپظ‚ ط£ط³ظ…ط§ط، ط§ظ„ظˆط§ط¬ظ‡ط© ط§ظ„ط³ط§ط¨ظ‚ط©: آ«ط§ظ„طھط£ط®ظٹط±آ» ط§ظ„ط¢ظ† = ط§ظ„ط¹ط¬ط² ط¹ظ† ط¥طھظ…ط§ظ… ط³ط§ط¹ط§طھ ط§ظ„ظˆط±ط¯ظٹط©
            lateMinutes: a.deficitMinutes, lateDays: a.shortDays,
            leaveDays: r.leave_days || 0, reviewDays: a.reviewDays, reviewMinutes: 0 };
    }) };
    // ظ…طھظˆط³ط· ط³ط§ط¹ط§طھ ظٹظˆظ… ط§ظ„ط¹ظ…ظ„ ظ„ظƒظ„ ط§ظ„ظ…ظˆط¸ظپظٹظ† (ظ„ظ„ط¹ط±ط¶ ظپظٹ ط±ط£ط³ ط§ظ„طھظ‚ط±ظٹط±)
    out.workDayMinutes = 600; // ط§ظپطھط±ط§ط¶ظٹ 10 ط³ط§ط¹ط§طھ
    if (detail) {
        const det = await pool.query(
            `SELECT a."employeeId", a.date, a."checkIn", a."checkOut", a."workMinutes", a.late, a.on_leave, e.shift_start, e.shift_karim
               FROM attendance a JOIN employees e ON e.id = a."employeeId"
              WHERE e.status = 'active' AND a.date LIKE $1 || '-%' ORDER BY a.date, e.name`, [m]);
        out.days = det.rows.map(r => ({ ...r, workMinutes: calculateMinutes(r), ...calculateDelayParts(r, r) }));
        // ط£ظٹط§ظ… ط§ظ„ط¥ط¬ط§ط²ط§طھ ط§ظ„ظ…ط¹طھظ…ط¯ط© ظ„ظƒظ„ ظ…ظˆط¸ظپ (ظ„ظ„ط¹ط±ط¶ آ«ط¥ط¬ط§ط²ط© ظ…ط¹طھظ…ط¯ط©آ» ط¨ط¯ظ„ آ«ظ„ط§ ظٹط¨طµظ…آ» â€” طھط¹ظ…ظ„ ط¹ظ„ظ‰ ط§ظ„ط¬ظˆط§ظ„ ط£ظٹط¶ظ‹ط§)
        const lvs = await pool.query(
            `SELECT "employeeId", "startDate", "endDate" FROM "leaveRequests"
              WHERE status = 'approved' AND "startDate" <= ($1 || '-31') AND "endDate" >= ($1 || '-01')`, [m]);
        const leaveDays = {};
        for (const l of lvs.rows) {
            const k = String(l.employeeId);
            leaveDays[k] = leaveDays[k] || [];
            for (const d of eachDate(new Date(`${l.startDate}T00:00:00Z`), new Date(`${l.endDate}T00:00:00Z`))) {
                if (String(d).slice(0, 7) === m) {leaveDays[k].push(d);}
            }
        }
        out.leaveDays = leaveDays;
    }
    res.json({ ok: true, ...out });
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_attendance_monthly]');
        res.status(500).json({ error: 'ATTENDANCE_MONTHLY_FAILED', message: 'طھط¹ط°ط± ط¬ظ„ط¨ ط§ظ„ظƒط´ظپ ط§ظ„ط´ظ‡ط±ظٹ' });
    }
});

/** طھط¯ظ‚ظٹظ‚ طµط§ط±ظ… ظ„ط³ظ„ط§ظ…ط© ط¨ظٹط§ظ†ط§طھ ط§ظ„ط­ط¶ظˆط± â€” ظ†ظپط³ ظپط­ظˆطµط§طھ scripts/strict-audit.js ظ„ظ„ظˆط§ط¬ظ‡ط© */
router.get('/strict-audit', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    try {
    const m = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : null;
    const { runStrictAudit } = require('./strict-audit-lib');
    const result = await runStrictAudit(m);
    res.json({ ok: result.ok, ...result });
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_strict_audit]');
        res.status(500).json({ error: 'STRICT_AUDIT_FAILED', message: 'طھط¹ط°ط± طھط´ط؛ظٹظ„ ط§ظ„طھط¯ظ‚ظٹظ‚ ط§ظ„طµط§ط±ظ…' });
    }
});

// â”€â”€â”€ ط­ظڈط°ظپ ظ…ط³ط§ط±ط§ آ«ظ…ط³ط­ QRآ» ظˆآ«ط¥ظ„ط؛ط§ط، ط§ظ„ط§ط³طھظƒظ…ط§ظ„آ» (ظ‚ط±ط§ط± ط§ظ„ظ…ط§ظ„ظƒ 2026-11-05): â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ظ…طµط¯ط±ط§ظ† ظپظ‚ط· ظ„ظ„ط­ط¶ظˆط±: ط¬ظ‡ط§ط² ط§ظ„ط¨طµظ…ط© ظˆظƒط§ظ…ظٹط±ط§ ط§ظ„طھط·ط¨ظٹظ‚ â€” ظ„ط§ ظ…ط³ط­ ط¨ط·ط§ظ‚ط©طŒ ظˆظ„ط§ ط§ط³طھظƒظ…ط§ظ„
// طھظ„ظ‚ط§ط¦ظٹطŒ ظˆظ„ط§ طھطµط­ظٹط­ ط¨ط§ظ„ط­ط°ظپ. ط§ظ„طھطµط­ظٹط­ط§طھ طھطھظ… ط¨ط¥ط¹ط§ط¯ط© ط§ظ„ط­ط³ط§ط¨ ظ…ظ† ط§ظ„ط¨طµظ…ط§طھ ط§ظ„ط®ط§ظ….

// â”€â”€â”€ طھظˆظ„ظٹط¯ ظ…ط³ظٹط± ط±ظˆط§طھط¨ ط´ظ‡ط± (admin/hr/manager) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ط£ط³ط§ط³ظٹ + ط£ظˆظپط±طھط§ظٹظ… ظ…ظ† ط§ظ„ط¨طµظ…ط§طھ (ظپظˆظ‚ ط³ط§ط¹ط§طھ ط§ظ„ظˆط±ط¯ظٹط©) + ط¹ظ„ط§ظˆط§طھ âˆ’ ط¬ط²ط§ط،ط§طھ/ط®طµظˆظ…ط§طھ âˆ’ ط£ظ‚ط³ط§ط· ط§ظ„ط³ظ„ظپ.
// idempotent: ط¥ط¹ط§ط¯ط© ط§ظ„طھظˆظ„ظٹط¯ ظ„ظ†ظپط³ ط§ظ„ط´ظ‡ط± طھط­ط¯ظ‘ط« ط§ظ„طµظپظˆظپ. ظٹظڈط±ط­ظ‘ظ„ ظ…ط­ط§ط³ط¨ظٹظ‹ط§ ط¹ط¨ط± /accounting/post-payroll.
router.post('/payroll-runs/generate', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    const month = String(req.body?.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {return res.status(422).json({ error: 'PAYROLL_MONTH_INVALID', message: 'ط§ظ„ط´ظ‡ط± ط¨طµظٹط؛ط© YYYY-MM' });}
    const [year, mon] = month.split('-').map(Number);
    if (mon < 1 || mon > 12) {return res.status(422).json({ error: 'PAYROLL_MONTH_INVALID', message: 'ط´ظ‡ط± ط؛ظٹط± طµط§ظ„ط­' });}
    // V6 Phase 3 (decision #7): ط¥ط¹ط§ط¯ط© طھظˆظ„ظٹط¯ ط´ظ‡ط± ظ…ظ‚ظپظ„ ظ…ظ…ظ†ظˆط¹ط© â€” طھط­ظ…ظٹ ط§ظ„ظ…ط³ظٹط± ط§ظ„ظ…ط¹طھظ…ط¯.
    // FIX 2026-10-11 (C25): moved period-closed + already-posted checks INSIDE the
    // transaction â€” were outside with fail-open catch, so a DB error on the control
    // query let posted payroll be regenerated (TOCTOU + fail-open).
    const includeOvertime = req.body?.includeOvertime === true;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Period-closed check (inside txn, fail-closed)
        // FIX 2026-11-06 (A3): ظƒط§ظ† `WHERE month=$1 AND status='closed'` ط¹ظ„ظ‰ ط£ط¹ظ…ط¯ط©
        // ظ„ط§ ظˆط¬ظˆط¯ ظ„ظ‡ط§ â€” accounting_periods ط£ط¹ظ…ط¯طھظ‡ط§ period/closed â€” ظپظٹظپط´ظ„ ط§ظ„ط§ط³طھط¹ظ„ط§ظ…
        // ط¨ظ€ 42703 ط¯ط§ط®ظ„ ط§ظ„ظ…ط¹ط§ظ…ظ„ط© ط«ظ… ظٹظڈط¬ظ‡ط¶ طھظˆظ„ظٹط¯ ط§ظ„ظ…ط³ظٹط± ظƒط§ظ…ظ„ظ‹ط§ (fail-closed طµط­ظٹط­
        // ط§ظ„ظ†طھظٹط¬ط© ظ„ظƒظ† ط¨ظ„ط§ ط£ظٹ ظپطھط±ط© ظ…ظ‚ظپظ„ط©). ط§ظ„ظ…ط³ط§ط± ط§ظ„ط¢ظ† ظ†ظپط³ ط£ط¯ط§ط© ط§ظ„ظ‚ظپظ„ ط§ظ„ط°ط±ظ‘ظٹط©.
        try {
            await require('./accounting-periods').assertPeriodOpenInTx(client, `${month}-01`);
        } catch (periodErr) {
            await client.query('ROLLBACK');
            if (periodErr && periodErr.statusCode === 423) {
                return res.status(423).json({ error: 'PERIOD_LOCKED', message: `ط§ظ„ظپطھط±ط© ${month} ظ…ظ‚ظپظ„ط© ظ…ط­ط§ط³ط¨ظٹظ‹ط§ â€” ظ„ط§ ظٹظ…ظƒظ† ط¥ط¹ط§ط¯ط© طھظˆظ„ظٹط¯ ط§ظ„ط±ظˆط§طھط¨ (ط£ط¹ط¯ ظپطھط­ ط§ظ„ظپطھط±ط© ط£ظˆظ„ظ‹ط§)` });
            }
            throw periodErr; // fail-closed: طھط¹ط°ظ‘ط± ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط­ط§ظ„ط© ط§ظ„ظپطھط±ط© â‡’ ط±ظپط¶
        }
        // Already-posted check (inside txn, fail-closed)
        try {
            const _je = (await client.query(
                "SELECT 1 FROM journal_entries WHERE source_type='payroll' AND source_id=$1 AND status='posted' LIMIT 1", [month])).rows[0];
            if (_je) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'PAYROLL_ALREADY_POSTED', message: `ط±ظˆط§طھط¨ ${month} ظ…ظڈط±ط­ظ‘ظ„ط© ظ…ط­ط§ط³ط¨ظٹظ‹ط§ â€” ط¥ط¹ط§ط¯ط© ط§ظ„طھظˆظ„ظٹط¯ ط³طھط¨ط·ظ„ ظ…ط·ط§ط¨ظ‚ط© ط§ظ„ظ‚ظٹط¯. ط±ط§ط¬ط¹ ط§ظ„ظ…ط§ظ„ظٹط© ط£ظˆظ„ظ‹ط§.` });
            }
        } catch (jeErr) {
            await client.query('ROLLBACK');
            throw jeErr; // fail-closed
        }
        const emps = (await client.query(
            `SELECT id, name, salary, shift_start, shift_karim FROM employees WHERE status = 'active' ORDER BY id`)).rows;
        const detail = [];
        let tBasic = 0, tOt = 0, tBonus = 0, tPen = 0, tAdv = 0, tNet = 0;
        for (const emp of emps) {
            const basic = Number(emp.salary || 0);
            const sHours = Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10;
            // ط§ظ„ط£ظˆظپط±طھط§ظٹظ… ط§ط®طھظٹط§ط±ظٹ â€” ظٹط­ط³ط¨ ط¨ط³ ظ„ظˆ ط§ظ„ط£ط¯ظ…ظ† ط­ط·ظ‡ (ظ…ظ† ط§ظ„ط¨طµظ…ط§طھ)
            const att = (await client.query(
                `SELECT "workMinutes", date FROM attendance
                  WHERE "employeeId" = $1 AND date LIKE $2 AND "checkIn" IS NOT NULL AND "checkOut" IS NOT NULL`,
                [emp.id, `${month}-%`])).rows;
            const daysPresent = att.length;
            let otMinutes = 0;
            let overtimePay = 0;
            if (includeOvertime) {
                for (const a of att) {
                    const w = Number(a.workMinutes);
                    if (!Number.isFinite(w)) {continue;}
                    const exp = Math.round(sHours * 60);
                    if (w > exp) {
                        otMinutes += w - exp;
                        overtimePay += ((w - exp) / 60) * (sHours > 0 ? basic / 30 / sHours : 0);
                    }
                }
                overtimePay = Math.round(overtimePay * 100) / 100;
            }
            // ط§ظ„ط¬ط²ط§ط،ط§طھ/ط§ظ„ط¹ظ„ط§ظˆط§طھ ط§ظ„ط´ظ‡ط±ظٹط©
            const adj = (await client.query(
                `SELECT kind, COALESCE(SUM(amount),0)::numeric(14,2) AS t FROM payroll_adjustments
                  WHERE "employeeId" = $1 AND month = $2 GROUP BY kind`, [emp.id, month])).rows;
            let bonus = 0, penalty = 0;
            for (const a of adj) {
                if (a.kind === 'bonus' || a.kind === 'allowance') {bonus += Number(a.t);}
                else {penalty += Number(a.t);}
            }
            // ط£ظ‚ط³ط§ط· ط§ظ„ط³ظ„ظپ ط§ظ„ظ†ط´ط·ط© â€” ظ‚ط³ط· ظˆط§ط­ط¯ ط´ظ‡ط±ظٹظ‹ط§ ظ…ظ‡ظ…ط§ ط£ظڈط¹ظٹط¯ ط§ظ„طھظˆظ„ظٹط¯
            const advs = (await client.query(
                `SELECT id, monthly_deduction, remaining FROM salary_advances
                  WHERE "employeeId" = $1 AND status = 'active' AND remaining > 0 ORDER BY id`, [emp.id])).rows;
            let advDed = 0;
            for (const a of advs) {
                const inst = Math.min(Number(a.monthly_deduction) > 0 ? Number(a.monthly_deduction) : Number(a.remaining), Number(a.remaining));
                if (inst <= 0) {continue;}
                const applied = await client.query(
                    `INSERT INTO advance_applications (advance_id, month, amount) VALUES ($1,$2,$3)
                     ON CONFLICT (advance_id, month) DO NOTHING RETURNING advance_id`,
                    [a.id, month, inst]);
                if (!applied.rows[0]) {continue;} // ظ…ط·ط¨ظ‘ظ‚ ظ…ط³ط¨ظ‚ظ‹ط§ ظ„ظ‡ط°ط§ ط§ظ„ط´ظ‡ط± â€” ظ„ط§ ط®طµظ… ظ…ظƒط±ط±
                const left = Math.round((Number(a.remaining) - inst) * 100) / 100;
                await client.query(`UPDATE salary_advances SET remaining = $2, status = $3 WHERE id = $1`,
                    [a.id, left, left <= 0 ? 'closed' : 'active']);
            }
            // ط¥ط¬ظ…ط§ظ„ظٹ ط£ظ‚ط³ط§ط· ط§ظ„ط´ظ‡ط± = ظƒظ„ ط§ظ„طھط·ط¨ظٹظ‚ط§طھ ط§ظ„ظ…ط³ط¬ظ„ط© ظ„ظ‡ط°ط§ ط§ظ„ط´ظ‡ط± (ط¥ط¹ط§ط¯ط© ط§ظ„طھظˆظ„ظٹط¯ طھط¹ظٹط¯ ظ†ظپط³ ط§ظ„ط£ط±ظ‚ط§ظ…)
            const advSum = await client.query(
                `SELECT COALESCE(SUM(aa.amount),0)::numeric(12,2) AS t FROM advance_applications aa
                  JOIN salary_advances sa ON sa.id = aa.advance_id
                  WHERE sa."employeeId" = $1 AND aa.month = $2`, [emp.id, month]);
            advDed = Math.round(Number(advSum.rows[0]?.t || 0) * 100) / 100;
            const allowances = Math.round((overtimePay + bonus) * 100) / 100;
            const deductions = Math.round((penalty + advDed) * 100) / 100;
            const net = Math.round((basic + allowances - deductions) * 100) / 100;
            const eid = Date.now() * 1000 + Math.floor(Math.random() * 1000) + emp.id % 1000;
            // idempotent: ط­ط¯ظ‘ط« طµظپ ط§ظ„ط´ظ‡ط± ط¥ظ† ظˆظڈط¬ط¯ ظˆط¥ظ„ط§ ط£ظ†ط´ط¦ظ‡ (ط¨ظ„ط§ ظ‚ظٹط¯ ظپط±ظٹط¯ ط¬ط¯ظٹط¯)
            const prior = await client.query(
                `SELECT id FROM payroll WHERE "employeeId" = $1 AND month = $2 ORDER BY id LIMIT 1`,
                [emp.id, month]);
            if (prior.rows[0]) {
                await client.query(
                    `UPDATE payroll SET "basicSalary" = $2, allowances = $3, deductions = $4, "netSalary" = $5, status = 'posted', year = $6
                      WHERE id = $1`,
                    [prior.rows[0].id, basic, allowances, deductions, net, year]);
            } else {
                await client.query(
                    `INSERT INTO payroll (id, "employeeId", month, year, "basicSalary", allowances, deductions, "netSalary", status)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'posted')`,
                    [eid, emp.id, month, year, basic, allowances, deductions, net]);
            }
            tBasic += basic; tOt += overtimePay; tBonus += bonus; tPen += penalty; tAdv += advDed; tNet += net;
            detail.push({ employeeId: emp.id, name: emp.name, daysPresent, otMinutes, basic, overtimePay, bonus, penalty, advanceDeduction: advDed, net });
        }
        await client.query(
            `INSERT INTO payroll_runs (month, status, employee_count, total_basic, total_overtime, total_bonuses, total_penalties, total_advances, total_net, created_by)
             VALUES ($1,'posted',$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (month) DO UPDATE SET status = 'posted', employee_count = $2, total_basic = $3,
               total_overtime = $4, total_bonuses = $5, total_penalties = $6, total_advances = $7, total_net = $8, created_by = $9`,
            [month, emps.length, Math.round(tBasic * 100) / 100, Math.round(tOt * 100) / 100, Math.round(tBonus * 100) / 100,
                Math.round(tPen * 100) / 100, Math.round(tAdv * 100) / 100, Math.round(tNet * 100) / 100, req.user.id]);
        await client.query('COMMIT');
        res.json({
            ok: true, month, count: emps.length,
            totals: { basic: tBasic, overtime: tOt, bonuses: tBonus, penalties: tPen, advances: tAdv, net: tNet },
            detail,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_payroll_run]');
        res.status(500).json({ error: 'PAYROLL_RUN_FAILED', message: 'طھط¹ط°ط± طھظˆظ„ظٹط¯ ط§ظ„ظ…ط³ظٹط±' });
    } finally { client.release(); }
});

/** طھط­ظ‚ظ‚ ظ…ط®طھطµط± ظ…ظ† ط¨ط·ط§ظ‚ط© ظ…ظˆط¸ظپ (QR ط§ظ„ط¬ط¯ظٹط¯ ط§ظ„ط®ظپظٹظپ) â€” GET /card/v/<cardId>.<sig16>
 * ظ†ظپط³ ط§ظ„ط£ظ…ط§ظ†: sig16 = ط£ظˆظ„ 16 hex ظ…ظ† HMAC(cardId) â€” ظˆط§ظ„طھط­ظ‚ظ‚ ط§ظ„ظƒط§ظ…ظ„ ظ…ظ† DB.
 * ط§ظ„ط¨ط·ط§ظ‚ط§طھ ط§ظ„ظ‚ط¯ظٹظ…ط© (d/s) طھط¹ظ…ظ„ ظƒظ…ط§ ظ‡ظٹ â€” ظ„ط§ ظƒط³ط± ظ„ظ„ط®ظ„ظپ. */
router.get('/card/v/:code', cardVerifyLimiter, async (req, res) => {
    try {
        if (!QR_SECRET) {return res.status(503).send('ط§ظ„طھط­ظ‚ظ‚ ط؛ظٹط± ظ…ظ‡ظٹط£');}
        const parts = String(req.params.code || '').split('.');
        if (parts.length !== 2 || !parts[0] || !/^[0-9a-f]{16}$/i.test(parts[1])) {
            return res.status(400).send('ط±ظ…ط² ط؛ظٹط± طµط§ظ„ط­');
        }
        const [cardId, shortSig] = parts;
        const expect = crypto.createHmac('sha256', QR_SECRET)
            .update(String(cardId), 'utf8').digest('hex').slice(0, 16);
        if (!crypto.timingSafeEqual(Buffer.from(shortSig.toLowerCase()), Buffer.from(expect))) {
            return res.status(403).send('طھظˆظ‚ظٹط¹ ط؛ظٹط± طµط§ظ„ط­ â€” ط¨ط·ط§ظ‚ط© ظ…ط²ظˆط±ط© ظ…ط­طھظ…ظ„ط©');
        }
        const emp = (await pool.query(
            `SELECT e.name, e."employeeId", e.department, e.position, e.status,
                    h.name AS dept_name, e."cardStatus", e."cardIssuedAt"
               FROM employees e LEFT JOIN "hrDepartments" h ON h.code = e.department
              WHERE e."cardId" = $1 LIMIT 1`, [String(cardId)])).rows[0];
        if (!emp) {return res.status(404).send('ط§ظ„ظ…ظˆط¸ظپ ط؛ظٹط± ظ…ظˆط¬ظˆط¯');}
        req.query.d = Buffer.from(JSON.stringify({
            eid: String(emp.employeeId), cid: String(cardId), v: 2, t: 'short',
        })).toString('base64url');
        req.query.s = 'short';
        req.shortVerified = emp;
        return shortVerifyRender(req, res);
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_card_verify_short]');
        res.status(500).send('طھط¹ط°ط± ط§ظ„طھط­ظ‚ظ‚ ط­ط§ظ„ظٹظ‹ط§');
    }
});

function shortVerifyRender(req, res) {
    const emp = req.shortVerified;
    const active = emp.status === 'active' && (emp.cardStatus || 'active') === 'active';
    const logoB64 = (() => { try {
        return require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'assets', 'karim-logo.png')).toString('base64');
    } catch (_) { return ''; } })();
    res.type('html').send(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>طھط­ظ‚ظ‚ ط¨ط·ط§ظ‚ط© ظ…ظˆط¸ظپ â€” ظ…ط·ط§ط¹ظ… ط§ظ„ط´ط±ظپظ‡ ط§ظ„ط¹ط§ظ„ظ…ظٹ</title>
<style>body{font-family:'Cairo',Arial,sans-serif;background:linear-gradient(135deg,#061627,#0A2540 45%,#16307E);color:#fff;margin:0;padding:24px;text-align:center;min-height:100vh}
.brand{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:4px}
.brand img{width:76px;height:76px;object-fit:contain;background:#fff;border:2px solid #C9A961;border-radius:50%;padding:6px;box-shadow:0 0 18px rgba(201,169,97,.55)}
.brand .t{text-align:right}.brand .t b{display:block;font-size:22px;color:#F3DFA8}.brand .t span{font-size:12px;letter-spacing:2px;color:#fff;opacity:.9}
.card{max-width:420px;margin:20px auto;background:#FAFAFA;color:#1a1a1a;border-radius:16px;padding:28px 22px;box-shadow:0 12px 40px rgba(0,0,0,.4);border-top:6px solid #C9A961}
h1{color:#0A2540;margin:10px 0 2px;font-size:22px}.co{color:#8a6d2f;font-size:13px;font-weight:700}
.badge{display:inline-block;margin:12px 0;padding:8px 26px;border-radius:20px;font-weight:800;font-size:16px}
.ok{background:#e6f7ec;color:#0e7a3d}.no{background:#fdeaea;color:#b42323}
.row{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:8px 2px;font-size:14px}
.row b{color:#0A2540}.meta{color:#6b7280;font-size:12px;margin-top:14px}</style></head><body>
<div class="brand">
${logoB64 ? `<img src="data:image/png;base64,${logoB64}" alt="ط´ط¹ط§ط± ظ…ط·ط§ط¹ظ… ط§ظ„ط´ط±ظپظ‡ ط§ظ„ط¹ط§ظ„ظ…ظٹ">` : ''}
<div class="t"><b>ظ…ط·ط§ط¹ظ… ط§ظ„ط´ط±ظپظ‡ ط§ظ„ط¹ط§ظ„ظ…ظٹ</b><span>AL SHORFA RESTAURANTS â€” طھط­ظ‚ظ‚ ط§ظ„ط¨ط·ط§ظ‚ط§طھ</span></div>
</div><div class="card">
<h1>${esc(emp.name)}</h1>
<div class="co">${esc(emp.position)} â€¢ ${esc(emp.dept_name || emp.department)}</div>
<div><span class="badge ${active ? 'ok' : 'no'}">${active ? 'âœ“ ط¨ط·ط§ظ‚ط© ط³ط§ط±ظٹط© ظˆظ…ظˆط¸ظپ ظ†ط´ط·' : 'âœ• ط؛ظٹط± ط³ط§ط±ظٹط©'}</span></div>
<div class="row"><span>ط±ظ‚ظ… ط§ظ„ظ…ظˆط¸ظپ</span><b>${esc(emp.employeeId)}</b></div>
<div class="row"><span>ط¥طµط¯ط§ط± ط§ظ„ط¨ط·ط§ظ‚ط©</span><b>${emp.cardIssuedAt ? esc(String(emp.cardIssuedAt).slice(0, 10)) : ''}</b></div>
<div class="meta">طھظ… ط§ظ„طھط­ظ‚ظ‚ ظ„ط­ط¸ظٹظ‹ط§ ظ…ظ† ظ†ط¸ط§ظ… Karim ERP â€” ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))}</div>
</div></body></html>`);
}

/** طھط­ظ‚ظ‚ ط¹ط§ظ… ظ…ظ† ط¨ط·ط§ظ‚ط© ظ…ظˆط¸ظپ (ظ…ط³ط­ QR) â€” ط¨ظٹط§ظ†ط§طھ ط¹ط§ظ…ط© ظپظ‚ط·طŒ ط¨طھظˆظ‚ظٹط¹ HMAC.
 * SECURITY: ط§ظ„ط§ط³طھط¹ظ„ط§ظ… ظٹط±ط¨ط· ظƒط§ظ…ظ„ ظ‡ظˆظٹط© ط§ظ„ط¨ط·ط§ظ‚ط© (employeeId + cardId + qrVersion +
 * qrTokenHash) â€” ظƒط§ظ† ظٹظƒظپظٹ employeeId ظپظ‚ط· ظپظٹط¨ظ‚ظ‰ ط±ط§ط¨ط· ظ…ط³ط±ظˆظ‚ طµط§ظ„ط­ظ‹ط§ ظ„ظ„ط£ط¨ط¯ ط­طھظ‰ ط¨ط¹ط¯
 * طھط¬ط¯ظٹط¯ ط§ظ„ط¨ط·ط§ظ‚ط© ط£ظˆ ط¥ط¨ط·ط§ظ„ظ‡ط§. */
router.get('/card/verify', cardVerifyLimiter, async (req, res) => {
    try {
        const d = String(req.query.d || '');
        const s = String(req.query.s || '');
        let p = null;
        try { p = JSON.parse(Buffer.from(d, 'base64url').toString('utf8')); } catch (_) { p = null; }
        if (!p || !p.eid || !p.t || !p.cid) {return res.status(400).send('ط±ظ…ط² ط؛ظٹط± طµط§ظ„ط­');}
        const expect = crypto.createHmac('sha256', QR_SECRET)
            .update(`${p.eid}|${p.cid}|${p.v}|${p.t}`, 'utf8').digest('hex');
        // timingSafeEqual ظٹط±ظ…ظٹ RangeError ط¹ظ†ط¯ ط§ط®طھظ„ط§ظپ ط§ظ„ط·ظˆظ„ â€” ط§ظپط­طµ ط§ظ„طµظٹط؛ط© ط£ظˆظ„ظ‹ط§
        // ط­طھظ‰ ظ„ط§ ظٹطھط­ظˆظ„ طھظˆظ‚ظٹط¹ ظ…ط´ظˆظ‡ ط¥ظ„ظ‰ 500.
        if (!/^[a-f0-9]{64}$/i.test(s)) {return res.status(403).send('طھظˆظ‚ظٹط¹ ط؛ظٹط± طµط§ظ„ط­ â€” ط¨ط·ط§ظ‚ط© ظ…ط²ظˆط±ط© ظ…ط­طھظ…ظ„ط©');}
        if (!crypto.timingSafeEqual(Buffer.from(s.toLowerCase()), Buffer.from(expect))) {
            return res.status(403).send('طھظˆظ‚ظٹط¹ ط؛ظٹط± طµط§ظ„ط­ â€” ط¨ط·ط§ظ‚ط© ظ…ط²ظˆط±ط© ظ…ط­طھظ…ظ„ط©');
        }
        const emp = (await pool.query(
            `SELECT e.name, e."employeeId", e.department, e.position, e.status,
                    h.name AS dept_name, e."cardStatus", e."cardIssuedAt"
               FROM employees e LEFT JOIN "hrDepartments" h ON h.code = e.department
              WHERE e."employeeId" = $1 AND e."cardId" = $2
                AND e."qrVersion" = $3::int AND e."qrTokenHash" = $4
                AND e.status = 'active' AND e."cardStatus" = 'active'`,
            [String(p.eid), String(p.cid), Number(p.v) || -1, hashToken(String(p.t))])).rows[0];
        if (!emp) {return res.status(404).send('ط§ظ„ط¨ط·ط§ظ‚ط© ط؛ظٹط± طµط§ظ„ط­ط© ط£ظˆ طھظ… طھط¬ط¯ظٹط¯ظ‡ط§');}
        const active = emp.status === 'active' && (emp.cardStatus || 'active') === 'active';
        const logoB64 = (() => { try {
            return require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'assets', 'karim-logo.png')).toString('base64');
        } catch (_) { return ''; } })();
        res.type('html').send(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>طھط­ظ‚ظ‚ ط¨ط·ط§ظ‚ط© ظ…ظˆط¸ظپ â€” ظ…ط·ط§ط¹ظ… ط§ظ„ط´ط±ظپظ‡ ط§ظ„ط¹ط§ظ„ظ…ظٹ</title>
<style>body{font-family:'Cairo',Arial,sans-serif;background:linear-gradient(135deg,#061627,#0A2540 45%,#16307E);color:#fff;margin:0;padding:24px;text-align:center;min-height:100vh}
.brand{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:4px}
.brand img{width:76px;height:76px;object-fit:contain;background:#fff;border:2px solid #C9A961;border-radius:50%;padding:6px;box-shadow:0 0 18px rgba(201,169,97,.55)}
.brand .t{text-align:right}.brand .t b{display:block;font-size:22px;color:#F3DFA8}.brand .t span{font-size:12px;letter-spacing:2px;color:#fff;opacity:.9}
.card{max-width:420px;margin:20px auto;background:#FAFAFA;color:#1a1a1a;border-radius:16px;padding:28px 22px;box-shadow:0 12px 40px rgba(0,0,0,.4);border-top:6px solid #C9A961}
.logo{width:64px;height:64px;object-fit:contain;background:#fff;border:1px solid #C9A961;border-radius:12px;padding:4px}
h1{color:#0A2540;margin:10px 0 2px;font-size:22px}.co{color:#8a6d2f;font-size:13px;font-weight:700}
.badge{display:inline-block;margin:12px 0;padding:8px 26px;border-radius:20px;font-weight:800;font-size:16px}
.ok{background:#e6f7ec;color:#0e7a3d}.no{background:#fdeaea;color:#b42323}
.row{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:8px 2px;font-size:14px}
.row b{color:#0A2540}.meta{color:#6b7280;font-size:12px;margin-top:14px}</style></head><body>
<h2 style="display:none">طھط­ظ‚ظ‚</h2><div class="brand">
${logoB64 ? `<img src="data:image/png;base64,${logoB64}" alt="ط´ط¹ط§ط± ظ…ط·ط§ط¹ظ… ط§ظ„ط´ط±ظپظ‡ ط§ظ„ط¹ط§ظ„ظ…ظٹ">` : ''}
<div class="t"><b>ظ…ط·ط§ط¹ظ… ط§ظ„ط´ط±ظپظ‡ ط§ظ„ط¹ط§ظ„ظ…ظٹ</b><span>AL SHORFA RESTAURANTS â€” طھط­ظ‚ظ‚ ط§ظ„ط¨ط·ط§ظ‚ط§طھ</span></div>
</div><div class="card">
${logoB64 ? `<img class="logo" src="data:image/png;base64,${logoB64}">` : ''}
<h1>${esc(emp.name)}</h1>
<div class="co">${esc(emp.position)} â€¢ ${esc(emp.dept_name || emp.department)}</div>
<div><span class="badge ${active ? 'ok' : 'no'}">${active ? 'âœ“ ط¨ط·ط§ظ‚ط© ط³ط§ط±ظٹط© ظˆظ…ظˆط¸ظپ ظ†ط´ط·' : 'âœ• ط؛ظٹط± ط³ط§ط±ظٹط©'}</span></div>
<div class="row"><span>ط±ظ‚ظ… ط§ظ„ظ…ظˆط¸ظپ</span><b>${esc(emp.employeeId)}</b></div>
<div class="row"><span>ط¥طµط¯ط§ط± ط§ظ„ط¨ط·ط§ظ‚ط©</span><b>${emp.cardIssuedAt ? esc(String(emp.cardIssuedAt).slice(0, 10)) : ''}</b></div>
<div class="meta">طھظ… ط§ظ„طھط­ظ‚ظ‚ ظ„ط­ط¸ظٹظ‹ط§ ظ…ظ† ظ†ط¸ط§ظ… Karim ERP â€” ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))}</div>
</div></body></html>`);
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_card_verify]');
        res.status(500).send('طھط¹ط°ط± ط§ظ„طھط­ظ‚ظ‚ ط­ط§ظ„ظٹظ‹ط§');
    }
});

// â”€â”€â”€ ط¯ظپطھط± ط§ظ„ظ…ظˆط¸ظپظٹظ† â€” ظ‚ط§ط¦ظ…ط© ط´ط§ظ…ظ„ط© ط¨ط¬ظ…ظٹط¹ ط§ظ„ط­ط³ط§ط¨ط§طھ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/employees/ledger', jwtAuth, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        const searchTerm = req.query.search ? `%${req.query.search}%` : null;
        let query = `SELECT e.id, e.name, e."employeeId", e.position, e.status, e.phone, e.email,
                    e."joinDate", e.salary, e.department, e.shift_start, e.shift_karim,
                    e."digitalFingerprint", e."cardId", e."cardIssuedAt", e."cardStatus",
                    u.username, u.role,
                    COALESCE(a.total_records,0) AS total_punches
             FROM employees e
             LEFT JOIN users u ON u.id = e."userId"
             LEFT JOIN (
                 SELECT "employeeId", COUNT(*) AS total_days,
                        COUNT(*) AS total_records
                 FROM attendance WHERE "checkInAt" >= NOW() - INTERVAL '30 days'
                 GROUP BY "employeeId"
             ) a ON a."employeeId" = e.id`;
        const params = [];
                let paramIndex = 0;
                if (searchTerm) {
                    // ط°ظƒط§ط، ط§ظ„ط¨ط­ط« ط§ظ„ط¹ط±ط¨ظٹ 2026-10-06: ط§ظ„ط§ط³ظ… ط¨ط¹ط§ط¦ظ„ط§طھ ط§ظ„ط­ط±ظˆظپ ط§ظ„ظ…طھط´ط§ط¨ظ‡ط©طŒ ظˆط§ظ„ط±ظ‚ظ…/ط§ظ„ظ‡ط§طھظپ ط­ط±ظپظٹظ‹ط§
                    params.push(arFuzzyPattern(searchTerm));
                    params.push(searchTerm);
                    query += ` WHERE (e.name ~* $${paramIndex + 1} OR e."employeeId" ILIKE $${paramIndex + 2} OR e.phone ILIKE $${paramIndex + 2})`;
                    paramIndex += 2;
                }
                query += ` ORDER BY e.id ASC LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`;
                params.push(limit, offset);
        const { rows: employees } = await pool.query(query, params);
        const { rows: [countRow] } = await pool.query(`SELECT COUNT(*)::int AS total FROM employees`);
        res.json({ ok:true, employees, total: countRow.total, page, limit });
    } catch (error) {
            logger.error({ err: { message: (error && error.message) || String(error), stack: (error && error.stack) || null } }, '[hr/ledger]');
            res.status(500).json({ error: 'LEDGER_FAILED', message: 'طھط¹ط°ط± ط¬ظ„ط¨ ط¯ظپطھط± ط§ظ„ظ…ظˆط¸ظپظٹظ†' });
        }
});

// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
// ظ…ط­ط±ظƒ ط®طµظˆظ…ط§طھ ط§ظ„ط§ظ„طھط²ط§ظ… ط¨ط§ظ„ط¯ظˆط§ظ… â€” طھط£ط®ظٹط± + ط؛ظٹط§ط¨ ظ…ط³طھظ†ط¨ط·ط§ظ† ظ…ظ† ط§ظ„ط¨طµظ…ط§طھ ظˆط§ظ„ط¥ط¬ط§ط²ط§طھ
// ط§ظ„ط³ظٹط§ط³ط©: ظٹظˆظ… ط§ظ„ط؛ظٹط§ط¨ = ط§ظ„ط±ط§طھط¨/30 â€¢ ط¯ظ‚ظٹظ‚ط© ط§ظ„طھط£ط®ظٹط± = (ط§ظ„ط±ط§طھط¨/30/ط¯ظ‚ط§ط¦ظ‚ ظٹظˆظ… ط§ظ„ط¹ظ…ظ„)
// ط§ظ„ط¨ظ†ظˆط¯ ط§ظ„ط¢ظ„ظٹط© طھط­ظ…ظ„ ط¨ط§ط¯ط¦ط© آ«âں¨ط¢ظ„ظٹâں©آ» ظپظٹ ط§ظ„ط³ط¨ط¨ â€” ط¥ط¹ط§ط¯ط© ط§ظ„طھط·ط¨ظٹظ‚ طھط³طھط¨ط¯ظ„ظ‡ط§ ط¯ظˆظ† طھظƒط±ط§ط±
// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
const AUTO_DEDUCTION_MARK = 'âں¨ط¢ظ„ظٹâں© ط®طµظ… ط§ظ„طھط²ط§ظ… ط§ظ„ط¯ظˆط§ظ…';

function monthBounds(month) {
    const [y, m] = month.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0));
    return { start, end, daysInMonth: end.getUTCDate() };
}

function eachDate(start, end) {
    const out = [];
    for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}

async function computeMonthDeductions(month, { skipFridays = false } = {}) {
    const { start, end } = monthBounds(month);
    const todayStr = new Date().toISOString().slice(0, 10);
    const emps = (await pool.query(
        `SELECT id, name, "employeeId", salary, shift_karim, day_off, "joinDate" FROM employees WHERE status = 'active' ORDER BY id`)).rows;

    const att = (await pool.query(
        `SELECT "employeeId", date, "checkIn", "checkOut" FROM attendance
          WHERE date >= $1 AND date <= $2 AND "checkIn" IS NOT NULL`,
        [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)])).rows;
    const attByEmp = new Map();
    for (const a of att) {
        if (!attByEmp.has(a.employeeId)) {attByEmp.set(a.employeeId, []);}
        attByEmp.get(a.employeeId).push(a);
    }

    // ط§ظ„ط¥ط¬ط§ط²ط§طھ ط§ظ„ظ…ط¹طھظ…ط¯ط© ط§ظ„ظ…طھظ‚ط§ط·ط¹ط© ظ…ط¹ ط§ظ„ط´ظ‡ط± â€” طھظڈط؛ط·ظٹ ط£ظٹط§ظ…ظ‡ط§ ظ…ظ† ط§ط­طھط³ط§ط¨ ط§ظ„ط؛ظٹط§ط¨
    const leaves = (await pool.query(
        `SELECT "employeeId", "startDate", "endDate" FROM "leaveRequests"
          WHERE status = 'approved' AND "startDate" <= $2 AND "endDate" >= $1`,
        [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)])).rows;
    const leaveByEmp = new Map();
    for (const l of leaves) {
        if (!leaveByEmp.has(l.employeeId)) {leaveByEmp.set(l.employeeId, new Set());}
        for (const d of eachDate(new Date(`${l.startDate}T00:00:00Z`), new Date(`${l.endDate}T00:00:00Z`))) {
            leaveByEmp.get(l.employeeId).add(d);
        }
    }

    const empIds = emps.map(e => e.id);
    const priorAuto = empIds.length ? (await pool.query(
        `SELECT "employeeId", kind, COALESCE(SUM(amount),0)::numeric(12,2) AS total FROM payroll_adjustments
          WHERE month = $1 AND reason LIKE $2 GROUP BY "employeeId", kind`,
        [month, `${AUTO_DEDUCTION_MARK}%`])).rows : [];

    // طھط§ط±ظٹط® ط³ط±ظٹط§ظ† ط§ظ„ط¯ظˆط§ظ… (087) â€” ظٹطھظ‚ط¯ظ‘ظ… ط¹ظ„ظ‰ ط¨ط·ط§ظ‚ط© ط§ظ„ظ…ظˆط¸ظپ ظپظٹ ط§ط­طھط³ط§ط¨ ط§ظ„ط±ط§ط­ط© ط§ظ„ط£ط³ط¨ظˆط¹ظٹط©:
    // day_off ط§ظ„ظپط¹ظ‘ط§ظ„ ظ„ظٹظˆظ… d = ط£ط­ط¯ط« طµظپ â‰¤ d ظ…ظˆط¬ظˆط¯ ظپظٹ employee_shift_historyطŒ ظˆط¥ظ„ط§ ط§ظ„ط¨ط·ط§ظ‚ط©.
    // (طµظپ 2000-01-01 آ«طھط§ط±ظٹط® ط§ظ„ط³ط±ظٹط§ظ† ط§ظ„ط£طµظ„ظٹآ» ظ…ط³طھط¨ط¹ط¯ ظƒظ…ط§ ظپظٹ ط¨ط§ظ‚ظٹ ط§ظ„ظ…ط³ط§ط±ط§طھ â€” ظٹط؛ط·ظٹ ط§ظ„ظٹظˆظ… ظ†ظپط³ظ‡).
    const shiftHist = empIds.length ? (await pool.query(
        `SELECT employee_id, day_off, effective_from::text AS effective_from
           FROM employee_shift_history
          WHERE employee_id = ANY($1::bigint[])
            AND effective_from <> DATE '2000-01-01'
          ORDER BY employee_id, effective_from`, [empIds])).rows : [];
    const histByEmp = new Map();
    for (const h of shiftHist) {
        const list = histByEmp.get(h.employee_id) || [];
        list.push(h);
        histByEmp.set(h.employee_id, list);
    }
    const dayOffFor = (empId, dateStr) => {
        const list = histByEmp.get(empId) || [];
        let eff = null;
        for (const h of list) {
            if (String(h.effective_from) <= dateStr) { eff = h.day_off; } else { break; }
        }
        return eff;
    };

    const detail = [];
    // ط§ظ„ط¨ط·ط§ظ‚ط© ظ‡ظٹ ط§ظ„ظ…طµط¯ط±: ط¨ط¯ط§ظٹط© ط§ظ„ط¯ظˆط§ظ… ظˆط¹ط¯ط¯ ط§ظ„ط³ط§ط¹ط§طھ ظˆday_off ظƒظ„ظ‡ط§ ظ…ظ† ط¨ط·ط§ظ‚ط© ط§ظ„ظ…ظˆط¸ظپ ظ…ط¨ط§ط´ط±ط©.
    for (const emp of emps) {
        const salary = Number(emp.salary || 0);
        if (salary <= 0) {continue;}
        const workDayMinutes = (Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10) * 60;
        const dayRate = salary / 30;

        const records = attByEmp.get(emp.id) || [];
        let lateMinutes = 0;
        let lateMoney = 0;
        for (const row of records) {
            const parts = calculateDelayParts(row, emp);
            const w = calculateMinutes(row);
            const needsReview = Boolean(row.checkIn && row.checkOut && w === 0);
            if (!needsReview) {
                const dayMin = workDayMinutes;
                lateMinutes += Number(parts.lateMinutes || 0);
                lateMoney += Number(parts.lateMinutes || 0) * (dayRate / dayMin);
            }
        }
        const presentDays = new Set(records.map(r => r.date));

        // ط§ظ„ط؛ظٹط§ط¨: ظٹظˆظ… ط¨ظ„ط§ ط¨طµظ…ط© ط­ط¶ظˆط±طŒ ط؛ظٹط± ظ…ط؛ط·ظ‰ ط¨ط¥ط¬ط§ط²ط© ظ…ط¹طھظ…ط¯ط©طŒ ط¨ط¹ط¯ ط§ظ„ط§ظ„طھط­ط§ظ‚طŒ ظˆط؛ظٹط± ظ…ط³طھظ‚ط¨ظ„ظٹ
        const joinDate = emp.joinDate ? String(emp.joinDate).slice(0, 10) : null;
        const coveredLeave = leaveByEmp.get(emp.id) || new Set();
        let absentDays = 0;
        const absentDates = [];
        for (const d of eachDate(start, end)) {
            if (d > todayStr) {break;}
            if (joinDate && d < joinDate) {continue;}
            const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
            if (skipFridays && weekday === 5) {continue;}
            // ط§ظ„ط±ط§ط­ط© ط§ظ„ط£ط³ط¨ظˆط¹ظٹط© ط¨طھط§ط±ظٹط® ط§ظ„ط³ط±ظٹط§ظ† (087) ط£ظˆظ„ظ‹ط§ ط«ظ… ط¹ظ…ظˆط¯ ط§ظ„ط¨ط·ط§ظ‚ط© (day_off 0-6).
            const histDayOff = dayOffFor(emp.id, d);
            const effectiveDayOff = histDayOff != null ? Number(histDayOff) : (emp.day_off != null ? Number(emp.day_off) : null);
            if (effectiveDayOff != null && weekday === effectiveDayOff) {continue;}
            if (presentDays.has(d) || coveredLeave.has(d)) {continue;}
            absentDays += 1;
            absentDates.push(d);
        }

        const lateDeduction = Math.round(lateMoney * 100) / 100;
        const absentDeduction = Math.round(absentDays * dayRate * 100) / 100;
        detail.push({
            employeeId: emp.id, name: emp.name, employeeCode: emp.employeeId,
            salary, workDayMinutes, daysPresent: presentDays.size,
            lateMinutes, absentDays, absentDates,
            lateDeduction, absentDeduction,
            totalDeduction: Math.round((lateDeduction + absentDeduction) * 100) / 100,
        });
    }
    return { month, detail, priorAuto };
}

router.get('/deductions/preview', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    try {
        const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
        const skipFridays = req.query.skip_fridays === '1' || req.query.skipFridays === 'true';
        const { detail } = await computeMonthDeductions(month, { skipFridays });
        const totals = detail.reduce((s, e) => ({
            late: s.late + e.lateDeduction, absent: s.absent + e.absentDeduction, total: s.total + e.totalDeduction,
        }), { late: 0, absent: 0, total: 0 });
        res.json({ ok: true, month, skipFridays, totals: {
            late: Math.round(totals.late * 100) / 100, absent: Math.round(totals.absent * 100) / 100, total: Math.round(totals.total * 100) / 100,
        }, employees: detail });
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_deductions_preview]');
        res.status(500).json({ error: 'DEDUCTIONS_PREVIEW_FAILED', message: 'طھط¹ط°ط± ط­ط³ط§ط¨ ظ…ط¹ط§ظٹظ†ط© ط§ظ„ط®طµظˆظ…ط§طھ' });
    }
});

router.post('/deductions/apply', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(String(req.body?.month || '')) ? String(req.body.month) : '';
    if (!month) {return res.status(422).json({ error: 'MONTH_INVALID', message: 'ط§ظ„ط´ظ‡ط± ط¨طµظٹط؛ط© YYYY-MM' });}
    const skipFridays = req.body?.skipFridays === true;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // V6 Phase 3 (decision #7) + FIX 2026-11-05 (ظ…ط±ط§ط¬ط¹ط© ط®ط§ط±ط¬ظٹط© P1): ط­ط§ط±ط³ ط§ظ„ظپطھط±ط©
        // ط¯ط§ط®ظ„ ط§ظ„ظ…ط¹ط§ظ…ظ„ط© ظ…ظˆط­ظ‘ط¯ظ‹ط§ ظ…ط¹ /payroll-runs/generate (C25). ظƒط§ظ† ظ‡ط°ط§ ط§ظ„ظ…ط³ط§ط±
        // ظٹط¨طھظ„ط¹ ط®ط·ط£ ط§ظ„طھط­ظ‚ظ‚ ظˆظٹط³طھظ…ط± (fail-open: آ«controls down â†’ طھط·ط¨ظٹظ‚آ») â€” ط§ظ„ط¢ظ†:
        // ط´ظ‡ط± ظ…ظ‚ظپظ„ = 423طŒ ظˆطھط¹ط°ظ‘ط± ط§ظ„طھط­ظ‚ظ‚ = 503 ط±ظپط¶طŒ ظˆظ„ط§ ظٹظڈظƒطھط¨ ط£ظٹ ط¨ظ†ط¯ ظپظٹ ط§ظ„ط­ط§ظ„طھظٹظ†.
        let periodState;
        try {
            const { isPeriodClosed } = require('./accounting-periods');
            periodState = (await isPeriodClosed(month)) ? 'closed' : 'open';
        } catch (periodErr) {
            logger.error('[hr_deductions_apply] period check failed (fail-closed):', periodErr.message || periodErr);
            periodState = 'unavailable';
        }
        if (periodState !== 'open') {
            await client.query('ROLLBACK').catch(() => {});
            if (periodState === 'closed') {
                return res.status(423).json({ error: 'PERIOD_LOCKED', message: `ط§ظ„ظپطھط±ط© ${month} ظ…ظ‚ظپظ„ط© ظ…ط­ط§ط³ط¨ظٹظ‹ط§ â€” ظ„ط§ ظٹظ…ظƒظ† طھط·ط¨ظٹظ‚ ط§ظ„ط®طµظˆظ…ط§طھ (ط£ط¹ط¯ ظپطھط­ ط§ظ„ظپطھط±ط© ط£ظˆظ„ظ‹ط§)` });
            }
            return res.status(503).json({ error: 'PERIOD_CHECK_UNAVAILABLE', message: 'طھط¹ط°ط± ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط­ط§ظ„ط© ط§ظ„ظپطھط±ط© ط§ظ„ظ…ط­ط§ط³ط¨ظٹط© â€” ظ„ظ… طھظڈط·ط¨ظژظ‘ظ‚ ط§ظ„ط®طµظˆظ…ط§طھ' });
        }
        const { detail } = await computeMonthDeductions(month, { skipFridays });
        // ط¥ط¹ط§ط¯ط© ط§ظ„طھط·ط¨ظٹظ‚ طھط³طھط¨ط¯ظ„ ط§ظ„ط¨ظ†ظˆط¯ ط§ظ„ط¢ظ„ظٹط© ط§ظ„ط³ط§ط¨ظ‚ط© ظ„ظ‡ط°ط§ ط§ظ„ط´ظ‡ط± â€” ط§ظ„ط¨ظ†ظˆط¯ ط§ظ„ظٹط¯ظˆظٹط© ظ„ط§ طھظڈظ…ط³
        await client.query(`DELETE FROM payroll_adjustments WHERE month = $1 AND reason LIKE $2`, [month, `${AUTO_DEDUCTION_MARK}%`]);
        let inserted = 0, totalAmount = 0;
        for (const e of detail) {
            if (e.lateDeduction > 0) {
                await client.query(
                    `INSERT INTO payroll_adjustments (id, "employeeId", month, kind, amount, reason, created_by)
                     VALUES ($1, $2, $3, 'penalty', $4, $5, $6)`,
                    [Date.now() * 1000 + Math.floor(Math.random() * 1000) + (e.employeeId % 1000), e.employeeId, month, e.lateDeduction,
                        `${AUTO_DEDUCTION_MARK} â€” طھط£ط®ظٹط± ${e.lateMinutes} ط¯ظ‚ظٹظ‚ط© (${(e.lateMinutes / 60).toFixed(1)} ط³ط§ط¹ط©)`, req.user.id]);
                inserted += 1; totalAmount += e.lateDeduction;
            }
            if (e.absentDeduction > 0) {
                await client.query(
                    `INSERT INTO payroll_adjustments (id, "employeeId", month, kind, amount, reason, created_by)
                     VALUES ($1, $2, $3, 'penalty', $4, $5, $6)`,
                    [Date.now() * 1000 + Math.floor(Math.random() * 1000) + (e.employeeId % 1000) + 500, e.employeeId, month, e.absentDeduction,
                        `${AUTO_DEDUCTION_MARK} â€” ط؛ظٹط§ط¨ ${e.absentDays} ظٹظˆظ…`, req.user.id]);
                inserted += 1; totalAmount += e.absentDeduction;
            }
        }
        await client.query('COMMIT');
        totalAmount = Math.round(totalAmount * 100) / 100;
        logger.info(`[hr_deductions_apply] month=${month} rows=${inserted} total=${totalAmount} by=${req.user.id}`);
        res.json({ ok: true, month, insertedRows: inserted, totalAmount,
            employees: detail.filter(e => e.totalDeduction > 0).length });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[hr_deductions_apply]');
        res.status(500).json({ error: 'DEDUCTIONS_APPLY_FAILED', message: 'طھط¹ط°ط± طھط·ط¨ظٹظ‚ ط§ظ„ط®طµظˆظ…ط§طھ' });
    } finally { client.release(); }
});


// â”€â”€â”€ ط¬ط¯ظˆظ„ ط¯ظˆط§ظ…ط§طھ ط§ظ„ظ‚ط³ظ…: ط±ط¦ظٹط³ ط§ظ„ظ‚ط³ظ… ظٹظƒطھط¨ ط¯ظˆط§ظ…ط§طھ ط±ط¬ط§ظ„ظ‡ â€” طھط³ظ…ط¹ ظپظˆط±ظ‹ط§ â”€â”€â”€
// ظٹظƒطھط¨ ط£ط¹ظ…ط¯ط© ط§ظ„ط¯ظˆط§ظ… ط§ظ„ط«ط§ط¨طھ ظ…ط¨ط§ط´ط±ط© (ظ…طµط¯ط± ط§ظ„ط­ظ‚ظٹظ‚ط© ظ„ظ„ظ…ط­ط±ظƒ) â€” ط¨ظ„ط§ ظ…ط³ظˆط¯ط§طھ ظˆظ„ط§ ط§ط¹طھظ…ط§ط¯.
// ط§ظ„طھط§ط±ظٹط® ط§ظ„ظ‚ط¯ظٹظ… ظ„ط§ ظٹظڈظ…ط³ (طµظپظˆظپ ط§ظ„ط­ط¶ظˆط± ط§ظ„ط³ط§ط¨ظ‚ط© ظƒظ…ط§ ظ‡ظٹ)ط› ط§ظ„طھط؛ظٹظٹط± ظˆط§ظ„ط±ط¬ظˆط¹ ط­ط±ط§ظ†.
// ط§ظ„ظ†ط·ط§ظ‚: dept_head ظˆط£ظٹ ط­ط³ط§ط¨ ظ…ط±ط¨ظˆط· ط¨ظ‚ط³ظ… â†’ ظ‚ط³ظ…ظ‡ ط¥ط¬ط¨ط§ط±ظٹظ‹ط§. kitchenâ†’KITCHEN ظˆ
// warehouseâ†’WAREHOUSE ط§ظپطھط±ط§ط¶ظٹظ‹ط§. ط§ظ„ظ…ط®ظˆظ‘ظ„ظˆظ† (admin/hr/manager/accountant ط¨ظ„ط§ ظ‚ط³ظ…)
// ظٹظ…ط±ط±ظˆظ† ط§ظ„ظ‚ط³ظ… طµط±ط§ط­ط©. ط§ظ„ط¶ظ…: ط§ظ„طµظپ ط¨ظ„ط§ ظ‚ط³ظ… ظٹظڈط³ظ†ط¯ ظ„ظ‚ط³ظ… ط§ظ„ظ†ط·ط§ظ‚ ط¹ظ†ط¯ ط§ظ„ط­ظپط¸.
const ROSTER_ROLES = ['admin', 'hr', 'manager', 'dept_head', 'kitchen', 'sous_chef', 'warehouse', 'accountant'];
const ROSTER_ROLE_DEPT = { kitchen: 'KITCHEN', sous_chef: 'KITCHEN', warehouse: 'WAREHOUSE' };
const ROSTER_PRIVILEGED = ['admin', 'hr', 'manager'];

function rosterScope(user, wantDept) {
    const myCode = String(user?.dept_code || '').trim();
    if (user?.role === 'dept_head' || myCode) {
        if (!myCode) {return { ok: false, code: 'DEPT_HEAD_WITHOUT_DEPARTMENT', message: 'ط­ط³ط§ط¨ ط±ط¦ظٹط³ ط§ظ„ظ‚ط³ظ… ط؛ظٹط± ظ…ط±طھط¨ط· ط¨ط£ظٹ ظ‚ط³ظ… â€” ط±ط§ط¬ط¹ ظ…ط³ط¤ظˆظ„ ط§ظ„ظ†ط¸ط§ظ…' };}
        // UPGRADE 2026-10-01: dept_code ظٹظ‚ط¨ظ„ ظ‚ط§ط¦ظ…ط© ط£ظ‚ط³ط§ظ… ظ…ظپطµظˆظ„ط© ط¨ظپظˆط§طµظ„
        // (ط´ط®طµ ظٹط¯ظٹط± ط£ظƒط«ط± ظ…ظ† ظ‚ط³ظ… ظ…ط¤ظ‚طھظ‹ط§: storeroom,SERVICE) â€” ط§ظ„طھط±ط§ط¬ط¹ ط¨ط¶ط¹ ظ‚ط³ظ… ظˆط§ط­ط¯
        return { ok: true, depts: myCode.split(',').map((x) => x.trim()).filter(Boolean), fixed: true };
    }
    const mapped = ROSTER_ROLE_DEPT[user?.role];
    if (mapped) {return { ok: true, depts: [mapped], fixed: true };}
    if (!ROSTER_PRIVILEGED.includes(user?.role) && user?.role !== 'accountant') {
        return { ok: false, code: 'FORBIDDEN', message: 'ظ„ط§ طھظ…ظ„ظƒ طµظ„ط§ط­ظٹط© ط¬ط¯ظˆظ„ ط§ظ„ط¯ظˆط§ظ…ط§طھ' };
    }
    // ط§ظ„ظ…ط®ظˆظ‘ظ„ظˆظ†: ظ‚ط³ظ… ظˆط§ط­ط¯ ط£ظˆ ظ‚ط§ط¦ظ…ط© ظ…ظپطµظˆظ„ط© ط¨ظپظˆط§طµظ„ (ظ…ط«ط§ظ„: ADMIN,WAREHOUSE) ط£ظˆ ظپط§ط±ط؛ = ط§ظ„ظƒظ„
    const list = String(wantDept || '').split(',').map((s) => s.trim()).filter(Boolean);
    return { ok: true, depts: list, fixed: false };
}

async function rosterValidDepts() {
    const codes = new Set();
    try {
        const a = await pool.query('SELECT code FROM "hrDepartments"');
        a.rows.forEach((r) => { if (r.code) {codes.add(String(r.code));} });
    } catch (e) { logger.warn({ err: { message: String(e.message), stack: (e && e.stack) || null } }, '[roster] ظپط´ظ„ ظ‚ط±ط§ط،ط© ط£ظ‚ط³ط§ظ… HR:'); }
    try {
        const b = await pool.query('SELECT code FROM departments');
        b.rows.forEach((r) => { if (r.code) {codes.add(String(r.code));} });
    } catch (e) { logger.warn({ err: { message: String(e.message), stack: (e && e.stack) || null } }, '[roster] ظپط´ظ„ ظ‚ط±ط§ط،ط© ط§ظ„ط£ظ‚ط³ط§ظ…:'); }
    return codes;
}

const sameDept = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const inScopeDepts = (depts, code) => (depts || []).some((d) => sameDept(d, code));

router.get('/dept-roster', jwtAuth, requireRole(...ROSTER_ROLES), async (req, res) => {
    try {
        const scope = rosterScope(req.user, req.query.dept);
        if (!scope.ok) {return res.status(403).json({ error: scope.code, message: scope.message });}
        const valid = await rosterValidDepts();
        const emps = (await pool.query(
            `SELECT e.id, e.name, e."employeeId", e.position, e.department,
                    e.shift_start, e.shift_karim, e.day_off, e.status
               FROM employees e WHERE e.status = 'active' ORDER BY e.name`
        )).rows;
        const todayRows = (await pool.query(
            `SELECT "employeeId", "checkIn", "checkOut" FROM attendance
              WHERE date = TO_CHAR(NOW() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD')`
        )).rows;
        const todayByEmp = new Map(todayRows.map((r) => [String(r.employeeId), r]));
        let list = emps;
        if (scope.depts.length) {
            list = emps.filter((e) => inScopeDepts(scope.depts, e.department));
        }
        const canSeeUnassigned = req.user?.role === 'hr';
        const unassigned = canSeeUnassigned
            ? emps.filter((e) => !String(e.department || '').trim())
            : [];
        const withToday = (e) => {
            const t = todayByEmp.get(String(e.id));
            return { ...e, todayIn: t?.checkIn || null, todayOut: t?.checkOut || null };
        };
        // ط§ظ„ظ…ط¬ط¯ظˆظ„ ظ…ط³طھظ‚ط¨ظ„ظ‹ط§ + ط¢ط®ط± ط§ظ„طھط؛ظٹظٹط±ط§طھ (ط§ظ„ط´ظپط§ظپظٹط© ط§ظ„ط§ط­طھط±ط§ظپظٹط©) â€” fail-open
        const todayStr = riyadhToday();
        let pendingFuture = [];
        let recentLog = [];
        try {
            const visIds = [...new Set([...list, ...unassigned].map((e) => Number(e.id)).filter(Number.isInteger))];
            if (visIds.length) {
                const pf = await pool.query(
                    `SELECT h.employee_id, e.name, e."employeeId" AS emp_no, h.shift_start, h.shift_karim,
                            h.effective_from::text AS effective_from, u.name AS by_name
                       FROM employee_shift_history h
                       JOIN employees e ON e.id = h.employee_id
                       LEFT JOIN users u ON u.id = h.created_by
                      WHERE h.employee_id = ANY($1::bigint[]) AND h.effective_from > $2::date
                        AND h.effective_from <> DATE '2000-01-01'
                      ORDER BY h.effective_from, e.name LIMIT 100`,
                    [visIds, todayStr]
                );
                pendingFuture = pf.rows;
                const rl = await pool.query(
                    `SELECT h.employee_id, e.name, e."employeeId" AS emp_no, h.shift_start, h.shift_karim,
                            h.effective_from::text AS effective_from, h.created_at::text AS created_at, u.name AS by_name
                       FROM employee_shift_history h
                       JOIN employees e ON e.id = h.employee_id
                       LEFT JOIN users u ON u.id = h.created_by
                      WHERE h.employee_id = ANY($1::bigint[]) AND h.effective_from <> DATE '2000-01-01'
                      ORDER BY h.created_at DESC LIMIT 20`,
                    [visIds]
                );
                recentLog = rl.rows;
            }
        } catch (e) { logger.warn({ err: { message: String(e.message), stack: (e && e.stack) || null } }, '[dept-roster] طھط¹ط°ط± ظ‚ط±ط§ط،ط© ط¢ط®ط± طھط؛ظٹظٹط±ط§طھ ط§ظ„ط¯ظˆط§ظ…:'); }
        res.json({
            ok: true, depts: scope.depts, fixed: scope.fixed,
            canSeeUnassigned,
            validDepts: [...valid],
            mine: list.map(withToday),
            unassigned: unassigned.map(withToday),
            pendingFuture: pendingFuture,
            recentLog: recentLog,
            today: todayStr,
        });
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[dept-roster list]');
        res.status(500).json({ error: 'ROSTER_LIST_FAILED', message: 'طھط¹ط°ط± ط¬ظ„ط¨ ط¬ط¯ظˆظ„ ط§ظ„ظ‚ط³ظ…' });
    }
});

router.post('/dept-roster', jwtAuth, requireRole(...ROSTER_ROLES), async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {return res.status(422).json({ error: 'ROSTER_EMPTY', message: 'ظ„ط§ طھظˆط¬ط¯ طµظپظˆظپ ظ„ظ„ط­ظپط¸' });}
    if (rows.length > 500) {return res.status(422).json({ error: 'ROSTER_TOO_BIG', message: 'ط­ط¯ ط£ظ‚طµظ‰ 500 طµظپ ظپظٹ ط§ظ„ط­ظپط¸ط© ط§ظ„ظˆط§ط­ط¯ط©' });}
    // طھط§ط±ظٹط® ط§ظ„ط³ط±ظٹط§ظ† ط­ط± (ط§ظ„ظٹظˆظ… = ظپظˆط±ظٹطŒ ط§ظ„ظ…ط³طھظ‚ط¨ظ„ = ظ…ط¬ط¯ظˆظ„). ط§ظ„ظ…ط§ط¶ظٹ ظ…ط±ظپظˆط¶ ظ„ط­ظ…ط§ظٹط© ط§ظ„ظ‚ط¯ظٹظ….
    const todayStr = riyadhToday(); // Asia/Riyadh
    const tomorrow = (function(){const d=new Date(Date.now()+3*3600*1000+86400000);return d.toISOString().slice(0,10)})();
    const effRaw = String(req.body?.effective_from || tomorrow);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effRaw)) {return res.status(422).json({ error: 'ROSTER_BAD_DATE', message: 'طھط§ط±ظٹط® ط§ظ„ط³ط±ظٹط§ظ† YYYY-MM-DD' });}
    if (effRaw < todayStr) {return res.status(422).json({ error: 'ROSTER_PAST_DATE', message: 'طھط§ط±ظٹط® ط§ظ„ط³ط±ظٹط§ظ† ظ„ط§ ظٹظƒظˆظ† ظپظٹ ط§ظ„ظ…ط§ط¶ظٹ â€” ط§ظ„ظ‚ط¯ظٹظ… ظ…ط­ظ…ظٹ' });}
    const applyNow = effRaw <= todayStr;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const scope = rosterScope(req.user, req.body?.dept);
        if (!scope.ok) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: scope.code, message: scope.message });
        }
        const privileged = ROSTER_PRIVILEGED.includes(req.user?.role);
        const valid = await rosterValidDepts();
        const ids = [...new Set(rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n)))];
        if (!ids.length) {
            await client.query('ROLLBACK');
            return res.status(422).json({ error: 'ROSTER_NO_IDS', message: 'ظ„ط§ ظ…ط¹ط±ظپط§طھ ظ…ظˆط¸ظپظٹظ† طµط§ظ„ط­ط©' });
        }
        const cur = (await client.query(`SELECT * FROM employees WHERE id = ANY($1::bigint[]) FOR UPDATE`, [ids])).rows;
        const byId = new Map(cur.map((e) => [Number(e.id), e]));
        const updates = [];
        for (const r of rows) {
            const emp = byId.get(Number(r.id));
            if (!emp) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: `ط§ظ„ظ…ظˆط¸ظپ ${r.id} ط؛ظٹط± ظ…ظˆط¬ظˆط¯` });
            }
            const hasDept = !!String(emp.department || '').trim();
            if (hasDept && !inScopeDepts(scope.depts, emp.department) && !(privileged && !scope.fixed)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'ROSTER_OUT_OF_SCOPE', message: `ط§ظ„ظ…ظˆط¸ظپ آ«${emp.name}آ» ظ„ظٹط³ ظپظٹ ظ‚ط³ظ…ظƒ` });
            }
            let start = String(r.shift_start ?? emp.shift_start ?? '09:00').trim();
            const sm = start.match(/^(\d{1,2}):(\d{2})$/);
            if (!sm || Number(sm[1]) > 23 || Number(sm[2]) > 59) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_TIME', message: `ظˆظ‚طھ ط؛ظٹط± طµط§ظ„ط­ ظ„ظ„ظ…ظˆط¸ظپ آ«${emp.name}آ» (HH:MM)` });
            }
            start = `${String(sm[1]).padStart(2, '0')}:${sm[2]}`;
            const hours = Number(r.shift_karim ?? r.shift_hours ?? emp.shift_karim ?? 10);
            if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_Karim', message: `ظ…ط¯ط© ط§ظ„ط¯ظˆط§ظ… 1-24 ظ„ظ„ظ…ظˆط¸ظپ آ«${emp.name}آ»` });
            }
            let dayOff = r.day_off ?? r.dayOff ?? emp.day_off ?? null;
            if (dayOff === '' || dayOff === undefined) {dayOff = null;}
            if (dayOff !== null && !(Number.isInteger(Number(dayOff)) && Number(dayOff) >= 0 && Number(dayOff) <= 6)) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_DAYOFF', message: `ظٹظˆظ… ط§ظ„ط±ط§ط­ط© 0-6 ظ„ظ„ظ…ظˆط¸ظپ آ«${emp.name}آ»` });
            }
            let dept = emp.department;
            const wantDept = r.department !== undefined ? String(r.department || '').trim() : null;
            if (!hasDept) {
                // ط§ظ„ط¶ظ… ظ„ط´ط¤ظˆظ† ط§ظ„ط¹ط§ظ…ظ„ظٹظ† (ظˆظ…ظ† ظٹظ…ظ„ظƒظ‡ط§) ظپظ‚ط· â€” ط±ط¤ط³ط§ط، ط§ظ„ط£ظ‚ط³ط§ظ… ظٹط±ظˆظ† ط±ط¬ط§ظ„ظ‡ظ… ط­طµط±ظ‹ط§
                if (!privileged) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ error: 'ROSTER_CLAIM_FORBIDDEN', message: `ط§ظ„ظ…ظˆط¸ظپ آ«${emp.name}آ» ط¨ظ„ط§ ظ‚ط³ظ… â€” ط§ظ„طھطµظ†ظٹظپ ظ…ظ† ط´ط¤ظˆظ† ط§ظ„ط¹ط§ظ…ظ„ظٹظ†` });
                }
                const claimTo = wantDept || scope.depts[0];
                if (claimTo && ![...valid].some((c) => sameDept(c, claimTo))) {
                    await client.query('ROLLBACK');
                    return res.status(422).json({ error: 'ROSTER_BAD_DEPT', message: `ظ‚ط³ظ… ط؛ظٹط± ظ…ط¹ط±ظˆظپ: ${claimTo}` });
                }
                if (claimTo) {dept = [...valid].find((c) => sameDept(c, claimTo)) || claimTo;}
            } else if (privileged && wantDept && !sameDept(wantDept, emp.department)) {
                if (![...valid].some((c) => sameDept(c, wantDept))) {
                    await client.query('ROLLBACK');
                    return res.status(422).json({ error: 'ROSTER_BAD_DEPT', message: `ظ‚ط³ظ… ط؛ظٹط± ظ…ط¹ط±ظˆظپ: ${wantDept}` });
                }
                dept = [...valid].find((c) => sameDept(c, wantDept)) || wantDept;
            }
            updates.push({ id: emp.id, name: emp.name, shift_start: start, shift_karim: hours, day_off: dayOff, department: dept });
        }
        for (const u of updates) {
            // ط£ط³ط§ط³ ط£ظˆظ„: ط£ظˆظ„ طھط؛ظٹظٹط± ظ„ظ…ظˆط¸ظپ ظٹط¬ظ…ظ‘ط¯ ظ‚ظٹظ…ظ‡ ط§ظ„ط­ط§ظ„ظٹط© ط¨طھط§ط±ظٹط® ظ‚ط¯ظٹظ… â€” ط¨ظ‡ ط§ظ„ظ…ط§ط¶ظٹ
            // ظٹظڈط­ظ„ ط¯ط§ط¦ظ…ظ‹ط§ ط¨ط¯ظˆط§ظ…ظ‡ ط§ظ„ط£طµظ„ظٹ ظ…ظ‡ظ…ط§ طھط؛ظٹط±طھ ط§ظ„ط¨ط·ط§ظ‚ط© ظ„ط§ط­ظ‚ظ‹ط§.
            await client.query(
                `INSERT INTO employee_shift_history (employee_id, shift_start, shift_karim, day_off, effective_from, created_by)
                 SELECT $1, e.shift_start, e.shift_karim, e.day_off, DATE '2000-01-01', $2 FROM employees e
                  WHERE e.id = $1 AND NOT EXISTS (SELECT 1 FROM employee_shift_history h WHERE h.employee_id = $1)
                 ON CONFLICT DO NOTHING`,
                [u.id, req.user.id]
            );
            await client.query(
                `INSERT INTO employee_shift_history (employee_id, shift_start, shift_karim, day_off, effective_from, created_by)
                 VALUES ($1,$2,$3,$4,$5::date,$6)
                 ON CONFLICT (employee_id, effective_from)
                 DO UPDATE SET shift_start=EXCLUDED.shift_start, shift_karim=EXCLUDED.shift_karim,
                               day_off=EXCLUDED.day_off, created_by=EXCLUDED.created_by, created_at=NOW()`,
                [u.id, u.shift_start, u.shift_karim, u.day_off, effRaw, req.user.id]
            );
            if (applyNow) {
                await client.query(
                    `UPDATE employees SET shift_start = $2, shift_karim = $3, day_off = $4, department = $5 WHERE id = $1`,
                    [u.id, u.shift_start, u.shift_karim, u.day_off, u.department]
                );
            }
        }
        await client.query('COMMIT');
        logger.info({ userId: req.user?.id, depts: scope.depts, n: updates.length, effective_from: effRaw, applyNow }, '[dept-roster] saved');
        try {
            makeEmitScoped(req.io)('entity_changed', {
                entity: 'employees', entityName: 'ط§ظ„ظ…ظˆط¸ظپظˆظ†', action: 'update',
                data: updates, changedBy: req.user?.name || req.user?.username || 'roster', changedAt: new Date().toISOString(),
            });
        } catch (e) { logger.debug('[dept-roster] طھط¹ط°ط± ط¨ط« entity_changed:', e.message); }
        res.json({ ok: true, updated: updates.length, rows: updates, effective_from: effRaw, appliedNow: applyNow });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[dept-roster save]');
        res.status(500).json({ error: 'ROSTER_SAVE_FAILED', message: 'طھط¹ط°ط± ط­ظپط¸ ط§ظ„ط¬ط¯ظˆظ„' });
    } finally {
        client.release();
    }
});

// â”€â”€â”€ ط´ط¨ظƒط© ط§ظ„ط¯ظˆط§ظ…ط§طھ ط§ظ„ط£ط³ط¨ظˆط¹ظٹط© (ظ…ظˆط¸ظپ أ— ظٹظˆظ…) â€” طھط­ط±ظٹط± ط£ظٹ ظٹظˆظ… ظ…ط³طھظ‚ط¨ظ„ظ‹ط§ ط¨ظپط§ط¹ظ„ظٹط© â”€â”€â”€
// ط§ظ„ط¨ظ†ط§ط، ظپظˆظ‚ employee_shift_history: ظƒظ„ ط®ظ„ظٹط© ظ…ط­ظپظˆط¸ط© = طµظپ ظ…ط¬ط¯ظˆظ„ ط¨طھط§ط±ظٹط® ط³ط±ظٹط§ظ†ظ‡طŒ
// ظˆظˆط¸ظٹظپط© ط§ظ„ظ€rollover (ظƒظ„ 5 ط¯ظ‚ط§ط¦ظ‚) طھط·ط¨ظ‘ظ‚ظ‡ ظپظٹ ط£ط¹ظ…ط¯ط© ط§ظ„ظ…ط­ط±ظƒ ظٹظˆظ…ظ‡. ط§ظ„ظ…ط§ط¶ظٹ ظ…ط­ظ…ظٹ.
router.get('/dept-roster-week', jwtAuth, requireRole(...ROSTER_ROLES), async (req, res) => {
    try {
        const scope = rosterScope(req.user, req.query.dept);
        if (!scope.ok) {return res.status(403).json({ error: scope.code, message: scope.message });}
        const todayStr = riyadhToday(); // Asia/Riyadh
        const ws = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || '')) ? String(req.query.week) : todayStr;
        const w0 = new Date(ws + 'T12:00:00Z');
        // ط¨ط¯ط§ظٹط© ط§ظ„ط£ط³ط¨ظˆط¹ = ط§ظ„ط³ط¨طھ (ط·ظ„ط¨ ط§ظ„ظ…ط§ظ„ظƒ 2026-10-04): (ط±ظ‚ظ… ط§ظ„ظٹظˆظ… + 1) % 7 = ط§ظ„ط£ظٹط§ظ… ظ…ظ†ط° ط§ظ„ط³ط¨طھ
        w0.setUTCDate(w0.getUTCDate() - ((w0.getUTCDay() + 1) % 7));
        const weekStart = w0.toISOString().slice(0, 10);
        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(w0.getTime() + i * 86400000);
            const iso = d.toISOString().slice(0, 10);
            days.push({ date: iso, weekday: i, isPast: iso < todayStr, isToday: iso === todayStr });
        }
        const weekEnd = days[6].date;
        const valid = await rosterValidDepts();
        let approval = null;
        try {
            await ensureRosterApprovals();
            approval = (await pool.query(
                `SELECT requested_name, requested_at::text AS requested_at, approved_name, approved_at::text AS approved_at
                   FROM roster_approvals WHERE dept_key=$1 AND week_start=$2::date LIMIT 1`,
                [rosterApprovalKey(scope), weekStart])).rows[0] || null;
        } catch (e) { logger.warn({ err: { message: String(e.message), stack: (e && e.stack) || null } }, '[dept-roster-week] طھط¹ط°ط± ظ‚ط±ط§ط،ط© ط­ط§ظ„ط© ط§ظ„ط§ط¹طھظ…ط§ط¯:'); }
        const emps = (await pool.query(
            `SELECT e.id, e.name, e."employeeId", e.position, e.department, e.shift_start, e.shift_karim, e.day_off, e.status
               FROM employees e WHERE e.status = 'active' ORDER BY e.name`
        )).rows;
        const inScope = emps.filter((e) => String(e.department || '').trim() && (!scope.depts.length || inScopeDepts(scope.depts, e.department)));
        const ids = inScope.map((e) => Number(e.id));
        let hist = [];
        let recentLog = [];
        if (ids.length) {
            hist = (await pool.query(
                `SELECT h.employee_id, h.shift_start, h.shift_karim, h.day_off, h.effective_from::text AS effective_from
                   FROM employee_shift_history h
                  WHERE h.employee_id = ANY($1::bigint[]) AND h.effective_from <= $2::date
                  ORDER BY h.employee_id, h.effective_from`,
                [ids, weekEnd]
            )).rows;
            recentLog = (await pool.query(
                `SELECT h.employee_id, e.name, e."employeeId" AS emp_no, h.shift_start, h.shift_karim,
                        h.effective_from::text AS effective_from, h.created_at::text AS created_at, u.name AS by_name
                   FROM employee_shift_history h
                   JOIN employees e ON e.id = h.employee_id
                   LEFT JOIN users u ON u.id = h.created_by
                  WHERE h.employee_id = ANY($1::bigint[]) AND h.effective_from <> DATE '2000-01-01'
                  ORDER BY h.created_at DESC LIMIT 15`,
                [ids]
            )).rows;
        }
        const histBy = new Map();
        for (const h of hist) {
            if (!histBy.has(Number(h.employee_id))) {histBy.set(Number(h.employee_id), []);}
            histBy.get(Number(h.employee_id)).push(h);
        }
        // ط§ظ„ط¥ط¬ط§ط²ط§طھ ط§ظ„ظ…ط¹طھظ…ط¯ط© ط§ظ„ظ…طھظ‚ط§ط·ط¹ط© ظ…ط¹ ط§ظ„ط£ط³ط¨ظˆط¹ â€” طھط¸ظ‡ط± ظˆط§ط¶ط­ط© ظپظٹ ط§ظ„ط´ط¨ظƒط© ظˆط§ظ„ط·ط¨ط§ط¹ط© (ط·ظ„ط¨ ط§ظ„ظ…ط§ظ„ظƒ 2026-10-04)
        const leavesBy = new Map();
        if (ids.length) {
            try {
                const lv = (await pool.query(
                    `SELECT lr."employeeId" AS employee_id, lr."startDate" AS start_date, lr."endDate" AS end_date,
                            COALESCE(lt.name, 'ط¥ط¬ط§ط²ط©') AS type_name
                       FROM "leaveRequests" lr
                       LEFT JOIN "leaveTypes" lt ON lt.id = lr."leaveTypeId"
                      WHERE lr.status = 'approved'
                        AND lr."employeeId" = ANY($1::bigint[])
                        AND lr."endDate" >= $2 AND lr."startDate" <= $3`,
                    [ids, weekStart, weekEnd]
                )).rows;
                for (const l of lv) {
                    const key = Number(l.employee_id);
                    if (!leavesBy.has(key)) {leavesBy.set(key, []);}
                    leavesBy.get(key).push(l);
                }
            } catch (_) { /* ط¬ط¯ظˆظ„ ط¥ط¬ط§ط²ط§طھ ظ‚ط¯ظٹظ…/ط¨ط£ط¹ظ…ط¯ط© ظ…ط®طھظ„ظپط© â€” ط§ظ„ط´ط¨ظƒط© طھط¹ظ…ظ„ ط¨ظ„ط§ ط·ط¨ظ‚ط© ط§ظ„ط¥ط¬ط§ط²ط§طھ */ }
        }
        const leavesOn = (employeeId, date) => {
            const list = leavesBy.get(Number(employeeId)) || [];
            return list.find((l) => String(l.start_date) <= date && String(l.end_date) >= date) || null;
        };
        const grid = inScope.map((e) => {
            const rows = histBy.get(Number(e.id)) || [];
            const cells = [];
            for (const day of days) {
                const upto = rows.filter((r) => r.effective_from <= day.date);
                const last = upto.length ? upto[upto.length - 1] : null;
                const src = last || { shift_start: e.shift_start, shift_karim: e.shift_karim, day_off: e.day_off };
                const lv = leavesOn(e.id, day.date);
                cells.push({
                    date: day.date,
                    shift_start: String(src.shift_start || '09:00').slice(0, 5),
                    shift_hours: Number(src.shift_karim) || 10,
                    day_off: src.day_off == null ? null : Number(src.day_off),
                    onLeave: Boolean(lv),
                    leaveType: lv ? lv.type_name : null,
                    explicit: rows.some((r) => r.effective_from === day.date),
                    editable: day.date >= todayStr && !lv,
                });
            }
            return {
                id: e.id, name: e.name, employeeId: e.employeeId, position: e.position, department: e.department,
                base: { shift_start: String(e.shift_start || '09:00').slice(0, 5), shift_hours: Number(e.shift_karim) || 10, day_off: e.day_off == null ? null : Number(e.day_off) },
                cells,
            };
        });
        res.json({
            ok: true, weekStart, days, grid, depts: scope.depts, fixed: scope.fixed,
            today: todayStr, validDepts: [...valid], recentLog, approval,
        });
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[dept-roster-week list]');
        res.status(500).json({ error: 'ROSTER_WEEK_FAILED', message: 'طھط¹ط°ط± ط¬ظ„ط¨ ط´ط¨ظƒط© ط§ظ„ط£ط³ط¨ظˆط¹' });
    }
});

// â”€â”€â”€ ط§ط¹طھظ…ط§ط¯ ط·ط¨ط§ط¹ط© ط§ظ„ط¯ظˆط§ظ…ط§طھ: ط±ط¦ظٹط³ ط§ظ„ظ‚ط³ظ… ظٹط·ظ„ط¨ â†گ ط´ط¤ظˆظ† ط§ظ„ط¹ط§ظ…ظ„ظٹظ† طھظˆظ‚ظ‘ط¹ â†گ ط§ظ„ط·ط¨ط§ط¹ط© ظ…ط¹طھظ…ط¯ط© â”€â”€â”€
function rosterApprovalKey(scope) {
    return ((scope.depts && scope.depts.length) ? scope.depts.join(',') : '*').toLowerCase();
}
async function ensureRosterApprovals() {
    await pool.query(`CREATE TABLE IF NOT EXISTS roster_approvals (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        dept_key TEXT NOT NULL,
        week_start DATE NOT NULL,
        requested_by BIGINT, requested_name TEXT, requested_at TIMESTAMPTZ,
        approved_by BIGINT, approved_name TEXT, approved_at TIMESTAMPTZ,
        UNIQUE (dept_key, week_start))`);
}
router.post('/dept-roster-approval/request', jwtAuth, requireRole(...ROSTER_ROLES), async (req, res) => {
    try {
        await ensureRosterApprovals();
        const scope = rosterScope(req.user, req.body?.dept);
        if (!scope.ok) {return res.status(403).json({ error: scope.code, message: scope.message });}
        const ws = String(req.body?.week_start || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ws)) {return res.status(422).json({ error: 'ROSTER_BAD_DATE', message: 'ط¨ط¯ط§ظٹط© ط§ظ„ط£ط³ط¨ظˆط¹ YYYY-MM-DD' });}
        const name = req.user.name || req.user.username || String(req.user.id);
        await pool.query(
            `INSERT INTO roster_approvals (dept_key, week_start, requested_by, requested_name, requested_at)
             VALUES ($1,$2::date,$3,$4,NOW())
             ON CONFLICT (dept_key, week_start) DO UPDATE SET requested_by=$3, requested_name=$4, requested_at=NOW(),
               approved_by=NULL, approved_name=NULL, approved_at=NULL`,
            [rosterApprovalKey(scope), ws, req.user.id, name]
        );
        res.json({ ok: true });
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[roster-approval request]');
        res.status(500).json({ error: 'APPROVAL_REQUEST_FAILED', message: 'طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط·ظ„ط¨ ط§ظ„ط§ط¹طھظ…ط§ط¯' });
    }
});
router.get('/dept-roster-approval/pending', jwtAuth, requireRole('hr', 'admin'), async (req, res) => {
    try {
        await ensureRosterApprovals();
        const ws = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || '')) ? String(req.query.week)
            : riyadhToday();
        const rows = (await pool.query(
            `SELECT dept_key, week_start::text AS week_start, requested_name, requested_at::text AS requested_at
               FROM roster_approvals
              WHERE week_start = $1::date AND requested_at IS NOT NULL AND approved_at IS NULL
              ORDER BY requested_at DESC`,
            [ws]
        )).rows;
        res.json({ ok: true, week: ws, pending: rows });
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[roster-approval pending]');
        res.status(500).json({ error: 'APPROVAL_PENDING_FAILED', message: 'طھط¹ط°ط± ط¬ظ„ط¨ ط·ظ„ط¨ط§طھ ط§ظ„ط§ط¹طھظ…ط§ط¯' });
    }
});
router.post('/dept-roster-approval/approve', jwtAuth, requireRole('hr', 'admin'), async (req, res) => {
    try {
        await ensureRosterApprovals();
        const ws = String(req.body?.week_start || '');
        const deptKey = String(req.body?.dept_key || '').trim().toLowerCase();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ws) || !deptKey) {
            return res.status(422).json({ error: 'APPROVAL_BAD_INPUT', message: 'ط§ظ„ط£ط³ط¨ظˆط¹ ظˆط§ظ„ظ‚ط³ظ… ظ…ط·ظ„ظˆط¨ط§ظ†' });
        }
        const name = req.user.name || req.user.username || String(req.user.id);
        const r = await pool.query(
            `UPDATE roster_approvals SET approved_by=$3, approved_name=$4, approved_at=NOW()
              WHERE dept_key=$1 AND week_start=$2::date AND requested_at IS NOT NULL RETURNING *`,
            [deptKey, ws, req.user.id, name]
        );
        if (!r.rows.length) {return res.status(422).json({ error: 'APPROVAL_NOT_FOUND', message: 'ظ„ط§ ط·ظ„ط¨ ط§ط¹طھظ…ط§ط¯ ظ…ظپطھظˆط­ ظ„ظ‡ط°ط§ ط§ظ„ظ‚ط³ظ… ظپظٹ ظ‡ط°ط§ ط§ظ„ط£ط³ط¨ظˆط¹' });}
        res.json({ ok: true, approval: { approved_name: r.rows[0].approved_name, approved_at: r.rows[0].approved_at } });
    } catch (e) {
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[roster-approval approve]');
        res.status(500).json({ error: 'APPROVAL_FAILED', message: 'طھط¹ط°ط± ط§ط¹طھظ…ط§ط¯ ط§ظ„ط¯ظˆط§ظ…ط§طھ' });
    }
});

router.post('/dept-roster-week', jwtAuth, requireRole(...ROSTER_ROLES), async (req, res) => {
    const cells = Array.isArray(req.body?.cells) ? req.body.cells : [];
    if (!cells.length) {return res.status(422).json({ error: 'ROSTER_EMPTY', message: 'ظ„ط§ طھظˆط¬ط¯ ط®ظ„ط§ظٹط§ ظ„ظ„ط­ظپط¸' });}
    if (cells.length > 700) {return res.status(422).json({ error: 'ROSTER_TOO_BIG', message: 'ط­ط¯ ط£ظ‚طµظ‰ 700 ط®ظ„ظٹط© ظپظٹ ط§ظ„ط­ظپط¸ط© ط§ظ„ظˆط§ط­ط¯ط©' });}
    const todayStr = riyadhToday(); // Asia/Riyadh
    const wsRaw = String(req.body?.week_start || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wsRaw)) {return res.status(422).json({ error: 'ROSTER_BAD_DATE', message: 'ط¨ط¯ط§ظٹط© ط§ظ„ط£ط³ط¨ظˆط¹ YYYY-MM-DD' });}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const scope = rosterScope(req.user, req.body?.dept);
        if (!scope.ok) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: scope.code, message: scope.message });
        }
        const privileged = ROSTER_PRIVILEGED.includes(req.user?.role);
        const valid = await rosterValidDepts();
        // طھظ†ط¸ظٹظپ ظˆطھط­ظ‚ظ‚ ظ…ظ† ظƒظ„ ط®ظ„ظٹط© ظ‚ط¨ظ„ ط£ظٹ ظƒطھط§ط¨ط©
        const clean = [];
        for (const c of cells) {
            const id = Number(c.id);
            const date = String(c.date || '');
            if (!Number.isInteger(id) || id <= 0) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_CELL', message: 'ط®ظ„ظٹط© ط¨ظ…ط¹ط±ظپ ظ…ظˆط¸ظپ ط؛ظٹط± طµط§ظ„ط­' });
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_DATE', message: `طھط§ط±ظٹط® ط®ظ„ظٹط© ط؛ظٹط± طµط§ظ„ط­: ${date}` });
            }
            // ط§ظ„ط£ط³ط¨ظˆط¹ 7 ط£ظٹط§ظ…: ط§ظ„طھط§ط±ظٹط® ظ„ط§ط²ظ… ظٹظƒظˆظ† ط¨ظٹظ† ط¨ط¯ط§ظٹط© ط§ظ„ط£ط³ط¨ظˆط¹ ظˆظ†ظ‡ط§ظٹطھظ‡
            const dd = new Date(date + 'T12:00:00Z');
            const diff = Math.round((dd - new Date(wsRaw + 'T12:00:00Z')) / 86400000);
            if (diff < 0 || diff > 6) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_DATE', message: `طھط§ط±ظٹط® ط®ظ„ظٹط© ط®ط§ط±ط¬ ط§ظ„ط£ط³ط¨ظˆط¹: ${date}` });
            }
            if (date < todayStr) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_PAST_DATE', message: `ظ„ط§ ظٹظ…ظƒظ† طھط¹ط¯ظٹظ„ ظ…ط§ط¶ظچ (${date}) â€” ط§ظ„ظ‚ط¯ظٹظ… ظ…ط­ظ…ظٹ` });
            }
            // ط®ظ„ظٹط©ظŒ ط¨ظ„ط§ ظˆظ‚طھ = ظ„ط§ ظˆط±ط¯ظٹط© ظ„ظ‡ط°ط§ ط§ظ„ظٹظˆظ… â€” ظˆظ„ط§ طھظڈط®طھط±ط¹ آ«09:00آ». ظƒط§ظ†طھ
            // ط§ظ„ط®ظ„ظٹط©ظڈ ط§ظ„ظپط§ط±ط؛ط© طھظڈط­ظپط¸ ظƒظˆط±ط¯ظٹط© ظ ظ©:ظ ظ  ط¨طھط§ط±ظٹط® ط³ط±ظٹط§ظ†ظچطŒ ظپطھطµظٹط± ظˆط±ط¯ظٹط©ظ‹
            // ظˆظ‡ظ…ظٹط© ط¹ظ„ظ‰ ط£ظٹط§ظ…ظچ ظ„ط§ ظٹط¹ظ…ظ„ ظپظٹظ‡ط§ ط§ظ„ظ…ظˆط¸ظپ: ظٹظڈظ‚ظ„ط¨ ط¯ط®ظˆظ„ظ‡ ط§ظ„ظ„ظٹظ„ظٹ آ«طھط£ط®ظٹط±ظ‹ط§آ»
            // ظˆظٹظڈظ‚طھط±ظ† ط¨ظٹظˆظ… ط§ظ„ظˆط±ط¯ظٹط© ط§ظ„ط®ط·ط£ (ظˆط§ظ‚ط¹ط© EMP-084: 16:45/09:00/04:30
            // طھطھظ†ط§ظˆط¨ ظˆظƒظ„ظ‡ط§ ط¨ط«ط§ظ†ظٹط©ظچ ظˆط§ط­ط¯ط© ظ…ظ† ظ†ظپط³ ط§ظ„ط­ظپط¸). ط¨ط¯ظ„ظ‹ط§ ظ…ظ†ظ‡ط§ طھط¨ظ‚ظ‰ ظˆط±ط¯ظٹط©
            // ط§ظ„ظ…ظˆط¸ظپ ط§ظ„ط­ط§ظ„ظٹط© ط³ط§ط±ظٹط©طŒ ظˆظٹظڈط­ظپط¸ ظٹظˆظ…ظڈ ط§ظ„ط±ط§ط­ط© ظˆط­ط¯ظ‡ ط¥ظ† ط£ظڈط±ط³ظ„.
            const startRaw = String(c.shift_start ?? '').trim();
            let startNorm = null;
            if (startRaw) {
                const sm = startRaw.match(/^(\d{1,2}):(\d{2})$/);
                if (!sm || Number(sm[1]) > 23 || Number(sm[2]) > 59) {
                    await client.query('ROLLBACK');
                    return res.status(422).json({ error: 'ROSTER_BAD_TIME', message: `ظˆظ‚طھ ط؛ظٹط± طµط§ظ„ط­ (${date}) â€” ط§ظ„طµظٹط؛ط© HH:MM` });
                }
                startNorm = `${String(sm[1]).padStart(2, '0')}:${sm[2]}`;
            }
            let hours = null;
            if (startNorm) {
                hours = Number(c.shift_hours ?? 10);
                if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
                    await client.query('ROLLBACK');
                    return res.status(422).json({ error: 'ROSTER_BAD_Karim', message: `ظ…ط¯ط© ط§ظ„ط¯ظˆط§ظ… 1-24 (${date})` });
                }
            }
            let dayOff = c.day_off ?? null;
            if (dayOff === '' || dayOff === undefined) {dayOff = null;}
            if (dayOff !== null && !(Number.isInteger(Number(dayOff)) && Number(dayOff) >= 0 && Number(dayOff) <= 6)) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_DAYOFF', message: `ظٹظˆظ… ط§ظ„ط±ط§ط­ط© 0-6 (${date})` });
            }
            clean.push({
                id, date,
                shift_start: startNorm,
                shift_karim: hours,
                day_off: dayOff === null ? null : Number(dayOff),
            });
        }
        const ids = [...new Set(clean.map((c) => c.id))];
        const cur = (await client.query(`SELECT * FROM employees WHERE id = ANY($1::bigint[]) FOR UPDATE`, [ids])).rows;
        const byId = new Map(cur.map((e) => [Number(e.id), e]));
        for (const c of clean) {
            const emp = byId.get(c.id);
            if (!emp) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: `ط§ظ„ظ…ظˆط¸ظپ ${c.id} ط؛ظٹط± ظ…ظˆط¬ظˆط¯` });
            }
            const hasDept = !!String(emp.department || '').trim();
            if (hasDept && !inScopeDepts(scope.depts, emp.department) && !(privileged && !scope.fixed)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'ROSTER_OUT_OF_SCOPE', message: `ط§ظ„ظ…ظˆط¸ظپ آ«${emp.name}آ» ظ„ظٹط³ ظپظٹ ظ‚ط³ظ…ظƒ` });
            }
            // ط£ط³ط§ط³ ط£ظˆظ„ ظ„ظ…ظ† ظ„ط§ ط£ط³ط§ط³ ظ„ظ‡ â€” ط¨ظ‡ ظٹظڈط­ظ„ ط§ظ„ظ…ط§ط¶ظٹ ط¯ط§ط¦ظ…ظ‹ط§
            await client.query(
                `INSERT INTO employee_shift_history (employee_id, shift_start, shift_karim, day_off, effective_from, created_by)
                 SELECT $1, e.shift_start, e.shift_karim, e.day_off, DATE '2000-01-01', $2 FROM employees e
                  WHERE e.id = $1 AND NOT EXISTS (SELECT 1 FROM employee_shift_history h WHERE h.employee_id = $1)
                 ON CONFLICT DO NOTHING`,
                [c.id, req.user.id]
            );
        }
        for (const c of clean) {
            const emp = byId.get(c.id);
            // ط¶ظ… ط¨ظ„ط§ ظ‚ط³ظ…: ظ„ظ„ظ…ط®ظˆظ‘ظ„ظٹظ† ظپظ‚ط· ط¹ظ†ط¯ ط­ظپط¸ ط®ظ„ط§ظٹط§ظ‡ â€” ظٹطµط¨ط­ ظ…ظ† ط§ظ„ظ‚ط³ظ…
            let dept = emp.department;
            if (!hasDeptOf(emp) && privileged && scope.depts[0]) {
                const claimTo = [...valid].find((x) => sameDept(x, scope.depts[0])) || scope.depts[0];
                dept = claimTo;
            }
            // ط®ظ„ظٹط©ظŒ ط¨ظ„ط§ ظˆظ‚طھظچ طھط±ط« ظˆط±ط¯ظٹط© ط§ظ„ظ…ظˆط¸ظپ ط§ظ„ط³ط§ط±ظٹط© (ظ„ط§ ظ ظ©:ظ ظ  ط§ظ„ظ…ط®طھط±ط¹ط©)
            const effStart = c.shift_start || emp.shift_start || '09:00';
            const effKarim = c.shift_karim != null ? c.shift_karim
                : (Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10);
            await client.query(
                `INSERT INTO employee_shift_history (employee_id, shift_start, shift_karim, day_off, effective_from, created_by)
                 VALUES ($1,$2,$3,$4,$5::date,$6)
                 ON CONFLICT (employee_id, effective_from)
                 DO UPDATE SET shift_start=EXCLUDED.shift_start, shift_karim=EXCLUDED.shift_karim,
                               day_off=EXCLUDED.day_off, created_by=EXCLUDED.created_by, created_at=NOW()`,
                [c.id, effStart, effKarim, c.day_off, c.date, req.user.id]
            );
            if (c.date === todayStr) {
                if (dept && dept !== emp.department) {
                    await client.query(`UPDATE employees SET shift_start=$2, shift_karim=$3, day_off=$4, department=$5 WHERE id=$1`, [c.id, effStart, effKarim, c.day_off, dept]);
                } else {
                    await client.query(`UPDATE employees SET shift_start=$2, shift_karim=$3, day_off=$4 WHERE id=$1`, [c.id, effStart, effKarim, c.day_off]);
                }
            }
        }
        await client.query('COMMIT');
        logger.info({ userId: req.user?.id, depts: scope.depts, cells: clean.length, week_start: wsRaw }, '[dept-roster-week] saved');
        // ط£ظٹ طھط¹ط¯ظٹظ„ ط¹ظ„ظ‰ ط´ط¨ظƒط© ط§ظ„ط£ط³ط¨ظˆط¹ ظٹظ„ط؛ظٹ ط§ط¹طھظ…ط§ط¯ ط´ط¤ظˆظ† ط§ظ„ط¹ط§ظ…ظ„ظٹظ† ط§ظ„ط³ط§ط¨ظ‚ (ط§ظ„ط³ظ„ط§ظ…ط© ط£ظˆظ„ظ‹ط§)
        try {
            await ensureRosterApprovals();
            await pool.query(`DELETE FROM roster_approvals WHERE dept_key=$1 AND week_start=$2::date`, [rosterApprovalKey(scope), wsRaw]);
        } catch (e) { logger.warn({ err: { message: String(e.message), stack: (e && e.stack) || null } }, '[dept-roster-week] طھط¹ط°ط± طھطµظپظٹط± ط§ظ„ط§ط¹طھظ…ط§ط¯ط§طھ:'); }
        try {
            makeEmitScoped(req.io)('entity_changed', { entity: 'employees', entityName: 'ط§ظ„ظ…ظˆط¸ظپظˆظ†', action: 'update', changedBy: req.user?.name || req.user?.username || 'roster', changedAt: new Date().toISOString() });
        } catch (e) { logger.debug('[dept-roster-week] طھط¹ط°ط± ط¨ط« entity_changed:', e.message); }
        res.json({ ok: true, updated: clean.length, week_start: wsRaw });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error({ err: { message: (e && e.message) || String(e), stack: (e && e.stack) || null } }, '[dept-roster-week save]');
        res.status(500).json({ error: 'ROSTER_WEEK_SAVE_FAILED', message: 'طھط¹ط°ط± ط­ظپط¸ ط´ط¨ظƒط© ط§ظ„ط£ط³ط¨ظˆط¹' });
    } finally {
        client.release();
    }
});

function hasDeptOf(emp) {return !!String(emp?.department || '').trim();}

// â”€â”€â”€ ط§ظ„ط¯ظˆط§ظ… ط§ظ„ظ…ط¬ط¯ظˆظ„ ظ„ظ…ظˆط¸ظپ ظˆط§ط­ط¯ (ط´ط§ط±ط© ط§ظ„ط¨ط·ط§ظ‚ط©): ط§ظ„ط­ط§ظ„ظٹ + ط§ظ„ظ‚ط§ط¯ظ… ظ…ط³طھظ‚ط¨ظ„ظ‹ط§ â”€â”€â”€â”€â”€
// ظ†ظپط³ ظ‚ظˆط§ط¹ط¯ ط§ظ„ط±ط¤ظٹط©: ط¥ط¯ط§ط±ط©/ط´ط¤ظˆظ† ط¹ط§ظ…ظ„ظٹظ†طŒ طµط§ط­ط¨ ط§ظ„ط³ط¬ظ„طŒ ط£ظˆ ط±ط¦ظٹط³ ظ‚ط³ظ…ظ‡
router.get('/shift-schedule/:employeeId', jwtAuth, async (req, res) => {
    try {
        const empId = Number(req.params.employeeId);
        if (!Number.isInteger(empId)) {return res.status(422).json({ error: 'INVALID_ID', message: 'ظ…ط¹ط±ظپ ط§ظ„ظ…ظˆط¸ظپ ط؛ظٹط± طµط­ظٹط­' });}
        const emp = (await pool.query(
            'SELECT id, name, department, shift_start, shift_karim, day_off FROM employees WHERE id=$1 LIMIT 1',
            [empId])).rows[0];
        if (!emp) {return res.status(404).json({ error: 'NOT_FOUND', message: 'ط§ظ„ظ…ظˆط¸ظپ ط؛ظٹط± ظ…ظˆط¬ظˆط¯' });}
        const role = req.user?.role;
        const privileged = ['admin', 'hr', 'manager'].includes(role);
        const owner = await pool.query('SELECT 1 FROM employees WHERE id=$1 AND "userId"=$2 LIMIT 1', [empId, req.user.id]);
        const isOwner = owner.rows.length > 0;
        let sameDept = false;
        if (role === 'dept_head' && req.user?.dept_code) {
            sameDept = String(emp.department || '').toLowerCase() === String(req.user.dept_code).toLowerCase();
        }
        if (!privileged && !isOwner && !sameDept) {
            return res.status(403).json({ error: 'FORBIDDEN', message: 'ظ„ط§ طھظ…ظ„ظƒ طµظ„ط§ط­ظٹط© ط¹ط±ط¶ ظ‡ط°ط§ ط§ظ„ط³ط¬ظ„' });
        }
        const sched = (await pool.query(
            `SELECT shift_start, shift_karim, day_off, effective_from::text AS effective_from
               FROM employee_shift_history
              WHERE employee_id=$1 AND effective_from > CURRENT_DATE AND effective_from <> DATE '2000-01-01'
              ORDER BY effective_from ASC LIMIT 5`,
            [empId])).rows;
        res.json({
            ok: true,
            current: { shift_start: emp.shift_start, shift_karim: emp.shift_karim, day_off: emp.day_off },
            scheduled: sched,
        });
    } catch (_) {
        res.status(500).json({ error: 'SCHEDULE_FAILED', message: 'طھط¹ط°ط± ط¬ظ„ط¨ ط§ظ„ط¯ظˆط§ظ… ط§ظ„ظ…ط¬ط¯ظˆظ„' });
    }
});

// â”€â”€â”€ طھط±ط­ظٹظ„ ط§ظ„ط¯ظˆط§ظ…ط§طھ ط§ظ„ظ…ط¬ط¯ظˆظ„ط©: ظƒظ„ ط¥ظ‚ظ„ط§ط¹ + ظƒظ„ 5 ط¯ظ‚ط§ط¦ظ‚ ظٹط·ط¨ظ‚ ظ…ط§ ط­ط§ظ† طھط§ط±ظٹط®ظ‡ â”€â”€â”€
// idempotent طھظ…ط§ظ…ظ‹ط§ (ظٹط­ط¯ظ‘ط« ط§ظ„ظ…ط®طھظ„ظپ ظپظ‚ط·). fail-open: ط£ظٹ ط®ط·ط£ ظٹظڈط³ط¬ظژظ‘ظ„ ظپظ‚ط·.
let _rosterRolloverTimer = null;
async function rosterRolloverOnce() {
    try {
        const r = await pool.query(
            `UPDATE employees e SET shift_start = h.shift_start, shift_karim = h.shift_karim, day_off = h.day_off
               FROM (SELECT DISTINCT ON (employee_id) employee_id, shift_start, shift_karim, day_off
                       FROM employee_shift_history WHERE effective_from <= CURRENT_DATE
                       ORDER BY employee_id, effective_from DESC) h
              WHERE e.id = h.employee_id
                AND (e.shift_start IS DISTINCT FROM h.shift_start
                  OR e.shift_karim IS DISTINCT FROM h.shift_karim
                  OR e.day_off IS DISTINCT FROM h.day_off)`
        );
        if (r.rowCount > 0) {logger.info({ n: r.rowCount }, '[dept-roster] rollover applied scheduled shifts');}
        return r.rowCount || 0;
    } catch (e) {
        logger.warn('[dept-roster] rollover skipped: ' + String(e?.message || e).slice(0, 150));
        return 0;
    }
}
function startShiftRollover() {
    if (_rosterRolloverTimer) {return;}
    rosterRolloverOnce();
    _rosterRolloverTimer = setInterval(rosterRolloverOnce, 5 * 60 * 1000);
    if (typeof _rosterRolloverTimer.unref === 'function') {_rosterRolloverTimer.unref();}
    logger.info('[dept-roster] rollover on (boot + every 5m)');
}

module.exports = { router, provisionCard, signQrPayload, calculateMinutes, startShiftRollover, rosterRolloverOnce, computeMonthDeductions };

// â•گâ•گâ•گ ط¥ط¯ط§ط±ط© ظ…ظˆط¸ظپظٹ ط§ظ„ظ‚ط³ظ… ظ„ط±ط¦ظٹط³ ط§ظ„ظ‚ط³ظ… (UPGRADE 2026-10-01) â•گâ•گâ•گ
// ط±ط¦ظٹط³ ط§ظ„ظ‚ط³ظ… ظٹط¶ظٹظپ/ظٹط¹ط¯ظ„/ظٹط¹ط·ظ‘ظ„ ظ…ظˆط¸ظپظٹ ظ‚ط³ظ…ظ‡ ط­طµط±ظ‹ط§ â€” ط¨ط­ظ‚ظˆظ„ ط¢ظ…ظ†ط© ظپظ‚ط·
// (ط¨ط¯ظˆظ† ط§ظ„ط±ط§طھط¨/ط§ظ„ط­ط§ظ„ط©/ط§ظ„ظ‚ط³ظ…/ط§ظ„ط±ط¨ط· ط¨ط§ظ„ط­ط³ط§ط¨ط§طھ â€” طھظ„ظƒ ظ„ظ€ hr/admin).
// ط§ظ„ظ†ط·ط§ظ‚ ظ†ظپط³ظ‡ ط§ظ„ظ…ط¹طھظ…ط¯ ظپظٹ rosterScope (dept_code ط¨ظ‚ط§ط¦ظ…ط© ظپظˆط§طµظ„).
function deptHeadEmpScope(user) {
    const myCode = String(user?.dept_code || '').trim();
    if (user?.role !== 'dept_head' || !myCode) {return null;}
    return { depts: myCode.split(',').map((x) => x.trim()).filter(Boolean) };
}
const inEmpScope = (empRow, depts) => (depts || []).some((d) => String(empRow.department || '').trim().toLowerCase() === String(d).toLowerCase());

router.get('/dept-employees', jwtAuth, requireRole('dept_head'), async (req, res, next) => {
    try {
        const scope = deptHeadEmpScope(req.user);
        if (!scope) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'ط­ط³ط§ط¨ظƒ ط؛ظٹط± ظ…ط±طھط¨ط· ط¨ظ‚ط³ظ… â€” ط±ط§ط¬ط¹ ط§ظ„ط¥ط¯ط§ط±ط©' });}
        const rows = (await pool.query(
            `SELECT e.id, e.name, e."employeeId", e.position, e.phone, e.department, e.status
             FROM employees e WHERE e.status = 'active' ORDER BY e.name`
        )).rows;
        const list = rows.filter((e) => inEmpScope(e, scope.depts));
        res.json({ ok: true, depts: scope.depts, employees: list });
    } catch (e) { next(e); }
});

router.post('/dept-employees', jwtAuth, requireRole('dept_head'), async (req, res, next) => {
    try {
        const scope = deptHeadEmpScope(req.user);
        if (!scope) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'ط­ط³ط§ط¨ظƒ ط؛ظٹط± ظ…ط±طھط¨ط· ط¨ظ‚ط³ظ…' });}
        const name = String(req.body?.name || '').trim().slice(0, 255);
        const employeeId = String(req.body?.employeeId || '').trim().slice(0, 50);
        const position = String(req.body?.position || '').trim().slice(0, 255) || null;
        const phone = String(req.body?.phone || '').trim().slice(0, 50) || null;
        if (!name || !employeeId) {return res.status(422).json({ ok: false, error: 'VALIDATION_ERROR', message: 'ط§ظ„ط§ط³ظ… ظˆط§ظ„ط±ظ‚ظ… ط§ظ„ظˆط¸ظٹظپظٹ ط¥ط¬ط¨ط§ط±ظٹط§ظ†' });}
        if (!/^[A-Za-z0-9_-]{2,50}$/.test(employeeId)) {return res.status(422).json({ ok: false, error: 'VALIDATION_ERROR', message: 'ط§ظ„ط±ظ‚ظ… ط§ظ„ظˆط¸ظٹظپظٹ: ط­ط±ظˆظپ ظ„ط§طھظٹظ†ظٹط©/ط£ط±ظ‚ط§ظ… ظپظ‚ط· (2-50)' });}
        const dup = (await pool.query('SELECT id FROM employees WHERE "employeeId" = $1', [employeeId])).rows[0];
        if (dup) {return res.status(409).json({ ok: false, error: 'DUPLICATE', message: 'ط§ظ„ط±ظ‚ظ… ط§ظ„ظˆط¸ظٹظپظٹ ظ…ط³طھط®ط¯ظ… ط¨ط§ظ„ظپط¹ظ„' });}
        const id = (await pool.query('SELECT COALESCE(MAX(id),0)+1 AS id FROM employees')).rows[0].id;
        const ins = await pool.query(
            `INSERT INTO employees (id, name, "employeeId", department, position, phone, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'active') RETURNING id, name, "employeeId", department, position, phone, status`,
            [id, name, employeeId, scope.depts[0], position, phone]
        );
        logger.info('[dept-employees] created by dept_head', { by: req.user.username, dept: ins.rows[0].department });
        res.status(201).json({ ok: true, employee: ins.rows[0] });
    } catch (e) { next(e); }
});

router.put('/dept-employees/:id', jwtAuth, requireRole('dept_head'), async (req, res, next) => {
    try {
        const scope = deptHeadEmpScope(req.user);
        if (!scope) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'ط­ط³ط§ط¨ظƒ ط؛ظٹط± ظ…ط±طھط¨ط· ط¨ظ‚ط³ظ…' });}
        const row = (await pool.query('SELECT id, name, department, status FROM employees WHERE id = $1', [String(req.params.id)])).rows[0];
        if (!row) {return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'ط§ظ„ظ…ظˆط¸ظپ ط؛ظٹط± ظ…ظˆط¬ظˆط¯' });}
        if (!inEmpScope(row, scope.depts)) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'ظ‡ط°ط§ ط§ظ„ظ…ظˆط¸ظپ ظ„ظٹط³ ظ…ظ† ظ‚ط³ظ…ظƒ' });}
        const name = String(req.body?.name || row.name).trim().slice(0, 255) || row.name;
        const position = req.body?.position !== undefined ? String(req.body.position || '').trim().slice(0, 255) || null : row.position;
        const phone = req.body?.phone !== undefined ? String(req.body.phone || '').trim().slice(0, 50) || null : row.phone;
        const upd = await pool.query(
            'UPDATE employees SET name = $1, position = $2, phone = $3 WHERE id = $4 RETURNING id, name, "employeeId", department, position, phone, status',
            [name, position, phone, row.id]
        );
        logger.info('[dept-employees] updated by dept_head', { by: req.user.username, emp: row.id });
        res.json({ ok: true, employee: upd.rows[0] });
    } catch (e) { next(e); }
});

router.delete('/dept-employees/:id', jwtAuth, requireRole('dept_head'), async (req, res, next) => {
    try {
        const scope = deptHeadEmpScope(req.user);
        if (!scope) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'ط­ط³ط§ط¨ظƒ ط؛ظٹط± ظ…ط±طھط¨ط· ط¨ظ‚ط³ظ…' });}
        const row = (await pool.query('SELECT id, name, department, status FROM employees WHERE id = $1', [String(req.params.id)])).rows[0];
        if (!row) {return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'ط§ظ„ظ…ظˆط¸ظپ ط؛ظٹط± ظ…ظˆط¬ظˆط¯' });}
        if (!inEmpScope(row, scope.depts)) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'ظ‡ط°ط§ ط§ظ„ظ…ظˆط¸ظپ ظ„ظٹط³ ظ…ظ† ظ‚ط³ظ…ظƒ' });}
        // طھط¹ط·ظٹظ„ ط¢ظ…ظ† (ظٹط­ظپط¸ ط§ظ„طھط§ط±ظٹط®) ط¨ط¯ظ„ ط§ظ„ط­ط°ظپ ط§ظ„ظ†ظ‡ط§ط¦ظٹ â€” ط§ظ„ط­ط°ظپ ط§ظ„ظ†ظ‡ط§ط¦ظٹ ظ„ظ€ hr/admin
        const upd = await pool.query("UPDATE employees SET status = 'inactive' WHERE id = $1 RETURNING id, status", [row.id]);
        logger.info('[dept-employees] deactivated by dept_head', { by: req.user.username, emp: row.id });
        res.json({ ok: true, deactivated: true, employee: upd.rows[0] });
    } catch (e) { next(e); }
});
