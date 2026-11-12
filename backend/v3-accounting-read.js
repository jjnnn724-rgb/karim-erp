'use strict';

/**
 * v3-accounting-read.js — قراءة المحاسبة لواجهة V3 تحت `/api/v3/accounting`.
 * ────────────────────────────────────────────────────────────────────────────
 * ثلاثة مسارات GET فقط (شجرة الحسابات، دفتر القيود، قيد واحد) — لا كتابة هنا؛
 * الكتابة تبقى في `/api/accounting` القديم حرفيًا.
 *
 * لماذا محوّل منفصل ولا إعادة استخدام القديم؟ عقد V3 المعلن في
 * `v3/packages/shared/src/v3-read.ts` يختلف عمدًا (ADR-04/05): المبالغ والمعّفات
 * bigint نصوص، التاريخ `YYYY-MM-DD`، اللحظات ISO بتوقيت UTC، وحقول الإبطال
 * `voided_*` حاضرة دائمًا. تغيير مخرَج القديم ليصدر هذا الشكل كسرٌ لعقده القائم.
 *
 * المصادقة نفس سلسلة القديم حرفيًا: `jwtAuth` ثم `requireRole` من
 * `cashier-module/jwt-middleware.js` — لا نسخة ثانية من التحقق.
 *
 * أعمدة الإبطال (migration 137) اختيارية على قاعدة قد لا تكون هاجرت بعد:
 * `to_jsonb(e) ->> 'voided_at'` يعيد NULL إن غاب العمود، ونفس العبارة تعمل
 * على القاعدتين بلا فحص catalog ولا حالة مخبوءة ولا SQL ديناميكي.
 */

const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');

const READ_ROLES = ['admin', 'accountant', 'manager', 'auditor'];

const SQL_CHART = `
    SELECT code, name_ar, name_en, type, parent_code, is_postable, is_active
      FROM chart_of_accounts
     ORDER BY code`;

const ENTRY_SELECT = `
    SELECT e.id::text AS id, e.entry_no, e.date::text AS date, e.memo,
           e.source_type, e.source_id, e.status,
           e.created_by::text AS created_by,
           to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
           e.approved_by::text AS approved_by,
           to_char(e.approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS approved_at,
           e.branch_id, u.username AS created_by_name,
           to_char((to_jsonb(e) ->> 'voided_at')::timestamptz AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS voided_at,
           to_jsonb(e) ->> 'voided_by' AS voided_by,
           to_jsonb(e) ->> 'voided_by_name' AS voided_by_name,
           to_jsonb(e) ->> 'void_reason' AS void_reason
      FROM journal_entries e
      LEFT JOIN users u ON u.id = e.created_by`;

const SQL_JOURNAL_LIST = ENTRY_SELECT + ' ORDER BY e.date DESC, e.id DESC LIMIT $1';
const SQL_JOURNAL_BY_ID = ENTRY_SELECT + ' WHERE e.id = $1::bigint';

const SQL_JOURNAL_LINES = `
    SELECT entry_id::text AS entry_id, account_code, debit::text AS debit,
           credit::text AS credit, memo
      FROM journal_lines
     WHERE entry_id = ANY($1::bigint[])
     ORDER BY id`;

/**
 * سطور القيود — استعلام ثانٍ ثابت الرحلات (لا يكبر بعدد القيود)، ثم تجميع
 * في الذاكرة. `entry_id` عمود تجميع داخلي لا يظهر في صف العقد.
 */
async function attachLines(db, entries) {
    if (entries.length === 0) {return [];}
    const { rows } = await db.query(SQL_JOURNAL_LINES, [entries.map((e) => e.id)]);
    const byEntry = new Map();
    for (const row of rows) {
        const { entry_id: entryId, ...line } = row;
        const bucket = byEntry.get(entryId);
        if (bucket) {bucket.push(line);} else {byEntry.set(entryId, [line]);}
    }
    return entries.map((entry) => ({ ...entry, lines: byEntry.get(entry.id) || [] }));
}

/**
 * راوتر القراءة فقط. الحوض يُحقن للاختبارات (نفس الحوض المشترك في الإنتاج).
 * @param {{query: Function}} [db]
 */
function createV3AccountingReadRouter(db = pool) {
    const router = express.Router();
    router.use(jwtAuth, requireRole(...READ_ROLES));

    router.get('/chart', async (_req, res) => {
        try {
            const { rows } = await db.query(SQL_CHART);
            res.json(rows);
        } catch (error) {
            logger.error('[v3/accounting/chart]', error);
            res.status(500).json({ error: 'LEDGER_CHART_FAILED', message: 'تعذر جلب شجرة الحسابات' });
        }
    });

    router.get('/journal', async (req, res) => {
        try {
            // صيغة القديم حرفيًا — تكافؤ السلوك القائم لا نسخة «محسّنة» منه.
            const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
            const { rows } = await db.query(SQL_JOURNAL_LIST, [limit]);
            res.json(await attachLines(db, rows));
        } catch (error) {
            logger.error('[v3/accounting/journal]', error);
            res.status(500).json({ error: 'LEDGER_JOURNAL_FAILED', message: 'تعذر جلب القيود' });
        }
    });

    router.get('/journal/:id', async (req, res) => {
        const id = req.params.id;
        if (!/^\d{1,19}$/.test(id)) {
            return res.status(422).json({ error: 'LEDGER_ID_INVALID', message: 'معرف القيد غير صالح' });
        }
        try {
            const { rows } = await db.query(SQL_JOURNAL_BY_ID, [id]);
            if (!rows[0]) {
                return res.status(404).json({ error: 'LEDGER_ENTRY_NOT_FOUND', message: 'القيد غير موجود' });
            }
            const [entry] = await attachLines(db, rows);
            res.json(entry);
        } catch (error) {
            logger.error('[v3/accounting/journal:id]', error);
            res.status(500).json({ error: 'LEDGER_JOURNAL_FAILED', message: 'تعذر جلب القيد' });
        }
    });

    return router;
}

module.exports = { createV3AccountingReadRouter, READ_ROLES };