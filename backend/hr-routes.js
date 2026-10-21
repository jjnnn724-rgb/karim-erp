const express = require('express');
const crypto = require('crypto');
const { pool } = require('./shared-pool');
const { riyadhToday } = require('./riyadh-date'); // M20
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const { generalLimiter } = require('./rate-limiter');
const { buildMonthlyAttendanceSummaryQuery } = require('./monthly-attendance-query');
const { shiftDateForEmployee, prevDay, isLate, isEarlyLeave, lockGraceMinutes, graceMinutes, calculateDelayParts } = require('./shift-day');
const { calculateTotalLateMinutes, loadShiftHistoryMap, resolveShiftAt } = require('./attendance-engine');
const { arFuzzyPattern } = require('./ar-search');

const router = express.Router();
const QR_SECRET = process.env.EMPLOYEE_QR_SECRET || process.env.JWT_SECRET;
const ADMIN_ROLES = ['admin', 'hr', 'manager'];

// SECURITY: صفحة تحقق البطاقة عامة (بلا x-api-key) — قاعدة بيانات + HTML لكل
// مسح QR، فيجب تقييدها لكل IP.
const cardVerifyLimiter = generalLimiter;

// HTML-escape لكل قيمة من قاعدة البيانات تُدرج في صفحة التحقق العامة —
// الاسم/الوظيفة/القسم تأتي من إدخال بشري و Stored XSS هنا تنفذ على كل هاتف يمسح البطاقة.
function esc(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
    res.json({ employee: result.rows[0] ? { id: employeeId, name: result.rows[0].name, employeeId: result.rows[0].employeeId, position: result.rows[0].position, shift_start: empRow?.shift_start, shift_karim: empRow?.shift_karim, day_off: empRow?.day_off } : null, records, summary });
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
    // FIX 2026-10-11 (C26): was spawnSync — blocked the entire Node event loop
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
    // ═══ قرار المالك (2026-09): الحساب على أساس «إتمام ساعات الوردية» ═══
    // اليوم مكتمل إذا المنفّذ >= مطلوب الوردية (shift_karim) — التأخير المعتمد =
    // ما نقص من الساعات بأي طرف (تأخير دخول أو انصراف مبكر)، والدخول المبكر
    // يغطي الانصراف المبكر. الأيام المفتوحة/المكررة تُعرض «قيد المراجعة» فقط.
    const detailed = await pool.query(
        `SELECT a."employeeId", a.date, a."checkIn", a."checkOut", a.late, e.shift_start, e.shift_karim
           FROM attendance a JOIN employees e ON e.id=a."employeeId"
          WHERE e.status='active' AND a.date LIKE $1 || '-%' AND NOT COALESCE(a.on_leave, false)`, [m]);
    const toMin = (t) => { const mm = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return mm ? Number(mm[1]) * 60 + Number(mm[2]) : null; };
    const agg = new Map();
    // المطلوب = الدوام الساري في تاريخ اليوم نفسه (تاريخ السريان 087) —
    // تغيير البطاقة اليوم لا يعيد حساب الأيام السابقة أبدًا.
    const mIds = [...new Set(detailed.rows.map((r) => Number(r.employeeId)).filter(Number.isInteger))];
    const mHist = await loadShiftHistoryMap(mIds, `${m}-01`, `${m}-31`);
    for (const r of detailed.rows) {
        let a = agg.get(r.employeeId);
        if (!a) { a = { completeWorkDays: 0, shortDays: 0, deficitMinutes: 0, lateInDays: 0, reviewDays: 0 }; agg.set(r.employeeId, a); }
        if (r.late) { a.lateInDays += 1; } // إحصائي: دخول بعد بداية الوردية (لا يعني عجزًا إذا أكمل)
        const at = resolveShiftAt(mHist.get(String(r.employeeId)), r.date, null);
        const reqHours = at ? Number(at.shift_karim) : Number(r.shift_karim);
        const required = (reqHours > 0 ? reqHours : 10) * 60;
        const ci = toMin(r.checkIn), co = toMin(r.checkOut);
        if (ci == null || co == null) { a.reviewDays += 1; continue; } // يوم مفتوح/بيانات ناقصة
        let worked = co - ci; if (co < ci) { worked += 1440; } // التفاف الوردية الليلية
        if (worked === 0) { a.reviewDays += 1; continue; } // بصمة مكررة → قيد المراجعة
        // سماحية 15 دقيقة (قرار المالك 2026-10-10): إتمام الوردية ناقص السماحية = في الميعاد
        if (worked + graceMinutes() >= required) { a.completeWorkDays += 1; }
        else { a.shortDays += 1; a.deficitMinutes += (required - worked - graceMinutes()); }
    }
    const out = { month: m, employees: rows.map(r => {
        const a = agg.get(r.id) || { completeWorkDays: 0, shortDays: 0, deficitMinutes: 0, lateInDays: 0, reviewDays: 0 };
        const empWorkDayMinutes = (Number(r.shift_karim) > 0 ? Number(r.shift_karim) : 10) * 60;
        return { ...r, workDayMinutes: empWorkDayMinutes, karimHours: Number((r.minutes / 60).toFixed(1)),
            completeWorkDays: a.completeWorkDays, shortDays: a.shortDays, deficitMinutes: a.deficitMinutes,
            deficitHours: Number((a.deficitMinutes / 60).toFixed(2)), lateInDays: a.lateInDays,
            // توافق أسماء الواجهة السابقة: «التأخير» الآن = العجز عن إتمام ساعات الوردية
            lateMinutes: a.deficitMinutes, lateDays: a.shortDays,
            leaveDays: r.leave_days || 0, reviewDays: a.reviewDays, reviewMinutes: 0 };
    }) };
    // متوسط ساعات يوم العمل لكل الموظفين (للعرض في رأس التقرير)
    out.workDayMinutes = 600; // افتراضي 10 ساعات
    if (detail) {
        const det = await pool.query(
            `SELECT a."employeeId", a.date, a."checkIn", a."checkOut", a."workMinutes", a.late, a.on_leave, e.shift_start, e.shift_karim
               FROM attendance a JOIN employees e ON e.id = a."employeeId"
              WHERE e.status = 'active' AND a.date LIKE $1 || '-%' ORDER BY a.date, e.name`, [m]);
        out.days = det.rows.map(r => ({ ...r, workMinutes: calculateMinutes(r), ...calculateDelayParts(r, r) }));
        // أيام الإجازات المعتمدة لكل موظف (للعرض «إجازة معتمدة» بدل «لا يبصم» — تعمل على الجوال أيضًا)
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
        // FIX 2026-10-11 (C24): advisory lock serializes concurrent punches for the
        // same employee+shiftDate — FOR UPDATE only locks existing rows, so the
        // first punch of the day takes no lock and two simultaneous punches both
        // see "no row" → duplicate check-in. Advisory lock fixes without schema change.
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [employee.id, Number(shiftDate.replace(/-/g, ''))]);
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
            // FIX 2026-10-11 (C17): retry on PK collision — Date.now()+rand can
            // collide under concurrent punches. Retry up to 3 times with new ID.
            let record = null;
            for (let attempt = 0; attempt < 3 && !record; attempt++) {
                const id = Date.now() * 1000 + Math.floor(Math.random() * 999999);
                try {
                    record = (await client.query(
                        `INSERT INTO attendance (id, "employeeId", date, "checkIn", late, notes, "checkInAt", source, "operatorId")
                         VALUES ($1,$2,$3,$4,$5,$6,$7,'qr',$8) RETURNING *`,
                        [id, employee.id, shiftDate, time, lateFor(), 'تسجيل حضور عبر QR', now, req.user.id]
                    )).rows[0];
                } catch (pkErr) {
                    if (pkErr && pkErr.code === '23505') {continue;}
                    throw pkErr;
                }
            }
            if (!record) {
                await client.query('ROLLBACK');
                return res.status(500).json({ error: 'ATTENDANCE_ID_COLLISION', message: 'تعذر تسجيل الحضور — أعد المحاولة' });
            }
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
    // V6 Phase 3 (decision #7): إعادة توليد شهر مقفل ممنوعة — تحمي المسير المعتمد.
    // FIX 2026-10-11 (C25): moved period-closed + already-posted checks INSIDE the
    // transaction — were outside with fail-open catch, so a DB error on the control
    // query let posted payroll be regenerated (TOCTOU + fail-open).
    const includeOvertime = req.body?.includeOvertime === true;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Period-closed check (inside txn, fail-closed)
        try {
            const pc = await client.query(
                "SELECT status FROM accounting_periods WHERE month = $1 LIMIT 1", [month]);
            if (pc.rows[0]?.status === 'closed') {
                await client.query('ROLLBACK');
                return res.status(423).json({ error: 'PERIOD_LOCKED', message: `الفترة ${month} مقفلة محاسبيًا — لا يمكن إعادة توليد الرواتب (أعد فتح الفترة أولًا)` });
            }
        } catch (periodErr) {
            await client.query('ROLLBACK');
            throw periodErr; // fail-closed: if we can't verify period status, refuse
        }
        // Already-posted check (inside txn, fail-closed)
        try {
            const _je = (await client.query(
                "SELECT 1 FROM journal_entries WHERE source_type='payroll' AND source_id=$1 AND status='posted' LIMIT 1", [month])).rows[0];
            if (_je) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'PAYROLL_ALREADY_POSTED', message: `رواتب ${month} مُرحّلة محاسبيًا — إعادة التوليد ستبطل مطابقة القيد. راجع المالية أولًا.` });
            }
        } catch (jeErr) {
            await client.query('ROLLBACK');
            throw jeErr; // fail-closed
        }
        const emps = (await client.query(
            `SELECT id, name, salary, shift_start, shift_karim FROM employees WHERE status = 'active' ORDER BY id`)).rows;
        // تاريخ السريان لمرة واحدة: أوفرتايم كل يوم بساعاته السارية فيه
        const payHist = await loadShiftHistoryMap(emps.map((e) => e.id), `${month}-01`, `${month}-31`);
        const detail = [];
        let tBasic = 0, tOt = 0, tBonus = 0, tPen = 0, tAdv = 0, tNet = 0;
        for (const emp of emps) {
            const basic = Number(emp.salary || 0);
            const sHours = Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10;
            // الأوفرتايم اختياري — يحسب بس لو الأدمن حطه (من البصمات)
            const att = (await client.query(
                `SELECT "workMinutes", date FROM attendance
                  WHERE "employeeId" = $1 AND date LIKE $2 AND "checkIn" IS NOT NULL AND "checkOut" IS NOT NULL`,
                [emp.id, `${month}-%`])).rows;
            const daysPresent = att.length;
            const empHist = payHist.get(String(emp.id));
            let otMinutes = 0;
            let overtimePay = 0;
            if (includeOvertime) {
                for (const a of att) {
                    const w = Number(a.workMinutes);
                    if (!Number.isFinite(w)) {continue;}
                    const at = resolveShiftAt(empHist, a.date, null);
                    const hd = at ? Number(at.shift_karim) : sHours;
                    const exp = Math.round((hd > 0 ? hd : 10) * 60);
                    if (w > exp) {
                        otMinutes += w - exp;
                        overtimePay += ((w - exp) / 60) * (sHours > 0 ? basic / 30 / (hd > 0 ? hd : 10) : 0);
                    }
                }
                overtimePay = Math.round(overtimePay * 100) / 100;
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
router.get('/card/v/:code', cardVerifyLimiter, async (req, res) => {
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
            `SELECT e.name, e."employeeId", e.department, e.position, e.status,
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
<h1>${esc(emp.name)}</h1>
<div class="co">${esc(emp.position)} • ${esc(emp.dept_name || emp.department)}</div>
<div><span class="badge ${active ? 'ok' : 'no'}">${active ? '✓ بطاقة سارية وموظف نشط' : '✕ غير سارية'}</span></div>
<div class="row"><span>رقم الموظف</span><b>${esc(emp.employeeId)}</b></div>
<div class="row"><span>إصدار البطاقة</span><b>${emp.cardIssuedAt ? esc(String(emp.cardIssuedAt).slice(0, 10)) : ''}</b></div>
<div class="meta">تم التحقق لحظيًا من نظام Karim ERP — ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))}</div>
</div></body></html>`);
}

/** تحقق عام من بطاقة موظف (مسح QR) — بيانات عامة فقط، بتوقيع HMAC.
 * SECURITY: الاستعلام يربط كامل هوية البطاقة (employeeId + cardId + qrVersion +
 * qrTokenHash) — كان يكفي employeeId فقط فيبقى رابط مسروق صالحًا للأبد حتى بعد
 * تجديد البطاقة أو إبطالها. */
router.get('/card/verify', cardVerifyLimiter, async (req, res) => {
    try {
        const d = String(req.query.d || '');
        const s = String(req.query.s || '');
        let p = null;
        try { p = JSON.parse(Buffer.from(d, 'base64url').toString('utf8')); } catch (_) { p = null; }
        if (!p || !p.eid || !p.t || !p.cid) {return res.status(400).send('رمز غير صالح');}
        const expect = crypto.createHmac('sha256', QR_SECRET)
            .update(`${p.eid}|${p.cid}|${p.v}|${p.t}`, 'utf8').digest('hex');
        // timingSafeEqual يرمي RangeError عند اختلاف الطول — افحص الصيغة أولًا
        // حتى لا يتحول توقيع مشوه إلى 500.
        if (!/^[a-f0-9]{64}$/i.test(s)) {return res.status(403).send('توقيع غير صالح — بطاقة مزورة محتملة');}
        if (!crypto.timingSafeEqual(Buffer.from(s.toLowerCase()), Buffer.from(expect))) {
            return res.status(403).send('توقيع غير صالح — بطاقة مزورة محتملة');
        }
        const emp = (await pool.query(
            `SELECT e.name, e."employeeId", e.department, e.position, e.status,
                    h.name AS dept_name, e."cardStatus", e."cardIssuedAt"
               FROM employees e LEFT JOIN "hrDepartments" h ON h.code = e.department
              WHERE e."employeeId" = $1 AND e."cardId" = $2
                AND e."qrVersion" = $3::int AND e."qrTokenHash" = $4
                AND e.status = 'active' AND e."cardStatus" = 'active'`,
            [String(p.eid), String(p.cid), Number(p.v) || -1, hashToken(String(p.t))])).rows[0];
        if (!emp) {return res.status(404).send('البطاقة غير صالحة أو تم تجديدها');}
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
<h1>${esc(emp.name)}</h1>
<div class="co">${esc(emp.position)} • ${esc(emp.dept_name || emp.department)}</div>
<div><span class="badge ${active ? 'ok' : 'no'}">${active ? '✓ بطاقة سارية وموظف نشط' : '✕ غير سارية'}</span></div>
<div class="row"><span>رقم الموظف</span><b>${esc(emp.employeeId)}</b></div>
<div class="row"><span>إصدار البطاقة</span><b>${emp.cardIssuedAt ? esc(String(emp.cardIssuedAt).slice(0, 10)) : ''}</b></div>
<div class="meta">تم التحقق لحظيًا من نظام Karim ERP — ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))}</div>
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
                    // ذكاء البحث العربي 2026-10-06: الاسم بعائلات الحروف المتشابهة، والرقم/الهاتف حرفيًا
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
    const { start, end } = monthBounds(month);
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
    // تاريخ السريان: دوام كل يوم يُحل بتاريخه (الماضي محمي من تغييرات البطاقة)
    const dedHist = await loadShiftHistoryMap(emps.map((e) => e.id), start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
    for (const emp of emps) {
        const salary = Number(emp.salary || 0);
        if (salary <= 0) {continue;}
        const workDayMinutes = (Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10) * 60;
        const dayRate = salary / 30;
        const empHist = dedHist.get(String(emp.id));

        const records = attByEmp.get(emp.id) || [];
        let lateMinutes = 0;
        let lateMoney = 0;
        for (const row of records) {
            const at = resolveShiftAt(empHist, row.date, null);
            const empAt = at
                ? { ...emp, shift_start: at.shift_start || emp.shift_start, shift_karim: Number(at.shift_karim) > 0 ? Number(at.shift_karim) : emp.shift_karim }
                : emp;
            const parts = calculateDelayParts(row, empAt);
            const w = calculateMinutes(row);
            const needsReview = Boolean(row.checkIn && row.checkOut && w === 0);
            if (!needsReview) {
                const dayMin = (Number(empAt.shift_karim) > 0 ? Number(empAt.shift_karim) : 10) * 60;
                lateMinutes += Number(parts.lateMinutes || 0);
                lateMoney += Number(parts.lateMinutes || 0) * (dayRate / dayMin);
            }
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
        logger.error('[hr_deductions_preview]', e);
        res.status(500).json({ error: 'DEDUCTIONS_PREVIEW_FAILED', message: 'تعذر حساب معاينة الخصومات' });
    }
});

router.post('/deductions/apply', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(String(req.body?.month || '')) ? String(req.body.month) : '';
    if (!month) {return res.status(422).json({ error: 'MONTH_INVALID', message: 'الشهر بصيغة YYYY-MM' });}
    // V6 Phase 3 (decision #7): تطبيق الخصومات على شهر مقفل ممنوع.
    try {
        const { isPeriodClosed } = require('./accounting-periods');
        if (await isPeriodClosed(month)) {return res.status(423).json({ error: 'PERIOD_LOCKED', message: `الفترة ${month} مقفلة محاسبيًا — لا يمكن تطبيق الخصومات (أعد فتح الفترة أولًا)` });}
    } catch (_) { /* controls down → fail-open */ }
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
        const summary = await shiftsEngine.applyShiftText(text, undefined, req.user?.id ?? null);
        res.json({ ok: true, ...summary });
    } catch (e) { res.status(500).json({ error: 'SHIFTS_APPLY_FAILED', message: e.message }); }
});

