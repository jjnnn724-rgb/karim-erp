/**
 * مصدر البيانات القديم (Yarasoft / Oracle) — وضع التشغيل المستقل.
 *
 * v3 يعمل على PostgreSQL وحده. عند اختيار «مستقل»: تُوقف مزامنة Yarasoft
 * والربط المباشر بـOracle فورًا، ولا تُستأنف عند إعادة تشغيل الخادم، وتبقى
 * البيانات المستوردة سابقًا للقراءة فقط داخل PostgreSQL.
 *
 * المصدر الوحيد للحقيقة هنا هو جدول `integration_settings` في PostgreSQL؛
 * لا يعتمد القرار على متغيرات بيئة قابلة للنسيان.
 */
const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');

const SETTINGS_KEY = 'legacy_source';
const MODES = ['connected', 'standalone'];

let schemaReady = null;

async function ensureSchema() {
    if (schemaReady) return schemaReady;
    schemaReady = pool
        .query(
            `CREATE TABLE IF NOT EXISTS integration_settings (
                key         TEXT PRIMARY KEY,
                value       JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_by  TEXT
            );`,
        )
        .catch((error) => {
            schemaReady = null;
            throw error;
        });
    return schemaReady;
}

/** الوضع الحالي: «مستقل» هو الافتراضي الآمن إن تعذّرت القراءة. */
async function getMode() {
    try {
        await ensureSchema();
        const result = await pool.query('SELECT value FROM integration_settings WHERE key = $1', [SETTINGS_KEY]);
        const mode = result.rows[0]?.value?.mode;
        return MODES.includes(mode) ? mode : 'connected';
    } catch (error) {
        logger.warn('[legacy-source] تعذّرت قراءة الوضع، سيُعامل كمستقل:', error.message);
        return 'standalone';
    }
}

async function isStandalone() {
    return (await getMode()) === 'standalone';
}

async function setMode(mode, userId) {
    await ensureSchema();
    await pool.query(
        `INSERT INTO integration_settings (key, value, updated_at, updated_by)
         VALUES ($1, jsonb_build_object('mode', $2::text), CURRENT_TIMESTAMP, $3)
         ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
        [SETTINGS_KEY, mode, userId ? String(userId) : null],
    );
}

/** تطبيق الوضع على المحركات الحيّة دون إعادة تشغيل الخادم. */
function applyMode(mode, app) {
    const engine = app?.locals?.yarasoftEngine;
    if (!engine) return;
    try {
        if (mode === 'standalone') {
            engine.stop();
            logger.info('[legacy-source] الوضع المستقل: أُوقفت مزامنة Yarasoft.');
        } else if (typeof engine.start === 'function') {
            void engine.start(app.locals.io);
            logger.info('[legacy-source] الوضع المتصل: أُعيد تشغيل مزامنة Yarasoft.');
        }
    } catch (error) {
        logger.warn('[legacy-source] تعذّر تطبيق الوضع على المحرك:', error.message);
    }
}

function engineStatus(app) {
    const status = app?.locals?.yarasoftEngine?.status?.();
    return status
        ? {
              running: Boolean(status.running),
              enabled: Boolean(status.enabled),
              lastRunAt: status.lastRunAt ?? null,
              importedToday: status.importedToday ?? null,
          }
        : { running: false, enabled: false, lastRunAt: null, importedToday: null };
}

function oracleStatus() {
    try {
        const { loadOracleConfig } = require('./yarasoft/oracle-link');
        const config = loadOracleConfig();
        return { configured: Boolean(config.enabled), host: config.host ?? null, service: config.service ?? null };
    } catch (error) {
        return { configured: false, host: null, service: null, error: error.message };
    }
}

function router(app) {
    const api = express.Router();
    api.use(jwtAuth, requireRole('admin', 'manager', 'accountant', 'auditor'));

    api.get('/legacy', async (req, res) => {
        const mode = await getMode();
        res.json({ mode, standalone: mode === 'standalone', yarasoft: engineStatus(app), oracle: oracleStatus() });
    });

    api.patch('/legacy', requireRole('admin'), async (req, res) => {
        const mode = String(req.body?.mode ?? '').trim();
        if (!MODES.includes(mode)) {
            return res.status(422).json({ error: 'INVALID_MODE', message: 'الوضع المسموح: connected أو standalone' });
        }
        await setMode(mode, req.user?.id);
        applyMode(mode, app);
        logger.info(`[legacy-source] الوضع الآن ${mode} (بواسطة ${req.user?.username || req.user?.id})`);
        res.json({ mode, standalone: mode === 'standalone', yarasoft: engineStatus(app), oracle: oracleStatus() });
    });

    return api;
}

module.exports = { router, getMode, isStandalone, setMode, applyMode, ensureSchema };
