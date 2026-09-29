const express = require('express');
const crypto = require('crypto');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const { buildMonthlyAttendanceSummaryQuery } = require('./monthly-attendance-query');
const { shiftDateFor, shiftDateForEmployee, prevDay, isLate, isEarlyLeave, lockGraceMinutes, graceMinutes, calculateDelayParts } = require('./shift-day');
const { calculateTotalLateMinutes } = require('./attendance-engine');

const router = express.Router();
const QR_SECRET = process.env.EMPLOYEE_QR_SECRET || process.env.JWT_SECRET;
const ADMIN_ROLES = ['admin', 'hr', 'manager'];

const WORK_DAY_MINUTES = 10 * 60;
function requireQrSecret(res) {
    if (!QR_SECRET) {
        res.status(503).json({ error: 'EMPLOYEE_QR_SECRET_NOT_CONFIGURED', message: 'لم يتم إعداد مفتاح QR للموظفين' });
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

function generateEmployeeToken(employee) {
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

function riyadhNowParts(date = new Date()) {
    // Business timezone: Asia/Riyadh (UTC+3, no DST). Using one consistent clock
    // for the attendance date, time and late-flag avoids wrong-day records around
    // midnight (a UTC date with local hours produced off-by-one-day rows).
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
    const hour = Number(parts.hour === '24' ? '0' : parts.hour);
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour, minute: Number(parts.minute) };
}

function calculateMinutes(row) {
    // المصدر الأول: النصان المعروضان (HH:MM) — ما تراه العين هو ما يُحسب.
    // يمنع قيمًا شاذة (25:43) من أزمنة instant متقطعة الأيام. التفاف ليلي فقط عند out<in.
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

function parseTimeMinutes(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {return null;}
    return Number(m[1]) * 60 + Number(m[2]);
}

function getShiftStartMinutes(employee) {
    const s = String(employee?.shift_start || '').trim();
    const v = parseTimeMinutes(s);
    if (v != null) {return v;}
    const fallback = Number(process.env.WORK_START_HOUR || 9);
    return fallback * 60;
}

/**
 * حساب دقائق التأخير الكلي (الحضور + الانصراف المبكر)
 * يستخدم المحرك الموحد في attendance-engine.js
 */
function calculateLateMinutes(row, employee) {
    return calculateTotalLateMinutes({
        checkIn: row.checkIn,
        checkOut: row.checkOut,
        shiftStart: employee?.shift_start,
        shiftKarim: employee?.shift_karim,
    });
}

async function getEmployee(client, id) {
    const result = await client.query(`SELECT * FROM employees WHERE id = $1`, [id]);
    return result.rows[0] || null;
}

router.get('/employees/:id/card', jwtAuth, async (req, res) => {
    if (!requireQrSecret(res)) {return;}
    const employee = await getEmployee(pool, Number(req.params.id));
    if (!employee) {return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: 'الموظف غير موجود' });}
    if (!canAccessEmployee(req, employee)) {return res.status(403).json({ error: 'FORBIDDEN', message: 'لا تملك صلاحية عرض بطاقة هذا الموظف' });}

    let card = { employee, qrPayload: null };
    if (!employee.qrTokenHash || !employee.qrTokenEncrypted || !employee.cardId || employee.cardStatus !== 'active') {
        card = await provisionCard(pool, employee);
    } else {
        const token = decryptToken(employee.qrTokenEncrypted);
        card.qrPayload = token ? buildQrPayload(employee, token) : null;
        if (!card.qrPayload) {card = await provisionCard(pool, employee);}
    }
    res.json({ ...card, qrAvailable: Boolean(card.qrPayload), message: card.qrPayload ? null : 'اضغط تجديد QR لإظهار رمز جديد' });
});

router.post('/employees/:id/qr/regenerate', jwtAuth, requireRole('admin', 'hr', 'manager'), async (req, res) => {
    if (!requireQrSecret(res)) {return;}
    const employee = await getEmployee(pool, Number(req.params.id));
    if (!employee) {return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: 'الموظف غير موجود' });}
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
        logger.error('[hr_qr_regenerate]', e);
        res.status(500).json({ error: 'QR_REGENERATE_FAILED', message: 'تعذر تجديد بطاقة QR' });
    } finally { client.release(); }
});