router.post('/shifts/recompute', jwtAuth, requireRole('admin', 'hr', 'manager'), async (req, res) => {
    try { res.json({ ok: true, recompute: await shiftsEngine.recomputeDerived() }); }
    catch (e) { res.status(500).json({ error: 'RECOMPUTE_FAILED', message: e.message }); }
});

// ─── جدول دوامات القسم: رئيس القسم يكتب دوامات رجاله — تسمع فورًا ───
// يكتب أعمدة الدوام الثابت مباشرة (مصدر الحقيقة للمحرك) — بلا مسودات ولا اعتماد.
// التاريخ القديم لا يُمس (صفوف الحضور السابقة كما هي)؛ التغيير والرجوع حران.
// النطاق: dept_head وأي حساب مربوط بقسم → قسمه إجباريًا. kitchen→KITCHEN و
// warehouse→WAREHOUSE افتراضيًا. المخوّلون (admin/hr/manager/accountant بلا قسم)
// يمررون القسم صراحة. الضم: الصف بلا قسم يُسند لقسم النطاق عند الحفظ.
const ROSTER_ROLES = ['admin', 'hr', 'manager', 'dept_head', 'kitchen', 'sous_chef', 'warehouse', 'accountant'];
const ROSTER_ROLE_DEPT = { kitchen: 'KITCHEN', sous_chef: 'KITCHEN', warehouse: 'WAREHOUSE' };
const ROSTER_PRIVILEGED = ['admin', 'hr', 'manager'];

