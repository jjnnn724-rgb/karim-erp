/**
 * drawer-routes.js — فتح درج النقدية بضغطة زر (بدون بيع).
 * ────────────────────────────────────────────────────────────────────────────
 * الدرج ليس جهازًا مستقلاً: يفتح بنبضة ESC/POS تُرسل إلى طابعة الإيصالات
 * (ESC p 0 · pulse). عند إتمام بيع نقدي تُذيَّل الفاتورة نفسها بالنبضة في
 * escpos-printer.js، لكن الكاشير يحتاج أحيانًا فتح الدرج وحده — لتغذية الفكة
 * أو استلام مبلغ أو الرد على العميل. هذه الراوت تفعل ذلك مباشرةً على الطابعة
 * المسجّلة، وتكتب أثر تدقيق لكل فتحة: من، ومتى، ومن أي جهاز.
 *
 * Fail-closed: بلا طابعة متصلة/مسجّلة لا يوجد نجاح وهمي — رسالة عربية صريحة.
 * وفي كل فتحة أثر تدقيق لأنه تصرف نقدي لا يُترك بلا سجل.
 */

'use strict';

// المشروع لا يثبّت @types/express — تدوين any صريح يمنع TS7016
// (لا وجود لإعلانات) دون إخفاء أي فحص آخر في الملف.
/** @type {any} */
const express = require('express');
const { pool } = require('./db-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { logger } = require('../logger');
const { pickPrinterForJob } = require('./printer-logic');
const { sendToPrinter } = require('./print-worker');
const { writeAuditLog } = require('./audit-middleware');

const router = express.Router();

const ROLES = ['admin', 'manager', 'cashier'];
// نبضة قياسية: ESC p 0 m t1 t2 — 50ms تشغيل، 500ms انتظار (وحدة × 2ms)
const DRAWER_PULSE = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);
const THROTTLE_MS = 1500;
const lastOpenByUser = new Map();

/** @param {string|number} userId */
function throttled(userId) {
    const now = Date.now();
    const prev = lastOpenByUser.get(userId) || 0;
    if (now - prev < THROTTLE_MS) {return true;}
    lastOpenByUser.set(userId, now);
    // تنظيف بسيط حتى لا ينمو الجدول مع كل كاشير مرّ بالنظام
    if (lastOpenByUser.size > 500) {
        for (const [key, at] of lastOpenByUser) {
            if (now - at > 60_000) {lastOpenByUser.delete(key);}
        }
    }
    return false;
}

/**
 * @param {any} req الطلب (يحمل user/header الجلسة)
 * @param {any} body ح body القسم إن وُجد
 * @returns {Promise<number|null>}
 */
async function resolveDepartmentId(req, body) {
    const fromBody = Number(body && body.department_id);
    if (Number.isInteger(fromBody) && fromBody > 0) {return fromBody;}

    const headerSession = Number(req.headers['x-shift-session-id']);
    if (Number.isInteger(headerSession) && headerSession > 0) {
        const { rows } = await pool.query(
            `SELECT department_id FROM pos_shift_sessions WHERE id = $1 AND status = 'open' LIMIT 1;`,
            [headerSession]
        );
        if (rows[0]) {return Number(rows[0].department_id);}
    }

    const { rows } = await pool.query(
        `SELECT department_id FROM pos_shift_sessions
          WHERE cashier_id = $1 AND status = 'open'
          ORDER BY opened_at DESC LIMIT 1;`,
        [req.user.id]
    );
    return rows[0] ? Number(rows[0].department_id) : null;
}

router.post('/drawer/open', jwtAuth, requireRole(...ROLES),
    /** @param {any} req @param {any} res */
    async (req, res) => {
    try {
        if (throttled(req.user.id)) {
            return res.status(429).json({ error: 'DRAWER_THROTTLED', message: 'تم فتح الدرج للتو — انتظر لحظة قبل التكرار' });
        }

        const departmentId = await resolveDepartmentId(req, req.body);
        if (!departmentId) {
            return res.status(409).json({
                error: 'NO_OPEN_SHIFT',
                message: 'افتح وردية أولاً حتى يُعرف درج أي قسم يُفتح',
            });
        }

        const printersRes = await pool.query(`SELECT * FROM pos_printers;`);
        const chosen = pickPrinterForJob(printersRes.rows, `pos-${departmentId}`);
        if (!chosen) {
            return res.status(409).json({
                error: 'NO_PRINTER',
                message: 'لا توجد طابعة إيصالات متصلة لهذا القسم — سجّلها من إعدادات الطابعات ثم أعد المحاولة',
            });
        }

        try {
            await sendToPrinter(chosen.printer, DRAWER_PULSE);
        } catch (sendErr) {
            const failure = /** @type {Error & {message?: string}} */ (sendErr);
            await pool.query(`UPDATE pos_printers SET is_online = false WHERE id = $1;`, [chosen.printer.id]).catch(() => {});
            logger.warn(`[drawer] open failed on ${chosen.printer.id}: ${failure.message || sendErr}`);
            return res.status(503).json({
                error: 'PRINTER_UNREACHABLE',
                message: `تعذر الوصول إلى طابعة الإيصالات (${chosen.printer.id}) — تحقق من تشغيلها والشبكة`,
            });
        }

        await pool.query(
            `UPDATE pos_printers SET is_online = true, last_seen_at = CURRENT_TIMESTAMP WHERE id = $1;`,
            [chosen.printer.id]
        ).catch(() => {});

        writeAuditLog({
            action: 'pos_drawer_open',
            tableName: 'pos_printers',
            rowPk: chosen.printer.id,
            reason: 'manual drawer open',
            metadata: { department_id: departmentId, fallback: chosen.fallback },
            actor: {
                userId: req.user.id,
                userName: req.user.name,
                role: req.user.role,
                ip: req.auditCtx ? req.auditCtx.clientIp : null,
                requestId: req.auditCtx ? req.auditCtx.requestId : null,
            },
        }).catch((err) => logger.error('[drawer] audit failed:', String(/** @type {any} */ (err)?.message ?? err)));

        return res.json({ ok: true, printer_id: chosen.printer.id, at: new Date().toISOString() });
    } catch (err) {
        logger.error('[drawer] open failed:', String(/** @type {any} */ (err)?.message ?? err));
        return res.status(500).json({ error: 'DRAWER_FAILED', message: 'تعذر فتح الدرج — حاول مرة أخرى' });
    }
});

module.exports = { router, DRAWER_PULSE, resolveDepartmentId };