router.get('/attendance/report', jwtAuth, async (req, res) => {
    try {
    let employeeId = req.query.employee_id ? Number(req.query.employee_id) : null;
    if (!ADMIN_ROLES.includes(req.user?.role)) {
        const own = await pool.query(`SELECT id FROM employees WHERE "userId" = $1`, [req.user.id]);
        employeeId = own.rows[0]?.id || null;
    }
    if (!employeeId) {return res.status(400).json({ error: 'EMPLOYEE_REQUIRED', message: 'يجب تحديد الموظف' });}
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
        const workMinutes = calculateMinutes(row);
        const needsReview = Boolean(row.checkIn && row.checkOut && workMinutes === 0);
        return { ...row, workMinutes, needsReview, ...calculateDelayParts(row, empRow) };
    });

    // الصفوف الغامضة (بصمة واحدة مكررة دخولًا وخروجًا = صفر ساعات) تُستبعد من الإجمالي
    // وتُعرض منفصلة كـ "قيد المراجعة" بدل تلويث الأرقام المعتمدة.
    const countable = records.filter(r => !r.needsReview);
    const reviewRows = records.filter(r => r.needsReview);
    const reviewMinutes = reviewRows.reduce((s, r) => s + (r.lateMinutes || 0), 0);
    const totalLateMinutes = countable.reduce((s, r) => s + (r.lateMinutes || 0), 0);
    const empWorkDayMinutes = (Number(empRow?.shift_karim) > 0 ? Number(empRow.shift_karim) : 10) * 60;
    const lateRemainingMinutes = totalLateMinutes % empWorkDayMinutes;
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
    };
    summary.totalKarim = Number((summary.totalMinutes / 60).toFixed(2));
    res.json({ employee: result.rows[0] ? { id: employeeId, name: result.rows[0].name, employeeId: result.rows[0].employeeId, position: result.rows[0].position, shift_start: empRow?.shift_start, shift_karim: empRow?.shift_karim } : null, records, summary });
    } catch (e) {
        logger.error('[hr_attendance_report]', e);
        res.status(500).json({ error: 'ATTENDANCE_REPORT_FAILED', message: 'تعذر جلب تقرير الحضور والانصراف' });
    }
});

/** إعدادات بطاقات الموظفين (رابط التحقق + طوارئ) — تحكم من الواجهة بدل الكود */
router.get('/card-settings', jwtAuth, async (req, res) => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS hr_card_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        const rows = (await pool.query(`SELECT key, value FROM hr_card_settings`)).rows;
        const o = Object.fromEntries(rows.map(r => [r.key, r.value]));
        res.json({ ok: true, verifyBase: o.verify_base || process.env.CARD_VERIFY_BASE || 'https://192.168.1.165:5000', emergencyPhone: o.emergency_phone || process.env.EMERGENCY_PHONE || '' });
    } catch (e) {
        logger.error('[hr_card_settings_get]', e);
        res.status(500).json({ error: 'CARD_SETTINGS_FAILED' });
    }
});
router.put('/card-settings', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS hr_card_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        const base = String(req.body?.verifyBase || '').trim().replace(/\/$/, '');
        if (base && !/^https?:\/\//i.test(base)) {return res.status(422).json({ error: 'BAD_URL', message: 'الرابط يجب أن يبدأ بـ http:// أو https://' });}
        const emg = String(req.body?.emergencyPhone || '').trim().slice(0, 30);
        if (base) {await pool.query(`INSERT INTO hr_card_settings (key, value, updated_at) VALUES ('verify_base', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [base]);}
        await pool.query(`INSERT INTO hr_card_settings (key, value, updated_at) VALUES ('emergency_phone', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [emg]);
        res.json({ ok: true });
    } catch (e) {
        logger.error('[hr_card_settings_put]', e);
        res.status(500).json({ error: 'CARD_SETTINGS_SAVE_FAILED' });
    }
});

/** بطاقة الموظف الفاخرة (توليد حي + عرض طباعة) */
router.get('/employees/:id/lux-card', jwtAuth, async (req, res) => {
    try {
    if (!ADMIN_ROLES.includes(req.user?.role)) {
        const own = await pool.query(`SELECT id FROM employees WHERE "userId" = $1`, [req.user.id]);
        if (!own.rows[0] || Number(own.rows[0].id) !== Number(req.params.id)) {
            return res.status(403).json({ error: 'FORBIDDEN', message: 'بطاقتك فقط' });
        }
    }
    const emp = (await pool.query(`SELECT * FROM employees WHERE id = $1`, [Number(req.params.id)])).rows[0];
    if (!emp) {return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: 'الموظف غير موجود' });}
    const fp = String(emp.deviceUserId || emp.employeeId || '').trim();
    if (!fp) {return res.status(422).json({ error: 'NO_FP_NUMBER', message: 'الموظف بلا رقم بصمة' });}
    const { spawnSync } = require('child_process');
    const path = require('path');
    const fs = require('fs');
    const gen = path.join(__dirname, '..', 'tools', 'employee-card', 'generate-card.js');
    const r = spawnSync(process.execPath, [gen, '--fp', fp], { encoding: 'utf-8', timeout: 60000 });
    if (r.status !== 0) {
        logger.error('[lux_card] generate failed: ' + String(r.stderr || '').slice(0, 200));
        return res.status(500).json({ error: 'CARD_FAILED', message: 'تعذر توليد البطاقة' });
    }
    const file = path.join(__dirname, '..', 'tools', 'employee-card', 'out', `card-${fp}.html`);
    res.type('html').send(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        logger.error('[hr_lux_card]', e);
        res.status(500).json({ error: 'LUX_CARD_FAILED', message: 'تعذر توليد البطاقة' });
    }
});