function rosterScope(user, wantDept) {
    const myCode = String(user?.dept_code || '').trim();
    if (user?.role === 'dept_head' || myCode) {
        if (!myCode) {return { ok: false, code: 'DEPT_HEAD_WITHOUT_DEPARTMENT', message: 'حساب رئيس القسم غير مرتبط بأي قسم — راجع مسؤول النظام' };}
        // UPGRADE 2026-10-01: dept_code يقبل قائمة أقسام مفصولة بفواصل
        // (شخص يدير أكثر من قسم مؤقتًا: storeroom,SERVICE) — التراجع بضع قسم واحد
        return { ok: true, depts: myCode.split(',').map((x) => x.trim()).filter(Boolean), fixed: true };
    }
    const mapped = ROSTER_ROLE_DEPT[user?.role];
    if (mapped) {return { ok: true, depts: [mapped], fixed: true };}
    if (!ROSTER_PRIVILEGED.includes(user?.role) && user?.role !== 'accountant') {
        return { ok: false, code: 'FORBIDDEN', message: 'لا تملك صلاحية جدول الدوامات' };
    }
    // المخوّلون: قسم واحد أو قائمة مفصولة بفواصل (مثال: ADMIN,WAREHOUSE) أو فارغ = الكل
    const list = String(wantDept || '').split(',').map((s) => s.trim()).filter(Boolean);
    return { ok: true, depts: list, fixed: false };
}

