'use strict';

const { logger: defaultLogger } = require('./logger');
const { createNotifications, emitNotificationRows, sendRowsAsPush } = require('./notification-service');

const ADVISORY_LOCK_KEY = 731942081;
const DAY_MS = 24 * 60 * 60 * 1000;

function dayBucket(daysRemaining) {
    if (daysRemaining < 0) {return 'overdue';}
    if (daysRemaining <= 7) {return '7d';}
    if (daysRemaining <= 30) {return '30d';}
    return '90d';
}

function buildExpiryAlerts(rows, today) {
    return rows
        .map((row) => {
            const daysRemaining = Math.ceil((Date.parse(`${row.expiry_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
            if (!Number.isFinite(daysRemaining) || daysRemaining > 90 || daysRemaining < -30) {return null;}
            const bucket = dayBucket(daysRemaining);
            return {
                eventKey: `${row.kind}:${row.employee_id}:${row.expiry_date}:${bucket}`,
                title: row.kind === 'iqama' ? 'تنبيه انتهاء إقامة موظف' : 'تنبيه انتهاء عقد موظف',
                message: `${row.employee_name} — ${row.kind === 'iqama' ? 'الإقامة' : 'العقد'} تنتهي في ${row.expiry_date} (${daysRemaining < 0 ? `منذ ${Math.abs(daysRemaining)} يومًا` : `خلال ${daysRemaining} يومًا`}).`,
                entity: row.kind === 'iqama' ? 'employee_iqama' : 'employee_contract',
                entityId: String(row.employee_id),
                link: '/v3/employees',
                targetRoles: ['admin', 'hr', 'manager'],
                type: 'warning',
            };
        })
        .filter(Boolean);
}

function buildDeadlineAlert(row, today) {
    const daysRemaining = Math.ceil((Date.parse(`${row.due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
    if (!Number.isFinite(daysRemaining) || daysRemaining > 90 || daysRemaining < -30) {return null;}
    const bucket = dayBucket(daysRemaining);
    return {
        eventKey: `zatca:${row.id}:${row.due_date}:${bucket}`,
        title: 'تذكير بموعد ضريبي مُدخل يدويًا',
        message: `${row.title} — الموعد المسجّل ${row.due_date} (${daysRemaining < 0 ? `متأخر ${Math.abs(daysRemaining)} يومًا` : `خلال ${daysRemaining} يومًا`}). تحقق من الموعد الرسمي قبل الاعتماد.`,
        entity: 'compliance_deadline',
        entityId: String(row.id),
        link: '/v3/vat-return',
        targetRoles: ['admin', 'accountant'],
        type: 'warning',
    };
}

function buildIntegrityAlerts(rows, today) {
    return rows.map((row) => {
        const lineCount = Number(row.line_count);
        const detail = Number.isInteger(lineCount) && lineCount < 2
            ? `عدد السطور ${lineCount} (الحد الأدنى سطران)`
            : `المدين ${row.debits} مقابل الدائن ${row.credits} (الفرق ${row.difference})`;
        return {
            eventKey: `journal-unbalanced:${row.entry_id}:${today}`,
            title: 'فشل فحص توازن قيد مرحّل',
            message: `القيد ${row.entry_no || row.entry_id} غير سليم: ${detail}.`,
            entity: 'journal_entry',
            entityId: String(row.entry_id),
            link: '/v3/journal',
            targetRoles: ['admin', 'accountant'],
            type: 'error',
        };
    });
}

function riyadhDay(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}

function millisecondsUntilNextRun(now = new Date()) {
    const localNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
    const nextLocal = new Date(localNow);
    nextLocal.setHours(2, 15, 0, 0);
    if (nextLocal <= localNow) {nextLocal.setDate(nextLocal.getDate() + 1);}
    return Math.max(1000, nextLocal.getTime() - localNow.getTime());
}

function startComplianceAutomation({ pool, io, log = defaultLogger, intervalForNextRun = millisecondsUntilNextRun } = {}) {
    if (!pool || typeof pool.connect !== 'function') {
        throw new TypeError('Compliance automation requires a PostgreSQL pool');
    }

    let stopped = false;
    let timer = null;
    let running = false;

    async function runOnce() {
        if (running) {return { skipped: 'already_running' };}
        running = true;
        let client;
        let locked = false;
        try {
            client = await pool.connect();
            const lock = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [ADVISORY_LOCK_KEY]);
            locked = !!lock.rows[0]?.acquired;
            if (!locked) {return { skipped: 'another_instance_running' };}

            const today = riyadhDay();
            const expiries = (await client.query(
                `SELECT 'iqama'::text AS kind, e.id::text AS employee_id, e.name AS employee_name,
                        e."iqamaExpiry" AS expiry_date
                   FROM employees e
                  WHERE e.status = 'active'
                    AND e."iqamaExpiry" ~ '^\\d{4}-\\d{2}-\\d{2}$'
                    AND e."iqamaExpiry" BETWEEN ($1::date - INTERVAL '30 days')::date::text AND ($1::date + INTERVAL '90 days')::date::text
                 UNION ALL
                 SELECT 'contract'::text AS kind, e.id::text AS employee_id, e.name AS employee_name,
                        c.end_date AS expiry_date
                   FROM employee_contracts c
                   JOIN employees e ON e.id = c."employeeId"
                  WHERE e.status = 'active'
                    AND c.start_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
                    AND c.end_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
                    AND c.start_date <= $1::date::text
                    AND c.end_date BETWEEN ($1::date - INTERVAL '30 days')::date::text AND ($1::date + INTERVAL '90 days')::date::text`,
                [today])).rows;
            const deadlines = (await client.query(
                `SELECT id, title, due_date::text AS due_date
                   FROM compliance_deadlines
                  WHERE active = true
                    AND due_date BETWEEN $1::date - INTERVAL '30 days' AND $1::date + INTERVAL '90 days'
                  ORDER BY due_date, id`, [today])).rows;
            const unbalanced = (await client.query(
                `SELECT e.id::text AS entry_id, e.entry_no,
                        ROUND(COALESCE(SUM(l.debit),0),2)::text AS debits,
                        ROUND(COALESCE(SUM(l.credit),0),2)::text AS credits,
                        ROUND(ABS(COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0)),2)::text AS difference,
                        COUNT(l.entry_id)::int AS line_count,
                        COUNT(*) OVER()::int AS anomaly_count
                   FROM journal_entries e
                   LEFT JOIN journal_lines l ON l.entry_id = e.id
                  WHERE e.status = 'posted'
                  GROUP BY e.id, e.entry_no
                 HAVING COUNT(l.entry_id) < 2
                     OR ABS(COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0)) > 0.005
                  ORDER BY e.id
                  LIMIT 100`)).rows;
            const unbalancedCount = Number(unbalanced[0]?.anomaly_count || 0);

            const alertCandidates = [
                ...buildExpiryAlerts(expiries, today),
                ...deadlines.map((row) => buildDeadlineAlert(row, today)).filter(Boolean),
                ...buildIntegrityAlerts(unbalanced, today),
            ];
            const alerts = [...new Map(alertCandidates.map((alert) => [alert.eventKey, alert])).values()];
            let sent = 0;
            for (const alert of alerts) {
                await client.query('BEGIN');
                try {
                    const prior = await client.query(
                        'SELECT 1 FROM compliance_alert_events WHERE event_key = $1 FOR UPDATE',
                        [alert.eventKey]);
                    if (prior.rows[0]) {
                        await client.query('COMMIT');
                        continue;
                    }
                    const created = await createNotifications(client, alert);
                    if (created.rows.length) {
                        await client.query(
                            `INSERT INTO compliance_alert_events (event_key, notification_count, created_at)
                             VALUES ($1,$2,CURRENT_TIMESTAMP)
                             ON CONFLICT (event_key) DO NOTHING`,
                            [alert.eventKey, created.rows.length]);
                        emitNotificationRows(io, created.rows);
                        void sendRowsAsPush(created.rows);
                        sent += created.rows.length;
                    }
                    await client.query('COMMIT');
                } catch (error) {
                    await client.query('ROLLBACK').catch(() => {});
                    throw error;
                }
            }

            if (unbalancedCount) {
                log.error(`[compliance-integrity] ${unbalancedCount} posted journal entries are unbalanced; alert details sent for up to ${unbalanced.length}`);
            } else {
                log.info('[compliance-integrity] posted journal entries are balanced');
            }
            log.info(`[compliance-automation] checked ${expiries.length} expiring records, ${deadlines.length} configured deadlines, ${unbalancedCount} ledger anomalies; sent ${sent} notifications`);
            return { expiries: expiries.length, deadlines: deadlines.length, unbalanced: unbalancedCount, sent };
        } finally {
            if (client && locked) {
                await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch((error) =>
                    log.warn('[compliance-automation] advisory unlock failed:', error.message));
            }
            client?.release();
            running = false;
        }
    }

    function schedule() {
        if (stopped) {return;}
        timer = setTimeout(async () => {
            try {
                await runOnce();
            } catch (error) {
                log.error('[compliance-automation] scheduled check failed:', error);
            } finally {
                schedule();
            }
        }, intervalForNextRun());
        timer.unref?.();
    }

    schedule();
    return {
        runOnce,
        stop() {
            stopped = true;
            if (timer) {clearTimeout(timer);}
        },
    };
}

module.exports = {
    dayBucket,
    buildExpiryAlerts,
    buildDeadlineAlert,
    buildIntegrityAlerts,
    millisecondsUntilNextRun,
    riyadhDay,
    startComplianceAutomation,
};