/** كشف شهري مجمع لكل الموظفين (طباعة بأقل صفحات) */
router.get('/attendance/monthly', jwtAuth, async (req, res) => {
    try {
    if (!ADMIN_ROLES.includes(req.user?.role)) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'التقرير الشهري للإدارة فقط' });
    }
    const m = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : new Date().toISOString().slice(0, 7);
    const detail = req.query.detail === '1';
    const { rows } = await pool.query(buildMonthlyAttendanceSummaryQuery(), [m]);
    // حساب إجمالي التأخير لكل موظف بدقة (دقائق فعلية) - استبعاد أيام الإجازة والصفوف الغامضة
    const detailed = await pool.query(
        `SELECT a."employeeId", a."checkIn", a."checkOut", a."workMinutes", e.shift_start, e.shift_karim FROM attendance a JOIN employees e ON e.id=a."employeeId"
          WHERE e.status='active' AND a.date LIKE $1 || '-%' AND a."checkIn" IS NOT NULL AND NOT a.on_leave`, [m]);
    const lateMap = new Map();
    const lateDaysMap = new Map();
    const reviewMap = new Map();
    const reviewDaysMap = new Map();
    for (const r of detailed.rows) {
        const mins = calculateLateMinutes(r, { shift_start: r.shift_start, shift_karim: r.shift_karim });
        const wm = Number(r.workMinutes);
        const needsReview = Boolean(r.checkIn && r.checkOut && (Number.isFinite(wm) ? wm === 0 : false));
        if (needsReview) {
            reviewMap.set(r.employeeId, (reviewMap.get(r.employeeId) || 0) + mins);
            reviewDaysMap.set(r.employeeId, (reviewDaysMap.get(r.employeeId) || 0) + 1);
            continue;
        }
        lateMap.set(r.employeeId, (lateMap.get(r.employeeId) || 0) + mins);
        if (mins > 0) {
            lateDaysMap.set(r.employeeId, (lateDaysMap.get(r.employeeId) || 0) + 1);
        }
    }
    const out = { month: m, employees: rows.map(r => {
        const lm = lateMap.get(r.id) || 0;
        const lateDays = lateDaysMap.get(r.id) || 0;
        const empWorkDayMinutes = (Number(r.shift_karim) > 0 ? Number(r.shift_karim) : 10) * 60;
        return { ...r, workDayMinutes: empWorkDayMinutes, karimHours: Number((r.minutes / 60).toFixed(1)), lateMinutes: lm, lateHours: Number((lm/60).toFixed(2)), lateDays: lateDays, leaveDays: r.leave_days || 0, reviewDays: reviewDaysMap.get(r.id) || 0, reviewMinutes: reviewMap.get(r.id) || 0, lateRemainingHours: Number(((lm % empWorkDayMinutes)/60).toFixed(2)) };
    }) };
    // متوسط ساعات يوم العمل لكل الموظفين (للعرض في رأس التقرير)
    out.workDayMinutes = 600; // افتراضي 10 ساعات
    if (detail) {
        const det = await pool.query(
            `SELECT a."employeeId", a.date, a."checkIn", a."checkOut", a."workMinutes", a.late, e.shift_start, e.shift_karim
               FROM attendance a JOIN employees e ON e.id = a."employeeId"
              WHERE e.status = 'active' AND a.date LIKE $1 || '-%' ORDER BY a.date, e.name`, [m]);
        out.days = det.rows.map(r => ({ ...r, workMinutes: calculateMinutes(r), ...calculateDelayParts(r, r) }));
    }
    res.json({ ok: true, ...out });
    } catch (e) {
        logger.error('[hr_attendance_monthly]', e);
        res.status(500).json({ error: 'ATTENDANCE_MONTHLY_FAILED', message: 'تعذر جلب الكشف الشهري' });
    }
});

/** تدقيق صارم لسلامة بيانات الحضور — نفس فحوصات scripts/strict-audit.js للواجهة */
router.get('/strict-audit', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    try {
    const m = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : null;
    const { runStrictAudit } = require('./strict-audit-lib');
    const result = await runStrictAudit(m);
    res.json({ ok: result.ok, ...result });
    } catch (e) {
        logger.error('[hr_strict_audit]', e);
        res.status(500).json({ error: 'STRICT_AUDIT_FAILED', message: 'تعذر تشغيل التدقيق الصارم' });
    }
});