async function rosterValidDepts() {
    const codes = new Set();
    try {
        const a = await pool.query('SELECT code FROM "hrDepartments"');
        a.rows.forEach((r) => { if (r.code) {codes.add(String(r.code));} });
    } catch (e) { logger.warn('[roster] فشل قراءة أقسام HR:', e.message); }
    try {
        const b = await pool.query('SELECT code FROM departments');
        b.rows.forEach((r) => { if (r.code) {codes.add(String(r.code));} });
    } catch (e) { logger.warn('[roster] فشل قراءة الأقسام:', e.message); }
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
        // المجدول مستقبلًا + آخر التغييرات (الشفافية الاحترافية) — fail-open
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
        } catch (e) { logger.warn('[dept-roster] تعذر قراءة آخر تغييرات الدوام:', e.message); }
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
        logger.error('[dept-roster list]', e);
        res.status(500).json({ error: 'ROSTER_LIST_FAILED', message: 'تعذر جلب جدول القسم' });
    }
});

router.post('/dept-roster', jwtAuth, requireRole(...ROSTER_ROLES), async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {return res.status(422).json({ error: 'ROSTER_EMPTY', message: 'لا توجد صفوف للحفظ' });}
    if (rows.length > 500) {return res.status(422).json({ error: 'ROSTER_TOO_BIG', message: 'حد أقصى 500 صف في الحفظة الواحدة' });}
    // تاريخ السريان حر (اليوم = فوري، المستقبل = مجدول). الماضي مرفوض لحماية القديم.
    const todayStr = riyadhToday(); // Asia/Riyadh
    const tomorrow = (function(){const d=new Date(Date.now()+3*3600*1000+86400000);return d.toISOString().slice(0,10)})();
    const effRaw = String(req.body?.effective_from || tomorrow);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effRaw)) {return res.status(422).json({ error: 'ROSTER_BAD_DATE', message: 'تاريخ السريان YYYY-MM-DD' });}
    if (effRaw < todayStr) {return res.status(422).json({ error: 'ROSTER_PAST_DATE', message: 'تاريخ السريان لا يكون في الماضي — القديم محمي' });}
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
            return res.status(422).json({ error: 'ROSTER_NO_IDS', message: 'لا معرفات موظفين صالحة' });
        }
        const cur = (await client.query(`SELECT * FROM employees WHERE id = ANY($1::bigint[]) FOR UPDATE`, [ids])).rows;
        const byId = new Map(cur.map((e) => [Number(e.id), e]));
        const updates = [];
        for (const r of rows) {
            const emp = byId.get(Number(r.id));
            if (!emp) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: `الموظف ${r.id} غير موجود` });
            }
            const hasDept = !!String(emp.department || '').trim();
            if (hasDept && !inScopeDepts(scope.depts, emp.department) && !(privileged && !scope.fixed)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'ROSTER_OUT_OF_SCOPE', message: `الموظف «${emp.name}» ليس في قسمك` });
            }
            let start = String(r.shift_start ?? emp.shift_start ?? '09:00').trim();
            const sm = start.match(/^(\d{1,2}):(\d{2})$/);
            if (!sm || Number(sm[1]) > 23 || Number(sm[2]) > 59) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_TIME', message: `وقت غير صالح للموظف «${emp.name}» (HH:MM)` });
            }
            start = `${String(sm[1]).padStart(2, '0')}:${sm[2]}`;
            const hours = Number(r.shift_karim ?? r.shift_hours ?? emp.shift_karim ?? 10);
            if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_Karim', message: `مدة الدوام 1-24 للموظف «${emp.name}»` });
            }
            let dayOff = r.day_off ?? r.dayOff ?? emp.day_off ?? null;
            if (dayOff === '' || dayOff === undefined) {dayOff = null;}
            if (dayOff !== null && !(Number.isInteger(Number(dayOff)) && Number(dayOff) >= 0 && Number(dayOff) <= 6)) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_DAYOFF', message: `يوم الراحة 0-6 للموظف «${emp.name}»` });
            }
            let dept = emp.department;
            const wantDept = r.department !== undefined ? String(r.department || '').trim() : null;
            if (!hasDept) {
                // الضم لشؤون العاملين (ومن يملكها) فقط — رؤساء الأقسام يرون رجالهم حصرًا
                if (!privileged) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ error: 'ROSTER_CLAIM_FORBIDDEN', message: `الموظف «${emp.name}» بلا قسم — التصنيف من شؤون العاملين` });
                }
                const claimTo = wantDept || scope.depts[0];
                if (claimTo && ![...valid].some((c) => sameDept(c, claimTo))) {
                    await client.query('ROLLBACK');
                    return res.status(422).json({ error: 'ROSTER_BAD_DEPT', message: `قسم غير معروف: ${claimTo}` });
                }
                if (claimTo) {dept = [...valid].find((c) => sameDept(c, claimTo)) || claimTo;}
            } else if (privileged && wantDept && !sameDept(wantDept, emp.department)) {
                if (![...valid].some((c) => sameDept(c, wantDept))) {
                    await client.query('ROLLBACK');
                    return res.status(422).json({ error: 'ROSTER_BAD_DEPT', message: `قسم غير معروف: ${wantDept}` });
                }
                dept = [...valid].find((c) => sameDept(c, wantDept)) || wantDept;
            }
            updates.push({ id: emp.id, name: emp.name, shift_start: start, shift_karim: hours, day_off: dayOff, department: dept });
        }
        for (const u of updates) {
            // أساس أول: أول تغيير لموظف يجمّد قيمه الحالية بتاريخ قديم — به الماضي
            // يُحل دائمًا بدوامه الأصلي مهما تغيرت البطاقة لاحقًا.
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
            req.io?.emit('entity_changed', {
                entity: 'employees', entityName: 'الموظفون', action: 'update',
                data: updates, changedBy: req.user?.name || req.user?.username || 'roster', changedAt: new Date().toISOString(),
            });
        } catch (e) { logger.debug('[dept-roster] تعذر بث entity_changed:', e.message); }
        res.json({ ok: true, updated: updates.length, rows: updates, effective_from: effRaw, appliedNow: applyNow });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[dept-roster save]', e);
        res.status(500).json({ error: 'ROSTER_SAVE_FAILED', message: 'تعذر حفظ الجدول' });
    } finally {
        client.release();
    }
});

