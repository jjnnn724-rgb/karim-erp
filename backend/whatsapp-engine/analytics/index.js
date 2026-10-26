/**
 * whatsapp-engine/analytics/index.js — Customer engagement analytics
 * ═════════════════════════════════════════════════════════════════
 *
 * Tracks customer behavior from WhatsApp interactions:
 *   - Response time (avg, median, P95)
 *   - Message volume (per customer, per day)
 *   - Order conversion (message → order)
 *   - Customer satisfaction (implicit from response rate)
 *   - Peak hours (when customers message most)
 *   - Top questions (frequent keywords)
 *
 * All data derived from wa_inbox + wa_outbox tables.
 * No separate tracking — uses existing message history.
 */
'use strict';

const { pool } = require('../../shared-pool');
const { logger } = require('../../logger');

class Analytics {
    constructor() {
        this._cache = new Map();
    }

    /** Get customer engagement profile */
    async customerProfile(jid) {
        const cacheKey = `profile:${jid}`;
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {return cached.data;}

        try {
            const result = await pool.query(`
                SELECT
                    COUNT(*)::int as total_messages,
                    COUNT(DISTINCT DATE_TRUNC('day', TO_TIMESTAMP(ts_ms / 1000)))::int as active_days,
                    MIN(TO_TIMESTAMP(ts_ms / 1000)) as first_contact,
                    MAX(TO_TIMESTAMP(ts_ms / 1000)) as last_contact,
                    COALESCE(
                        (SELECT AVG(EXTRACT(EPOCH FROM (processed_at - TO_TIMESTAMP(ts_ms / 1000))))
                         FROM wa_inbox WHERE remote_jid = $1 AND processed_at IS NOT NULL),
                        0
                    )::int as avg_response_sec,
                    (SELECT COUNT(*) FROM wa_outbox WHERE remote_jid = $1 AND status = 'sent')::int as orders_placed,
                    (SELECT MAX(body) FROM wa_inbox WHERE remote_jid = $1 ORDER BY ts_ms DESC LIMIT 1) as last_message
                FROM wa_inbox WHERE remote_jid = $1
            `, [jid]);

            const data = result.rows[0];
            data.avg_response_min = Math.round((data.avg_response_sec || 0) / 60);
            this._cache.set(cacheKey, { data, ts: Date.now() });
            return data;
        } catch (e) {
            logger.error(`[Analytics] customerProfile failed: ${e.message}`);
            return null;
        }
    }

    /** Daily engagement summary */
    async dailySummary(day) {
        const cacheKey = `daily:${day}`;
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {return cached.data;}

        try {
            const result = await pool.query(`
                SELECT
                    DATE_TRUNC('day', TO_TIMESTAMP(ts_ms / 1000)) as day,
                    COUNT(*)::int as total_messages,
                    COUNT(DISTINCT remote_jid)::int as unique_customers,
                    COUNT(*) FILTER (WHERE ts_ms > EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour') * 1000)::int as last_hour,
                    (SELECT COUNT(*) FROM wa_outbox WHERE DATE(TO_TIMESTAMP(created_at)) = DATE($1) AND status = 'sent')::int as orders_confirmed
                FROM wa_inbox
                WHERE DATE(TO_TIMESTAMP(ts_ms / 1000)) = DATE($1)
                GROUP BY 1
            `, [day]);

            const data = result.rows[0] || { total_messages: 0, unique_customers: 0, last_hour: 0, orders_confirmed: 0 };
            this._cache.set(cacheKey, { data, ts: Date.now() });
            return data;
        } catch (e) {
            logger.error(`[Analytics] dailySummary failed: ${e.message}`);
            return null;
        }
    }

    /** Peak hours (last 7 days) */
    async peakHours() {
        try {
            const result = await pool.query(`
                SELECT EXTRACT(HOUR FROM TO_TIMESTAMP(ts_ms / 1000 + INTERVAL '3 hours'))::int as hour_riyadh,
                       COUNT(*)::int as msg_count
                FROM wa_inbox
                WHERE ts_ms > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days') * 1000
                GROUP BY 1 ORDER BY msg_count DESC LIMIT 5
            `);
            return result.rows;
        } catch (e) {
            logger.error(`[Analytics] peakHours failed: ${e.message}`);
            return [];
        }
    }

    /** Top keywords in customer messages */
    async topKeywords(days = 7) {
        try {
            const result = await pool.query(`
                SELECT word, COUNT(*)::int as freq
                FROM (
                    SELECT unnest(string_to_array(lower(body), ' ')) as word
                    FROM wa_inbox
                    WHERE ts_ms > EXTRACT(EPOCH FROM NOW() - INTERVAL ($1 || ' days')::int) * 1000
                      AND body IS NOT NULL AND length(body) > 2
                ) words
                WHERE length(word) > 3 AND word !~ '^[0-9]+$'
                GROUP BY word ORDER BY freq DESC LIMIT 10
            `, [days]);
            return result.rows;
        } catch (e) {
            logger.error(`[Analytics] topKeywords failed: ${e.message}`);
            return [];
        }
    }

    /** Overall health metrics */
    async healthMetrics() {
        try {
            const [totalMsgs, avgResponse, todayMsgs, activeCustomers] = await Promise.all([
                pool.query('SELECT COUNT(*)::int FROM wa_inbox'),
                pool.query(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (processed_at - TO_TIMESTAMP(ts_ms / 1000)))), 0)::int as sec FROM wa_inbox WHERE processed_at IS NOT NULL`),
                pool.query(`SELECT COUNT(*)::int FROM wa_inbox WHERE DATE(TO_TIMESTAMP(ts_ms / 1000)) = CURRENT_DATE`),
                pool.query(`SELECT COUNT(DISTINCT remote_jid)::int FROM wa_inbox WHERE ts_ms > EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days') * 1000`),
            ]);

            return {
                total_messages: totalMsgs.rows[0].count,
                avg_response_sec: avgResponse.rows[0].sec || 0,
                today_messages: todayMsgs.rows[0].count,
                active_customers_30d: activeCustomers.rows[0].count,
            };
        } catch (e) {
            logger.error(`[Analytics] healthMetrics failed: ${e.message}`);
            return null;
        }
    }

    clearCache() { this._cache.clear(); }
}

module.exports = { Analytics };