router.post('/attendance/scan', jwtAuth, requireRole('admin', 'hr', 'manager'), async (req, res) => {
    if (!requireQrSecret(res)) {return;}
    const data = req.body?.qr_payload || req.body?.qrPayload || req.body;
    if (!data || data.system !== 'Karim ERP' || data.type !== 'employee_card' || !data.employeeId || !data.cardId || !data.token || !data.signature) {
        return res.status(422).json({ error: 'INVALID_EMPLOYEE_QR', message: 'رمز QR الخاص بالموظف غير صالح' });
    }
    const expected = signQrPayload({ employeeId: data.employeeId, cardId: data.cardId, version: data.qrVersion, token: data.token });
    // timingSafeEqual throws RangeError on length mismatch — validate the
    // signature format first so a malformed payload cannot hang the request
    const providedSignature = String(data.signature || '');
    const expectedSignature = String(expected || '');
    if (!/^[a-f0-9]{64}$/i.test(providedSignature) || providedSignature.length !== expectedSignature.length
        || !crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
        return res.status(422).json({ error: 'INVALID_QR_SIGNATURE', message: 'توقيع بطاقة الموظف غير صالح' });
    }
    const employeeResult = await pool.query(`SELECT * FROM employees WHERE "employeeId" = $1 AND "cardId" = $2`, [data.employeeId, data.cardId]);
    const employee = employeeResult.rows[0];
    if (!employee || employee.status !== 'active' || employee.cardStatus !== 'active' || employee.qrTokenHash !== hashToken(data.token) || Number(employee.qrVersion) !== Number(data.qrVersion)) {
        return res.status(422).json({ error: 'STALE_EMPLOYEE_QR', message: 'البطاقة غير صالحة أو تم تجديدها' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const now = new Date();        // One consistent business clock for date, time and the late flag
        const parts = riyadhNowParts(now);
        const today = parts.date;
        const time = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
        // يوم الوردية + بداية وردية الموظف (الترحيل لليوم السابق للورديات الليلية فقط)
        const shiftStart = /^\d{1,2}:\d{2}$/.test(String(employee.shift_start || '')) ? String(employee.shift_start) : null;
        const shiftDate = shiftDateForEmployee(today, parts.hour, employee);
        const yesterday = prevDay(shiftDate);
        const lateFor = () => isLate(parts.hour, parts.minute, shiftStart, Number(process.env.WORK_START_HOUR || 9));
        let existing = (await client.query(`SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2 FOR UPDATE`, [employee.id, shiftDate])).rows[0] || null;
        // لا صف مفتوح اليوم لكن أمس مفتوح → هذا انصراف وردية ليلية
        if (!existing || existing.checkOut) {
            const prev = (await client.query(
                `SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2 AND "checkOut" IS NULL FOR UPDATE`,
                [employee.id, yesterday])).rows[0] || null;
            if (prev) {existing = prev;}
        }
        let record;
        let action;
        // قفل اليوم: مغلق باستنتاج + موظف مقفل + خارج نافذة 10 دقائق → بصمات لاحقة مرفوضة
        if (existing && existing.checkout_inferred && employee.auto_lock === true) {
            const m = String(shiftStart || '09:00').match(/^(\d{1,2}):(\d{2})$/);
            const hrs = Number(employee.shift_karim) > 0 ? Number(employee.shift_karim) : 10;
            const [y, mo, d] = (existing.date || shiftDate).split('-').map(Number);
            const endMs = Date.UTC(y, mo - 1, d, 0, 0) + ((m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60) + Math.round(hrs * 60)) * 60000 - 3 * 3600000;
            if (now.getTime() > endMs + lockGraceMinutes() * 60000) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'SHIFT_LOCKED', message: 'انتهت ورديتك وسُجّل انصرافك تلقائيًا — راجع الإدارة' });
            }
        }
        if (!existing) {
            record = (await client.query(
                `INSERT INTO attendance (id, "employeeId", date, "checkIn", late, notes, "checkInAt", source, "operatorId")
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'qr',$8) RETURNING *`,
                [Date.now() + Math.floor(Math.random() * 9999), employee.id, shiftDate, time, lateFor(), 'تسجيل حضور عبر QR', now, req.user.id]
            )).rows[0];
            action = 'check_in';
        } else if (!existing.checkOut) {
            const current = existing;
            const empShiftH = Number(employee.shift_karim) > 0 ? Number(employee.shift_karim) : 10;
            const early = isEarlyLeave(parts.hour, parts.minute, shiftStart, empShiftH);
            const minutes = Math.max(0, Math.round((now - new Date(current.checkInAt || `${current.date}T${current.checkIn}:00`)) / 60000));
            record = (await client.query(
                `UPDATE attendance SET "checkOut"=$1, "checkOutAt"=$2, "workMinutes"=$3, early_leave=$6, source='qr', "operatorId"=$4, notes=COALESCE(notes,'') || ' | تسجيل انصراف عبر QR' WHERE id=$5 RETURNING *`,
                [time, now, minutes, req.user.id, current.id, early]
            )).rows[0];
            action = 'check_out';
        } else {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'ATTENDANCE_COMPLETE', message: 'تم تسجيل حضور وانصراف الموظف لهذا اليوم', employee, record: existing });
        }
        await client.query('COMMIT');
        const payload = { action, employee: { id: employee.id, name: employee.name, employeeId: employee.employeeId, department: employee.department }, record };
        if (req.io) {req.io.emit('attendance:updated', payload);}
        res.json(payload);
    } catch (e) {
        await client.query('ROLLBACK');
        logger.error('[hr_attendance_scan]', e);
        res.status(500).json({ error: 'ATTENDANCE_SCAN_FAILED', message: 'تعذر تسجيل الحركة' });
    } finally { client.release(); }
});