// ─── شبكة الدوامات الأسبوعية (موظف × يوم) — تحرير أي يوم مستقبلًا بفاعلية ───
// البناء فوق employee_shift_history: كل خلية محفوظة = صف مجدول بتاريخ سريانه،
// ووظيفة الـrollover (كل 5 دقائق) تطبّقه في أعمدة المحرك يومه. الماضي محمي.
router.get('/dept-roster-week', jwtAuth, requireRole(...ROSTER_ROLES), async (req, res) => {
    try {
        const scope = rosterScope(req.user, req.query.dept);
        if (!scope.ok) {return res.status(403).json({ error: scope.code, message: scope.message });}
        const todayStr = riyadhToday(); // Asia/Riyadh
        const ws = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || '')) ? String(req.query.week) : todayStr;
        const w0 = new Date(ws + 'T12:00:00Z');
        // بداية الأسبوع = السبت (طلب المالك 2026-10-04): (رقم اليوم + 1) % 7 = الأيام منذ السبت
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
        } catch (e) { logger.warn('[dept-roster-week] تعذر قراءة حالة الاعتماد:', e.message); }
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
        // الإجازات المعتمدة المتقاطعة مع الأسبوع — تظهر واضحة في الشبكة والطباعة (طلب المالك 2026-10-04)
        const leavesBy = new Map();
        if (ids.length) {
            try {
                const lv = (await pool.query(
                    `SELECT lr."employeeId" AS employee_id, lr."startDate" AS start_date, lr."endDate" AS end_date,
                            COALESCE(lt.name, 'إجازة') AS type_name
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
            } catch (_) { /* جدول إجازات قديم/بأعمدة مختلفة — الشبكة تعمل بلا طبقة الإجازات */ }
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
        logger.error('[dept-roster-week list]', e);
        res.status(500).json({ error: 'ROSTER_WEEK_FAILED', message: 'تعذر جلب شبكة الأسبوع' });
    }
});

// ─── اعتماد طباعة الدوامات: رئيس القسم يطلب ← شؤون العاملين توقّع ← الطباعة معتمدة ───
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
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ws)) {return res.status(422).json({ error: 'ROSTER_BAD_DATE', message: 'بداية الأسبوع YYYY-MM-DD' });}
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
        logger.error('[roster-approval request]', e);
        res.status(500).json({ error: 'APPROVAL_REQUEST_FAILED', message: 'تعذر إرسال طلب الاعتماد' });
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
        logger.error('[roster-approval pending]', e);
        res.status(500).json({ error: 'APPROVAL_PENDING_FAILED', message: 'تعذر جلب طلبات الاعتماد' });
    }
});
router.post('/dept-roster-approval/approve', jwtAuth, requireRole('hr', 'admin'), async (req, res) => {
    try {
        await ensureRosterApprovals();
        const ws = String(req.body?.week_start || '');
        const deptKey = String(req.body?.dept_key || '').trim().toLowerCase();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ws) || !deptKey) {
            return res.status(422).json({ error: 'APPROVAL_BAD_INPUT', message: 'الأسبوع والقسم مطلوبان' });
        }
        const name = req.user.name || req.user.username || String(req.user.id);
        const r = await pool.query(
            `UPDATE roster_approvals SET approved_by=$3, approved_name=$4, approved_at=NOW()
              WHERE dept_key=$1 AND week_start=$2::date AND requested_at IS NOT NULL RETURNING *`,
            [deptKey, ws, req.user.id, name]
        );
        if (!r.rows.length) {return res.status(422).json({ error: 'APPROVAL_NOT_FOUND', message: 'لا طلب اعتماد مفتوح لهذا القسم في هذا الأسبوع' });}
        res.json({ ok: true, approval: { approved_name: r.rows[0].approved_name, approved_at: r.rows[0].approved_at } });
    } catch (e) {
        logger.error('[roster-approval approve]', e);
        res.status(500).json({ error: 'APPROVAL_FAILED', message: 'تعذر اعتماد الدوامات' });
    }
});

router.post('/dept-roster-week', jwtAuth, requireRole(...ROSTER_ROLES), async (req, res) => {
    const cells = Array.isArray(req.body?.cells) ? req.body.cells : [];
    if (!cells.length) {return res.status(422).json({ error: 'ROSTER_EMPTY', message: 'لا توجد خلايا للحفظ' });}
    if (cells.length > 700) {return res.status(422).json({ error: 'ROSTER_TOO_BIG', message: 'حد أقصى 700 خلية في الحفظة الواحدة' });}
    const todayStr = riyadhToday(); // Asia/Riyadh
    const wsRaw = String(req.body?.week_start || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wsRaw)) {return res.status(422).json({ error: 'ROSTER_BAD_DATE', message: 'بداية الأسبوع YYYY-MM-DD' });}
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
        // تنظيف وتحقق من كل خلية قبل أي كتابة
        const clean = [];
        for (const c of cells) {
            const id = Number(c.id);
            const date = String(c.date || '');
            if (!Number.isInteger(id) || id <= 0) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_CELL', message: 'خلية بمعرف موظف غير صالح' });
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_DATE', message: `تاريخ خلية غير صالح: ${date}` });
            }
            // الأسبوع 7 أيام: التاريخ لازم يكون بين بداية الأسبوع ونهايته
            const dd = new Date(date + 'T12:00:00Z');
            const diff = Math.round((dd - new Date(wsRaw + 'T12:00:00Z')) / 86400000);
            if (diff < 0 || diff > 6) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_DATE', message: `تاريخ خلية خارج الأسبوع: ${date}` });
            }
            if (date < todayStr) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_PAST_DATE', message: `لا يمكن تعديل ماضٍ (${date}) — القديم محمي` });
            }
            const start = String(c.shift_start ?? '09:00').trim();
            const sm = start.match(/^(\d{1,2}):(\d{2})$/);
            if (!sm || Number(sm[1]) > 23 || Number(sm[2]) > 59) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_TIME', message: `وقت غير صالح (${date}) — الصيغة HH:MM` });
            }
            const hours = Number(c.shift_hours ?? 10);
            if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_Karim', message: `مدة الدوام 1-24 (${date})` });
            }
            let dayOff = c.day_off ?? null;
            if (dayOff === '' || dayOff === undefined) {dayOff = null;}
            if (dayOff !== null && !(Number.isInteger(Number(dayOff)) && Number(dayOff) >= 0 && Number(dayOff) <= 6)) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'ROSTER_BAD_DAYOFF', message: `يوم الراحة 0-6 (${date})` });
            }
            clean.push({
                id, date,
                shift_start: `${String(sm[1]).padStart(2, '0')}:${sm[2]}`,
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
                return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: `الموظف ${c.id} غير موجود` });
            }
            const hasDept = !!String(emp.department || '').trim();
            if (hasDept && !inScopeDepts(scope.depts, emp.department) && !(privileged && !scope.fixed)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'ROSTER_OUT_OF_SCOPE', message: `الموظف «${emp.name}» ليس في قسمك` });
            }
            // أساس أول لمن لا أساس له — به يُحل الماضي دائمًا
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
            // ضم بلا قسم: للمخوّلين فقط عند حفظ خلاياه — يصبح من القسم
            let dept = emp.department;
            if (!hasDeptOf(emp) && privileged && scope.depts[0]) {
                const claimTo = [...valid].find((x) => sameDept(x, scope.depts[0])) || scope.depts[0];
                dept = claimTo;
            }
            await client.query(
                `INSERT INTO employee_shift_history (employee_id, shift_start, shift_karim, day_off, effective_from, created_by)
                 VALUES ($1,$2,$3,$4,$5::date,$6)
                 ON CONFLICT (employee_id, effective_from)
                 DO UPDATE SET shift_start=EXCLUDED.shift_start, shift_karim=EXCLUDED.shift_karim,
                               day_off=EXCLUDED.day_off, created_by=EXCLUDED.created_by, created_at=NOW()`,
                [c.id, c.shift_start, c.shift_karim, c.day_off, c.date, req.user.id]
            );
            if (c.date === todayStr) {
                if (dept && dept !== emp.department) {
                    await client.query(`UPDATE employees SET shift_start=$2, shift_karim=$3, day_off=$4, department=$5 WHERE id=$1`, [c.id, c.shift_start, c.shift_karim, c.day_off, dept]);
                } else {
                    await client.query(`UPDATE employees SET shift_start=$2, shift_karim=$3, day_off=$4 WHERE id=$1`, [c.id, c.shift_start, c.shift_karim, c.day_off]);
                }
            }
        }
        await client.query('COMMIT');
        logger.info({ userId: req.user?.id, depts: scope.depts, cells: clean.length, week_start: wsRaw }, '[dept-roster-week] saved');
        // أي تعديل على شبكة الأسبوع يلغي اعتماد شؤون العاملين السابق (السلامة أولًا)
        try {
            await ensureRosterApprovals();
            await pool.query(`DELETE FROM roster_approvals WHERE dept_key=$1 AND week_start=$2::date`, [rosterApprovalKey(scope), wsRaw]);
        } catch (e) { logger.warn('[dept-roster-week] تعذر تصفير الاعتمادات:', e.message); }
        try {
            req.io?.emit('entity_changed', { entity: 'employees', entityName: 'الموظفون', action: 'update', changedBy: req.user?.name || req.user?.username || 'roster', changedAt: new Date().toISOString() });
        } catch (e) { logger.debug('[dept-roster-week] تعذر بث entity_changed:', e.message); }
        res.json({ ok: true, updated: clean.length, week_start: wsRaw });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[dept-roster-week save]', e);
        res.status(500).json({ error: 'ROSTER_WEEK_SAVE_FAILED', message: 'تعذر حفظ شبكة الأسبوع' });
    } finally {
        client.release();
    }
});

function hasDeptOf(emp) {return !!String(emp?.department || '').trim();}

// ─── الدوام المجدول لموظف واحد (شارة البطاقة): الحالي + القادم مستقبلًا ─────
// نفس قواعد الرؤية: إدارة/شؤون عاملين، صاحب السجل، أو رئيس قسمه
router.get('/shift-schedule/:employeeId', jwtAuth, async (req, res) => {
    try {
        const empId = Number(req.params.employeeId);
        if (!Number.isInteger(empId)) {return res.status(422).json({ error: 'INVALID_ID', message: 'معرف الموظف غير صحيح' });}
        const emp = (await pool.query(
            'SELECT id, name, department, shift_start, shift_karim, day_off FROM employees WHERE id=$1 LIMIT 1',
            [empId])).rows[0];
        if (!emp) {return res.status(404).json({ error: 'NOT_FOUND', message: 'الموظف غير موجود' });}
        const role = req.user?.role;
        const privileged = ['admin', 'hr', 'manager'].includes(role);
        const owner = await pool.query('SELECT 1 FROM employees WHERE id=$1 AND "userId"=$2 LIMIT 1', [empId, req.user.id]);
        const isOwner = owner.rows.length > 0;
        let sameDept = false;
        if (role === 'dept_head' && req.user?.dept_code) {
            sameDept = String(emp.department || '').toLowerCase() === String(req.user.dept_code).toLowerCase();
        }
        if (!privileged && !isOwner && !sameDept) {
            return res.status(403).json({ error: 'FORBIDDEN', message: 'لا تملك صلاحية عرض هذا السجل' });
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
        res.status(500).json({ error: 'SCHEDULE_FAILED', message: 'تعذر جلب الدوام المجدول' });
    }
});

// ─── ترحيل الدوامات المجدولة: كل إقلاع + كل 5 دقائق يطبق ما حان تاريخه ───
// idempotent تمامًا (يحدّث المختلف فقط). fail-open: أي خطأ يُسجَّل فقط.
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

module.exports = { router, provisionCard, signQrPayload, calculateMinutes, calculateLateMinutes, startShiftRollover, rosterRolloverOnce };

// ═══ إدارة موظفي القسم لرئيس القسم (UPGRADE 2026-10-01) ═══
// رئيس القسم يضيف/يعدل/يعطّل موظفي قسمه حصرًا — بحقول آمنة فقط
// (بدون الراتب/الحالة/القسم/الربط بالحسابات — تلك لـ hr/admin).
// النطاق نفسه المعتمد في rosterScope (dept_code بقائمة فواصل).
function deptHeadEmpScope(user) {
    const myCode = String(user?.dept_code || '').trim();
    if (user?.role !== 'dept_head' || !myCode) {return null;}
    return { depts: myCode.split(',').map((x) => x.trim()).filter(Boolean) };
}
const inEmpScope = (empRow, depts) => (depts || []).some((d) => String(empRow.department || '').trim().toLowerCase() === String(d).toLowerCase());

router.get('/dept-employees', jwtAuth, requireRole('dept_head'), async (req, res, next) => {
    try {
        const scope = deptHeadEmpScope(req.user);
        if (!scope) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'حسابك غير مرتبط بقسم — راجع الإدارة' });}
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
        if (!scope) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'حسابك غير مرتبط بقسم' });}
        const name = String(req.body?.name || '').trim().slice(0, 255);
        const employeeId = String(req.body?.employeeId || '').trim().slice(0, 50);
        const position = String(req.body?.position || '').trim().slice(0, 255) || null;
        const phone = String(req.body?.phone || '').trim().slice(0, 50) || null;
        if (!name || !employeeId) {return res.status(422).json({ ok: false, error: 'VALIDATION_ERROR', message: 'الاسم والرقم الوظيفي إجباريان' });}
        if (!/^[A-Za-z0-9_-]{2,50}$/.test(employeeId)) {return res.status(422).json({ ok: false, error: 'VALIDATION_ERROR', message: 'الرقم الوظيفي: حروف لاتينية/أرقام فقط (2-50)' });}
        const dup = (await pool.query('SELECT id FROM employees WHERE "employeeId" = $1', [employeeId])).rows[0];
        if (dup) {return res.status(409).json({ ok: false, error: 'DUPLICATE', message: 'الرقم الوظيفي مستخدم بالفعل' });}
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
        if (!scope) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'حسابك غير مرتبط بقسم' });}
        const row = (await pool.query('SELECT id, name, department, status FROM employees WHERE id = $1', [String(req.params.id)])).rows[0];
        if (!row) {return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الموظف غير موجود' });}
        if (!inEmpScope(row, scope.depts)) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'هذا الموظف ليس من قسمك' });}
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
        if (!scope) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'حسابك غير مرتبط بقسم' });}
        const row = (await pool.query('SELECT id, name, department, status FROM employees WHERE id = $1', [String(req.params.id)])).rows[0];
        if (!row) {return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الموظف غير موجود' });}
        if (!inEmpScope(row, scope.depts)) {return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'هذا الموظف ليس من قسمك' });}
        // تعطيل آمن (يحفظ التاريخ) بدل الحذف النهائي — الحذف النهائي لـ hr/admin
        const upd = await pool.query("UPDATE employees SET status = 'inactive' WHERE id = $1 RETURNING id, status", [row.id]);
        logger.info('[dept-employees] deactivated by dept_head', { by: req.user.username, emp: row.id });
        res.json({ ok: true, deactivated: true, employee: upd.rows[0] });
    } catch (e) { next(e); }
});