// ─── إلغاء جماعي للاستكمال التلقائي (مدير فقط) ────────────────────────────
// يمسح القيم المستنتَجة ويعيد الصفوف مفتوحة، ويحذف الصفوف التي فرغت تمامًا.
// لا يمس أي قيمة حقيقية (بصمة/QR/يدوي) أبدًا.
router.post('/attendance/revert-inferred', jwtAuth, requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const out = await client.query(
            `UPDATE attendance SET "checkOut" = NULL, "checkOutAt" = NULL,
                 "workMinutes" = NULL, checkout_inferred = false, early_leave = false,
                 notes = COALESCE(notes, '') || ' | أُلغي الاستكمال جماعيًا'
             WHERE checkout_inferred = true`
        );
        const inc = await client.query(
            `UPDATE attendance SET "checkIn" = NULL, "checkInAt" = NULL, late = false,
                 "workMinutes" = NULL, checkin_inferred = false,
                 notes = COALESCE(notes, '') || ' | أُلغي الاستكمال جماعيًا'
             WHERE checkin_inferred = true`
        );
        const del = await client.query(
            `DELETE FROM attendance WHERE "checkIn" IS NULL AND "checkOut" IS NULL RETURNING id`
        );
        await client.query('COMMIT');
        logger.info(`[hr_attendance_revert] جماعي بواسطة ${req.user.username}: خروج ${out.rowCount} — دخول ${inc.rowCount} — حذف فارغ ${del.rowCount}`);
        res.json({ ok: true, clearedCheckouts: out.rowCount, clearedCheckins: inc.rowCount, deletedEmpty: del.rowCount });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[hr_attendance_revert]', e);
        res.status(500).json({ error: 'REVERT_FAILED', message: 'تعذر الإلغاء الجماعي' });
    } finally { client.release(); }
});

// ─── توليد مسير رواتب شهر (admin/hr/manager) ───────────────────────────────
// أساسي + أوفرتايم من البصمات (فوق ساعات الوردية) + علاوات − جزاءات/خصومات − أقساط السلف.
// idempotent: إعادة التوليد لنفس الشهر تحدّث الصفوف. يُرحّل محاسبيًا عبر /accounting/post-payroll.
router.post('/payroll-runs/generate', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    const month = String(req.body?.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {return res.status(422).json({ error: 'PAYROLL_MONTH_INVALID', message: 'الشهر بصيغة YYYY-MM' });}
    const [year, mon] = month.split('-').map(Number);
    if (mon < 1 || mon > 12) {return res.status(422).json({ error: 'PAYROLL_MONTH_INVALID', message: 'شهر غير صالح' });}
    const includeOvertime = req.body?.includeOvertime === true;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const emps = (await client.query(
            `SELECT id, name, salary, shift_start, shift_karim FROM employees WHERE status = 'active' ORDER BY id`)).rows;
        const detail = [];
        let tBasic = 0, tOt = 0, tBonus = 0, tPen = 0, tAdv = 0, tNet = 0;
        for (const emp of emps) {
            const basic = Number(emp.salary || 0);
            const sHours = Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10;
            const hourly = sHours > 0 ? basic / 30 / sHours : 0;
            // الأوفرتايم اختياري — يحسب بس لو الأدمن حطه (من البصمات)
            const att = (await client.query(
                `SELECT "workMinutes" FROM attendance
                  WHERE "employeeId" = $1 AND date LIKE $2 AND "checkIn" IS NOT NULL AND "checkOut" IS NOT NULL`,
                [emp.id, `${month}-%`])).rows;
            const daysPresent = att.length;
            const expectedDay = Math.round(sHours * 60);
            let otMinutes = 0;
            let overtimePay = 0;
            if (includeOvertime) {
                for (const a of att) {
                    const w = Number(a.workMinutes);
                    if (Number.isFinite(w) && w > expectedDay) {otMinutes += w - expectedDay;}
                }
                overtimePay = Math.round((otMinutes / 60) * hourly * 100) / 100;
            }
            // الجزاءات/العلاوات الشهرية
            const adj = (await client.query(
                `SELECT kind, COALESCE(SUM(amount),0)::numeric(14,2) AS t FROM payroll_adjustments
                  WHERE "employeeId" = $1 AND month = $2 GROUP BY kind`, [emp.id, month])).rows;
            let bonus = 0, penalty = 0;
            for (const a of adj) {
                if (a.kind === 'bonus' || a.kind === 'allowance') {bonus += Number(a.t);}
                else {penalty += Number(a.t);}
            }
            // أقساط السلف النشطة — قسط واحد شهريًا مهما أُعيد التوليد
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
                if (!applied.rows[0]) {continue;} // مطبّق مسبقًا لهذا الشهر — لا خصم مكرر
                const left = Math.round((Number(a.remaining) - inst) * 100) / 100;
                await client.query(`UPDATE salary_advances SET remaining = $2, status = $3 WHERE id = $1`,
                    [a.id, left, left <= 0 ? 'closed' : 'active']);
            }
            // إجمالي أقساط الشهر = كل التطبيقات المسجلة لهذا الشهر (إعادة التوليد تعيد نفس الأرقام)
            const advSum = await client.query(
                `SELECT COALESCE(SUM(aa.amount),0)::numeric(12,2) AS t FROM advance_applications aa
                  JOIN salary_advances sa ON sa.id = aa.advance_id
                  WHERE sa."employeeId" = $1 AND aa.month = $2`, [emp.id, month]);
            advDed = Math.round(Number(advSum.rows[0]?.t || 0) * 100) / 100;
            const allowances = Math.round((overtimePay + bonus) * 100) / 100;
            const deductions = Math.round((penalty + advDed) * 100) / 100;
            const net = Math.round((basic + allowances - deductions) * 100) / 100;
            const eid = Date.now() * 1000 + Math.floor(Math.random() * 1000) + emp.id % 1000;
            // idempotent: حدّث صف الشهر إن وُجد وإلا أنشئه (بلا قيد فريد جديد)
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
        logger.error('[hr_payroll_run]', e);
        res.status(500).json({ error: 'PAYROLL_RUN_FAILED', message: 'تعذر توليد المسير' });
    } finally { client.release(); }
});

/** تحقق مختصر من بطاقة موظف (QR الجديد الخفيف) — GET /card/v/<cardId>.<sig16>
 * نفس الأمان: sig16 = أول 16 hex من HMAC(cardId) — والتحقق الكامل من DB.
 * البطاقات القديمة (d/s) تعمل كما هي — لا كسر للخلف. */
router.get('/card/v/:code', async (req, res) => {
    try {
        if (!QR_SECRET) {return res.status(503).send('التحقق غير مهيأ');}
        const parts = String(req.params.code || '').split('.');
        if (parts.length !== 2 || !parts[0] || !/^[0-9a-f]{16}$/i.test(parts[1])) {
            return res.status(400).send('رمز غير صالح');
        }
        const [cardId, shortSig] = parts;
        const expect = crypto.createHmac('sha256', QR_SECRET)
            .update(String(cardId), 'utf8').digest('hex').slice(0, 16);
        if (!crypto.timingSafeEqual(Buffer.from(shortSig.toLowerCase()), Buffer.from(expect))) {
            return res.status(403).send('توقيع غير صالح — بطاقة مزورة محتملة');
        }
        const emp = (await pool.query(
            `SELECT e.name, e."employeeId", e."deviceUserId", e.department, e.position, e.photo, e.status,
                    h.name AS dept_name, e."cardStatus", e."cardIssuedAt"
               FROM employees e LEFT JOIN "hrDepartments" h ON h.code = e.department
              WHERE e."cardId" = $1 LIMIT 1`, [String(cardId)])).rows[0];
        if (!emp) {return res.status(404).send('الموظف غير موجود');}
        req.query.d = Buffer.from(JSON.stringify({
            eid: String(emp.employeeId), cid: String(cardId), v: 2, t: 'short',
        })).toString('base64url');
        req.query.s = 'short';
        req.shortVerified = emp;
        return shortVerifyRender(req, res);
    } catch (e) {
        logger.error('[hr_card_verify_short]', e);
        res.status(500).send('تعذر التحقق حاليًا');
    }
});

function shortVerifyRender(req, res) {
    const emp = req.shortVerified;
    const active = emp.status === 'active' && (emp.cardStatus || 'active') === 'active';
    const logoB64 = (() => { try {
        return require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'assets', 'karim-logo.png')).toString('base64');
    } catch (_) { return ''; } })();
    res.type('html').send(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تحقق بطاقة موظف — مطاعم الشرفه العالمي</title>
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
${logoB64 ? `<img src="data:image/png;base64,${logoB64}" alt="شعار مطاعم الشرفه العالمي">` : ''}
<div class="t"><b>مطاعم الشرفه العالمي</b><span>AL SHORFA RESTAURANTS — تحقق البطاقات</span></div>
</div><div class="card">
<h1>${emp.name}</h1>
<div class="co">${emp.position || ''} • ${emp.dept_name || emp.department || ''}</div>
<div><span class="badge ${active ? 'ok' : 'no'}">${active ? '✓ بطاقة سارية وموظف نشط' : '✕ غير سارية'}</span></div>
<div class="row"><span>رقم الموظف</span><b>${emp.employeeId || ''}</b></div>
<div class="row"><span>رقم البصمة</span><b>${emp.deviceUserId || ''}</b></div>
<div class="row"><span>إصدار البطاقة</span><b>${emp.cardIssuedAt ? String(emp.cardIssuedAt).slice(0, 10) : ''}</b></div>
<div class="meta">تم التحقق لحظيًا من نظام Karim ERP — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</div>
</div></body></html>`);
}

/** تحقق عام من بطاقة موظف (مسح QR) — بيانات عامة فقط، بتوقيع HMAC */
router.get('/card/verify', async (req, res) => {
    try {
        const d = String(req.query.d || '');
        const s = String(req.query.s || '');
        let p = null;
        try { p = JSON.parse(Buffer.from(d, 'base64url').toString('utf8')); } catch (_) { p = null; }
        if (!p || !p.eid || !p.t) {return res.status(400).send('رمز غير صالح');}
        const expect = crypto.createHmac('sha256', QR_SECRET)
            .update(`${p.eid}|${p.cid}|${p.v}|${p.t}`, 'utf8').digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expect))) {
            return res.status(403).send('توقيع غير صالح — بطاقة مزورة محتملة');
        }
        const emp = (await pool.query(
            `SELECT e.name, e."employeeId", e."deviceUserId", e.department, e.position, e.photo, e.status,
                    h.name AS dept_name, e."cardStatus", e."cardIssuedAt"
               FROM employees e LEFT JOIN "hrDepartments" h ON h.code = e.department
              WHERE e."employeeId" = $1 LIMIT 1`, [String(p.eid)])).rows[0];
        if (!emp) {return res.status(404).send('الموظف غير موجود');}
        const active = emp.status === 'active' && (emp.cardStatus || 'active') === 'active';
        const logoB64 = (() => { try {
            return require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'assets', 'karim-logo.png')).toString('base64');
        } catch (_) { return ''; } })();
        res.type('html').send(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تحقق بطاقة موظف — مطاعم الشرفه العالمي</title>
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
<h2 style="display:none">تحقق</h2><div class="brand">
${logoB64 ? `<img src="data:image/png;base64,${logoB64}" alt="شعار مطاعم الشرفه العالمي">` : ''}
<div class="t"><b>مطاعم الشرفه العالمي</b><span>AL SHORFA RESTAURANTS — تحقق البطاقات</span></div>
</div><div class="card">
${logoB64 ? `<img class="logo" src="data:image/png;base64,${logoB64}">` : ''}
<h1>${emp.name}</h1>
<div class="co">${emp.position || ''} • ${emp.dept_name || emp.department || ''}</div>
<div><span class="badge ${active ? 'ok' : 'no'}">${active ? '✓ بطاقة سارية وموظف نشط' : '✕ غير سارية'}</span></div>
<div class="row"><span>رقم الموظف</span><b>${emp.employeeId || ''}</b></div>
<div class="row"><span>رقم البصمة</span><b>${emp.deviceUserId || ''}</b></div>
<div class="row"><span>إصدار البطاقة</span><b>${emp.cardIssuedAt ? String(emp.cardIssuedAt).slice(0, 10) : ''}</b></div>
<div class="meta">تم التحقق لحظيًا من نظام Karim ERP — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</div>
</div></body></html>`);
    } catch (e) {
        logger.error('[hr_card_verify]', e);
        res.status(500).send('تعذر التحقق حاليًا');
    }
});

// ─── دفتر الموظفين — قائمة شاملة بجميع الحسابات ────────────
router.get('/employees/ledger', jwtAuth, requireRole('admin', 'hr', 'manager'), async (req, res) => {
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
                    query += ` WHERE e.name ILIKE $${paramIndex + 1} OR e."employeeId" ILIKE $${paramIndex + 1} OR e.phone ILIKE $${paramIndex + 1}`;
                    params.push(searchTerm);
                    paramIndex += 1;
                }
                query += ` ORDER BY e.id ASC LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`;
                params.push(limit, offset);
        const { rows: employees, rowCount } = await pool.query(query, params);
        const { rows: [countRow] } = await pool.query(`SELECT COUNT(*)::int AS total FROM employees`);
        res.json({ ok:true, employees, total: countRow.total, page, limit });
    } catch (error) {
            logger.error('[hr/ledger]', error);
            res.status(500).json({ error: 'LEDGER_FAILED', message: 'تعذر جلب دفتر الموظفين' });
        }
});

// ═══════════════════════════════════════════════════════════════════════════
// محرك خصومات الالتزام بالدوام — تأخير + غياب مستنبطان من البصمات والإجازات
// السياسة: يوم الغياب = الراتب/30 • دقيقة التأخير = (الراتب/30/دقائق يوم العمل)
// البنود الآلية تحمل بادئة «⟨آلي⟩» في السبب — إعادة التطبيق تستبدلها دون تكرار
// ═══════════════════════════════════════════════════════════════════════════
const AUTO_DEDUCTION_MARK = '⟨آلي⟩ خصم التزام الدوام';

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
    const { start, end, daysInMonth } = monthBounds(month);
    const todayStr = new Date().toISOString().slice(0, 10);
    const emps = (await pool.query(
        `SELECT id, name, "employeeId", salary, shift_karim, "joinDate" FROM employees WHERE status = 'active' ORDER BY id`)).rows;

    const att = (await pool.query(
        `SELECT "employeeId", date, "checkIn", "checkOut" FROM attendance
          WHERE date >= $1 AND date <= $2 AND "checkIn" IS NOT NULL`,
        [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)])).rows;
    const attByEmp = new Map();
    for (const a of att) {
        if (!attByEmp.has(a.employeeId)) {attByEmp.set(a.employeeId, []);}
        attByEmp.get(a.employeeId).push(a);
    }

    // الإجازات المعتمدة المتقاطعة مع الشهر — تُغطي أيامها من احتساب الغياب
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

    const detail = [];
    for (const emp of emps) {
        const salary = Number(emp.salary || 0);
        if (salary <= 0) {continue;}
        const workDayMinutes = (Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10) * 60;
        const dayRate = salary / 30;
        const minuteRate = dayRate / workDayMinutes;

        const records = attByEmp.get(emp.id) || [];
        let lateMinutes = 0;
        for (const row of records) {
            const parts = calculateDelayParts(row, emp);
            const w = calculateMinutes(row);
            const needsReview = Boolean(row.checkIn && row.checkOut && w === 0);
            if (!needsReview) {lateMinutes += Number(parts.lateMinutes || 0);}
        }
        const presentDays = new Set(records.map(r => r.date));

        // الغياب: يوم بلا بصمة حضور، غير مغطى بإجازة معتمدة، بعد الالتحاق، وغير مستقبلي
        const joinDate = emp.joinDate ? String(emp.joinDate).slice(0, 10) : null;
        const coveredLeave = leaveByEmp.get(emp.id) || new Set();
        let absentDays = 0;
        const absentDates = [];
        for (const d of eachDate(start, end)) {
            if (d > todayStr) {break;}
            if (joinDate && d < joinDate) {continue;}
            if (skipFridays && new Date(`${d}T00:00:00Z`).getUTCDay() === 5) {continue;}
            if (presentDays.has(d) || coveredLeave.has(d)) {continue;}
            absentDays += 1;
            absentDates.push(d);
        }

        const lateDeduction = Math.round(lateMinutes * minuteRate * 100) / 100;
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
        logger.error('[hr_deductions_preview]', e);
        res.status(500).json({ error: 'DEDUCTIONS_PREVIEW_FAILED', message: 'تعذر حساب معاينة الخصومات' });
    }
});

router.post('/deductions/apply', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(String(req.body?.month || '')) ? String(req.body.month) : '';
    if (!month) {return res.status(422).json({ error: 'MONTH_INVALID', message: 'الشهر بصيغة YYYY-MM' });}
    const skipFridays = req.body?.skipFridays === true;
    const client = await pool.connect();
    try {
        const { detail } = await computeMonthDeductions(month, { skipFridays });
        await client.query('BEGIN');
        // إعادة التطبيق تستبدل البنود الآلية السابقة لهذا الشهر — البنود اليدوية لا تُمس
        await client.query(`DELETE FROM payroll_adjustments WHERE month = $1 AND reason LIKE $2`, [month, `${AUTO_DEDUCTION_MARK}%`]);
        let inserted = 0, totalAmount = 0;
        for (const e of detail) {
            if (e.lateDeduction > 0) {
                await client.query(
                    `INSERT INTO payroll_adjustments (id, "employeeId", month, kind, amount, reason, created_by)
                     VALUES ($1, $2, $3, 'penalty', $4, $5, $6)`,
                    [Date.now() * 1000 + Math.floor(Math.random() * 1000) + (e.employeeId % 1000), e.employeeId, month, e.lateDeduction,
                        `${AUTO_DEDUCTION_MARK} — تأخير ${e.lateMinutes} دقيقة (${(e.lateMinutes / 60).toFixed(1)} ساعة)`, req.user.id]);
                inserted += 1; totalAmount += e.lateDeduction;
            }
            if (e.absentDeduction > 0) {
                await client.query(
                    `INSERT INTO payroll_adjustments (id, "employeeId", month, kind, amount, reason, created_by)
                     VALUES ($1, $2, $3, 'penalty', $4, $5, $6)`,
                    [Date.now() * 1000 + Math.floor(Math.random() * 1000) + (e.employeeId % 1000) + 500, e.employeeId, month, e.absentDeduction,
                        `${AUTO_DEDUCTION_MARK} — غياب ${e.absentDays} يوم`, req.user.id]);
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
        logger.error('[hr_deductions_apply]', e);
        res.status(500).json({ error: 'DEDUCTIONS_APPLY_FAILED', message: 'تعذر تطبيق الخصومات' });
    } finally { client.release(); }
});


// ─── محرك الورديات: تحليل واقع البصمة + تطبيق الورديات + إعادة حساب تلقائية ───
const shiftsEngine = require('./shifts-engine');

router.get('/shifts/analysis', jwtAuth, requireRole('admin', 'hr', 'manager'), async (req, res) => {
    try {
        const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : String(new Date().toISOString().slice(0, 7));
        res.json(await shiftsEngine.realityAnalysis(month));
    } catch (e) { res.status(500).json({ error: 'SHIFT_ANALYSIS_FAILED', message: e.message }); }
});

/** تدقيق ساعات الدوام الفعلية: الموظف دا كم ساعة مقابل دوامه المطلوب (10/12 ساعة) — لا يقل عن دوامه */
router.get('/shifts/worked-hours', jwtAuth, requireRole('admin', 'hr', 'manager'), async (req, res) => {
    try {
        const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : String(new Date().toISOString().slice(0, 7));
        res.json(await shiftsEngine.workedHoursAudit(month));
    } catch (e) { res.status(500).json({ error: 'WORKED_HOURS_FAILED', message: e.message }); }
});

router.post('/shifts/apply', jwtAuth, requireRole('admin', 'hr', 'manager'), async (req, res) => {
    try {
        const text = String(req.body && req.body.text || '').slice(0, 8000);
        if (!text.trim()) {return res.status(422).json({ error: 'EMPTY', message: 'اكتب الورديات أولاً' });}
        const summary = await shiftsEngine.applyShiftText(text);
        res.json({ ok: true, ...summary });
    } catch (e) { res.status(500).json({ error: 'SHIFTS_APPLY_FAILED', message: e.message }); }
});

router.post('/shifts/recompute', jwtAuth, requireRole('admin', 'hr', 'manager'), async (req, res) => {
    try { res.json({ ok: true, recompute: await shiftsEngine.recomputeDerived() }); }
    catch (e) { res.status(500).json({ error: 'RECOMPUTE_FAILED', message: e.message }); }
});

module.exports = { router, provisionCard, signQrPayload, calculateMinutes, calculateLateMinutes };
