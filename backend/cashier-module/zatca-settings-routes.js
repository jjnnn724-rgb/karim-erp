/**
 * zatca-settings-routes.js — ZATCA (Fatoora) integration hub
 * ────────────────────────────────────────────────────────────────────────────
 * Everything the owner needs to run the tax-authority link from the SETTINGS
 * screen — no code, no server restart, no env files:
 *
 *   GET  /api/zatca/settings   — config (secrets masked) + queue stats + engine mode
 *   PUT  /api/zatca/settings   — save seller data / environment / endpoint (admin+)
 *   POST /api/zatca/toggle     — real ENABLE/DISABLE of the whole tax link (admin+)
 *   POST /api/zatca/test       — real connectivity probe of the Fatoora endpoint
 *   POST /api/zatca/csr        — generate a real EC-P256 CSR (ZATCA subject)
 *   POST /api/zatca/csid       — request a compliance CSID with the OTP (real call)
 *   POST /api/zatca/csid/manual— paste a CSID obtained from the Fatoora portal / clear it (admin+)
 *   POST /api/zatca/apply-vat  — stamp the hub VAT onto every department (admin+)
 *   GET  /api/zatca/queue      — invoice queue rows + counters
 *   POST /api/zatca/queue/retry— retry failed / dead-letter invoices (admin+)
 *
 * Engine: an in-server poller drains pos_zatca_invoice_queue ONLY while the
 * integration is enabled. Disabling freezes the queue (nothing is submitted,
 * nothing is deleted) — local ZATCA QRs keep working because they are
 * generated offline at sale time by law.
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { pool } = require('./db-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { logger } = require('../logger');
const { generateZatcaCsr } = require('./zatca-csr');
const { enqueueZatcaReporting } = require('./zatca-queue');
const { normalizeVat } = require('./zatca-vat');

const router = express.Router();
const READ_ROLES = ['admin', 'manager', 'accountant', 'auditor'];
const WRITE_ROLES = ['admin', 'manager'];

const ENVIRONMENTS = {
    developer_portal: {
        label: 'بيئة المطوّر (Developer Portal)',
        apiBase: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
    },
    simulation: {
        label: 'بيئة المحاكاة (Simulation)',
        apiBase: 'https://gw-factoora.zatca.gov.sa/e-invoicing/simulation',
    },
    production: {
        label: 'بيئة الإنتاج (Production)',
        apiBase: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
    },
};
const POLL_INTERVAL_MS = parseInt(process.env.ZATCA_POLL_INTERVAL_MS || '15000', 10);

// ─── Schema (self-healing, no manual migration step) ─────────────────────────
let schemaReady = null;
function ensureZatcaSchema() {
    if (!schemaReady) {
        schemaReady = (async () => {
            // New enum states the void flow + poller need. ALTER TYPE cannot run
            // inside a transaction — execute one statement per call.
            for (const value of ['skipped_cancelled', 'skipped_disabled']) {
                try {
                    await pool.query(`ALTER TYPE pos_zatca_status ADD VALUE IF NOT EXISTS '${value}';`);
                } catch (e) {
                    if (e.code !== '42710' && !/already exists/i.test(e.message)) {throw e;}
                }
            }
            await pool.query(`
                CREATE TABLE IF NOT EXISTS zatca_settings (
                    id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                    enabled           BOOLEAN NOT NULL DEFAULT FALSE,
                    environment       VARCHAR(20) NOT NULL DEFAULT 'developer_portal',
                    api_base          TEXT,
                    seller_name       TEXT,
                    vat_number        VARCHAR(20),
                    crn               VARCHAR(40),
                    address           TEXT,
                    branch_name       TEXT,
                    eid               VARCHAR(60),
                    solution_name     TEXT,
                    csid              TEXT,
                    csid_obtained_at  TIMESTAMPTZ,
                    csr_pem           TEXT,
                    private_key_pem   TEXT,
                    poll_in_server    BOOLEAN NOT NULL DEFAULT TRUE,
                    max_attempts      SMALLINT NOT NULL DEFAULT 10,
                    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_by        BIGINT
            );`);
            await pool.query(
                `INSERT INTO zatca_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`
            );
            logger.info('[zatca-settings] schema ready');
        })().catch((e) => { schemaReady = null; throw e; });
    }
    return schemaReady;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function maskSecret(value, keep = 4) {
    const s = String(value || '');
    if (!s) {return null;}
    if (s.length <= keep) {return '••••';}
    return `${s.slice(0, keep)}••••••••••••`;
}

async function loadConfig() {
    await ensureZatcaSchema();
    const res = await pool.query(`SELECT * FROM zatca_settings WHERE id = 1;`);
    return res.rows[0] || null;
}

async function queueStats() {
    const res = await pool.query(
        `SELECT status, COUNT(*)::int AS count FROM pos_zatca_invoice_queue GROUP BY status;`
    );
    const stats = { queued: 0, processing: 0, reported: 0, failed: 0, dead_letter: 0, skipped_cancelled: 0, skipped_disabled: 0 };
    for (const row of res.rows) {stats[row.status] = Number(row.count);}
    return stats;
}

/**
 * Manual CSID validation — the token Fatoora returns (binarySecurityToken) is a
 * base64 X.509 certificate, typically hundreds of chars. Accept only plausible
 * base64 payloads so a typo never poisons the integration silently.
 * @returns {string|null} Arabic error message, or null when valid.
 */
function validateManualCsid(token) {
    const t = String(token ?? '').trim();
    if (!t) {return 'الشهادة مطلوبة — الصق رمز الشهادة (binarySecurityToken) كما هو';}
    if (t.length < 80) {return 'الشهادة قصيرة جدًا — انسخ الشهادة كاملة من منصة Fatoora';}
    if (t.length > 8192) {return 'الشهادة أطول من الحد المسموح (8192 حرفًا)';}
    if (!/^[A-Za-z0-9+/=\r\n_-]+$/.test(t)) {return 'الشهادة يجب أن تكون نص Base64 — بدون أسطر مضافة يدويًا أو رموز غريبة';}
    return null;
}

function validateConfigPayload(body) {
    const errors = [];
    const clean = {};
    const allowed = ['seller_name', 'vat_number', 'crn', 'address', 'branch_name', 'eid',
        'solution_name', 'environment', 'api_base', 'max_attempts', 'poll_in_server'];
    for (const key of allowed) {
        if (!Object.prototype.hasOwnProperty.call(body, key)) {continue;}
        const v = body[key];
        if (v === null || (typeof v === 'string' && !v.trim())) { clean[key] = null; continue; }
        if (key === 'environment') {
            if (!ENVIRONMENTS[v]) { errors.push('البيئة غير صحيحة (developer_portal | simulation | production)'); continue; }
            clean[key] = v;
        } else if (key === 'vat_number') {
            const digits = String(v).replace(/\D/g, '');
            if (!/^\d{15}$/.test(digits)) { errors.push('الرقم الضريبي يجب أن يكون 15 رقمًا (رقم ضريبي سعودي)'); continue; }
            clean[key] = digits;
        } else if (key === 'api_base') {
            try {
                const u = new URL(v);
                if (u.protocol !== 'https:') {errors.push('عنوان الـ API يجب أن يكون HTTPS');}
                else {clean[key] = u.origin + (u.pathname === '/' ? '' : u.pathname).replace(/\/+$/, '');}
            } catch (_) { errors.push('عنوان الـ API غير صالح'); }
        } else if (key === 'max_attempts') {
            const n = parseInt(v, 10);
            if (!Number.isInteger(n) || n < 1 || n > 50) { errors.push('عدد المحاولات بين 1 و 50'); continue; }
            clean[key] = n;
        } else if (key === 'poll_in_server') {
            clean[key] = Boolean(v);
        } else {
            clean[key] = String(v).trim().slice(0, 500);
        }
    }
    return { errors, clean };
}

function publicConfig(cfg) {
    if (!cfg) {return null;}
    return {
        enabled: cfg.enabled,
        environment: cfg.environment,
        environment_label: ENVIRONMENTS[cfg.environment]?.label || cfg.environment,
        default_api_base: ENVIRONMENTS[cfg.environment]?.apiBase || null,
        api_base: cfg.api_base || ENVIRONMENTS[cfg.environment]?.apiBase || null,
        seller_name: cfg.seller_name,
        vat_number: cfg.vat_number,
        crn: cfg.crn,
        address: cfg.address,
        branch_name: cfg.branch_name,
        eid: cfg.eid ? maskSecret(cfg.eid, 3) : null,
        solution_name: cfg.solution_name,
        csid_masked: cfg.csid ? maskSecret(cfg.csid, 6) : null,
        has_csid: Boolean(cfg.csid),
        has_csr: Boolean(cfg.csr_pem),
        has_private_key: Boolean(cfg.private_key_pem),
        csid_obtained_at: cfg.csid_obtained_at,
        poll_in_server: cfg.poll_in_server,
        max_attempts: cfg.max_attempts,
        updated_at: cfg.updated_at,
        environments: Object.entries(ENVIRONMENTS).map(([value, e]) => ({ value, label: e.label, api_base: e.apiBase })),
    };
}

async function audit(action, reason, metadata, req) {
    try {
        await pool.query(
            `INSERT INTO pos_audit_logs(action, table_name, row_pk, reason, metadata)
             VALUES ($1, 'zatca_settings', '1', $2, $3::jsonb);`,
            [action, reason || null, JSON.stringify({ ...(metadata || {}), by: req?.user?.id || null })]
        );
    } catch (e) {
        logger.warn('[zatca-settings] audit write failed (non-fatal):', e.message);
    }
}

// ─── GET /settings — full status for the settings screen ─────────────────────
router.get('/settings', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const cfg = await loadConfig();
        const stats = await queueStats();
        res.json({
            config: publicConfig(cfg),
            queue: stats,
            engine: {
                mode: process.env.SKIP_BULLMQ === '1' ? 'sql_poller' : 'bullmq+sql',
                poller_in_server: cfg?.poll_in_server !== false && process.env.ZATCA_INPROCESS_POLLER !== '0',
                poll_interval_ms: POLL_INTERVAL_MS,
            },
        });
    } catch (e) {
        logger.error('[zatca/settings]', e);
        res.status(500).json({ error: 'ZATCA_SETTINGS_READ_FAILED', message: 'تعذر قراءة إعدادات ZATCA' });
    }
});

// ─── PUT /settings — save configuration ──────────────────────────────────────
router.put('/settings', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const { errors, clean } = validateConfigPayload(req.body || {});
        if (errors.length) {return res.status(422).json({ error: 'VALIDATION_FAILED', message: errors.join(' — '), errors });}

        const keys = Object.keys(clean);
        if (!keys.length) {return res.status(422).json({ error: 'NOTHING_TO_UPDATE', message: 'لا توجد حقول للتحديث' });}

        // Switching environment resets the stored endpoint so it follows the
        // official Fatoora base URL again (unless an explicit override remains).
        if (clean.environment && !clean.api_base) {
            const row = await loadConfig();
            if (row && row.api_base && row.api_base === ENVIRONMENTS[row.environment]?.apiBase) {
                clean.api_base = ENVIRONMENTS[clean.environment].apiBase;
            }
        }

        const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
        const params = keys.map((k) => clean[k]);
        params.push(req.user.id);
        await ensureZatcaSchema();
        await pool.query(
            `UPDATE zatca_settings SET ${sets}, updated_at = CURRENT_TIMESTAMP, updated_by = $${params.length} WHERE id = 1;`,
            params
        );
        await audit('UPDATE', 'حفظ إعدادات ZATCA', { fields: keys }, req);
        res.json({ ok: true, config: publicConfig(await loadConfig()) });
    } catch (e) {
        logger.error('[zatca/settings PUT]', e);
        res.status(500).json({ error: 'ZATCA_SETTINGS_SAVE_FAILED', message: 'تعذر حفظ الإعدادات' });
    }
});

// ─── POST /toggle — real enable/disable ──────────────────────────────────────
router.post('/toggle', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const enabled = Boolean(req.body?.enabled);
        const cfg = await loadConfig();
        if (!cfg) {return res.status(500).json({ error: 'ZATCA_CONFIG_MISSING' });}

        if (enabled) {
            const missing = [];
            if (!cfg.seller_name) {missing.push('اسم المنشأة');}
            if (!cfg.vat_number || !/^\d{15}$/.test(cfg.vat_number)) {missing.push('الرقم الضريبي (15 رقمًا)');}
            if (!cfg.csid) {missing.push('شهادة CSID (اطلبها عبر OTP)');}
            if (missing.length) {
                return res.status(422).json({
                    error: 'ZATCA_INCOMPLETE',
                    message: `لا يمكن التفعيل — أكمل أولاً: ${missing.join('، ')}`,
                    missing,
                });
            }
        }

        await pool.query(
            `UPDATE zatca_settings SET enabled = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2 WHERE id = 1;`,
            [enabled, req.user.id]
        );
        // Freeze any in-flight rows when disabled so nothing half-submits
        if (!enabled) {
            await pool.query(
                `UPDATE pos_zatca_invoice_queue SET status = 'queued'
                  WHERE status = 'processing';`
            );
        }
        await audit('UPDATE', enabled ? 'تفعيل ربط ZATCA' : 'إيقاف ربط ZATCA', { toggle: enabled }, req);
        logger.info(`[zatca-settings] integration ${enabled ? 'ENABLED' : 'DISABLED'} by user ${req.user.id}`);
        res.json({ ok: true, enabled, config: publicConfig(await loadConfig()) });
    } catch (e) {
        logger.error('[zatca/toggle]', e);
        res.status(500).json({ error: 'ZATCA_TOGGLE_FAILED', message: 'تعذر تغيير حالة الربط' });
    }
});

// ─── POST /test — real connectivity probe ────────────────────────────────────
router.post('/test', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const cfg = await loadConfig();
    const apiBase = (req.body?.api_base || cfg?.api_base || ENVIRONMENTS[cfg?.environment]?.apiBase || '').replace(/\/+$/, '');
    if (!apiBase) {return res.status(422).json({ error: 'NO_ENDPOINT', message: 'لا يوجد عنوان API مضبوط' });}
    const started = Date.now();
    try {
        const response = await axios.get(apiBase, { timeout: 12_000, validateStatus: () => true });
        res.json({
            ok: response.status < 500,
            http_status: response.status,
            latency_ms: Date.now() - started,
            endpoint: apiBase,
            note: response.status < 500 ? 'الخدمة تستجيب' : 'الخدمة تستجيب بخطأ خادم',
        });
    } catch (e) {
        res.json({
            ok: false,
            endpoint: apiBase,
            latency_ms: Date.now() - started,
            error: e.code || 'REQUEST_FAILED',
            message: e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN'
                ? 'تعذر الوصول للشبكة أو أن العنوان خاطئ'
                : e.message,
        });
    }
});

// ─── POST /csr — generate real CSR + keypair ─────────────────────────────────
router.post('/csr', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const cfg = await loadConfig();
        const vat = (req.body?.vat_number || cfg?.vat_number || '').replace(/\D/g, '');
        const solutionName = (req.body?.solution_name || cfg?.solution_name || 'Karim ERP').trim();
        const orgName = (req.body?.organization_name || cfg?.seller_name || '').trim();
        const branch = (req.body?.branch_name || cfg?.branch_name || orgName || 'الفرع الرئيسي').trim();
        const uid = (req.body?.eid || cfg?.eid || '').trim();
        const invoiceType = req.body?.invoice_type === 'simplified' ? 'simplified' : 'standard';

        const csr = generateZatcaCsr({
            vatNumber: vat, commonName: solutionName, organizationName: orgName,
            organizationalUnit: branch, uid, invoiceType,
        });
        await ensureZatcaSchema();
        await pool.query(
            `UPDATE zatca_settings SET csr_pem = $1, private_key_pem = $2, solution_name = $3,
                    branch_name = $4, updated_at = CURRENT_TIMESTAMP, updated_by = $5 WHERE id = 1;`,
            [csr.csrPem, csr.privateKeyPem, solutionName, branch, req.user.id]
        );
        await audit('UPDATE', 'توليد CSR جديد لـ ZATCA', { subject: csr.subject }, req);
        res.json({ ok: true, csr_pem: csr.csrPem, subject: csr.subject });
    } catch (e) {
        if (e.code === 'INVALID_VAT') {return res.status(422).json({ error: e.code, message: e.message });}
        logger.error('[zatca/csr]', e);
        res.status(500).json({ error: 'CSR_FAILED', message: 'تعذر توليد CSR' });
    }
});

// ─── POST /csid — request compliance certificate with OTP (real call) ────────
router.post('/csid', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const cfg = await loadConfig();
        if (!cfg?.csr_pem) {return res.status(422).json({ error: 'NO_CSR', message: 'ولّد CSR أولاً ثم اطلب الشهادة' });}
        const otp = String(req.body?.otp || '').trim();
        if (!/^\d{6}$/.test(otp)) {return res.status(422).json({ error: 'INVALID_OTP', message: 'رمز OTP يجب أن يكون 6 أرقام (من منصة Fatoora)' });}

        const apiBase = (cfg.api_base || ENVIRONMENTS[cfg.environment]?.apiBase || '').replace(/\/+$/, '');
        const csrBase64 = cfg.csr_pem
            .replace(/-----BEGIN CERTIFICATE REQUEST-----/, '').replace(/-----END CERTIFICATE REQUEST-----/, '')
            .replace(/\s+/g, '');

        const response = await axios.post(
            `${apiBase}/compliance`,
            { csr: csrBase64 },
            {
                timeout: 30_000,
                validateStatus: () => true,
                headers: {
                    'accept': 'application/json',
                    'accept-language': 'en',
                    'Accept-Version': 'V2',
                    'OTP': otp,
                    'Content-Type': 'application/json',
                },
            }
        );

        const data = response.data || {};
        if (response.status >= 200 && response.status < 300 && data.binarySecurityToken) {
            await pool.query(
                `UPDATE zatca_settings SET csid = $1, csid_obtained_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP, updated_by = $2 WHERE id = 1;`,
                [data.binarySecurityToken, req.user.id]
            );
            await audit('UPDATE', 'استلام شهادة الامتثال CSID', { environment: cfg.environment }, req);
            return res.json({ ok: true, csid_masked: maskSecret(data.binarySecurityToken, 6), environment: cfg.environment });
        }
        await audit('UPDATE', 'رفض طلب CSID', { status: response.status, errors: data.errors || null }, req);
        return res.status(response.status || 502).json({
            ok: false,
            http_status: response.status,
            message: 'رفضت الهيئة طلب الشهادة — راجع تفاصيل الأخطاء',
            errors: data.errors || data,
        });
    } catch (e) {
        logger.error('[zatca/csid]', e);
        const networked = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT'].includes(e.code);
        res.status(502).json({
            error: 'CSID_REQUEST_FAILED',
            message: networked ? 'تعذر الاتصال بمنصة Fatoora — تحقق من الشبكة من زر اختبار الاتصال' : e.message,
        });
    }
});

// ─── POST /csid/manual — paste a CSID obtained from the Fatoora portal ──────
// Some taxpayers onboard the EGS device on fatoora.zatca.gov.sa and copy the
// certificate from the portal directly. This is a REAL onboarding path, so the
// settings screen must support it without any code.
router.post('/csid/manual', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const cfg = await loadConfig();
        if (!cfg) {return res.status(500).json({ error: 'ZATCA_CONFIG_MISSING' });}

        // clear:true → forget the stored certificate (allows a clean re-onboard)
        if (req.body?.clear === true) {
            if (!cfg.csid) {return res.status(422).json({ error: 'NO_CSID', message: 'لا توجد شهادة محفوظة لحذفها' });}
            await pool.query(
                `UPDATE zatca_settings SET csid = NULL, csid_obtained_at = NULL,
                        updated_at = CURRENT_TIMESTAMP, updated_by = $1 WHERE id = 1;`,
                [req.user.id]
            );
            await audit('UPDATE', 'حذف شهادة CSID من مركز الإعدادات', { cleared: true }, req);
            logger.info(`[zatca-settings] CSID cleared by user ${req.user.id}`);
            return res.json({ ok: true, cleared: true, config: publicConfig(await loadConfig()) });
        }

        const token = String(req.body?.csid ?? '').trim();
        const invalid = validateManualCsid(token);
        if (invalid) {return res.status(422).json({ error: 'INVALID_CSID', message: invalid });}

        // Also save the seller VAT first if provided — enabling still requires it
        const vat = normalizeVat(req.body?.vat_number || cfg.vat_number);
        await pool.query(
            `UPDATE zatca_settings
                SET csid = $1, csid_obtained_at = CURRENT_TIMESTAMP,
                    vat_number = COALESCE($2, vat_number),
                    updated_at = CURRENT_TIMESTAMP, updated_by = $3
              WHERE id = 1;`,
            [token, vat, req.user.id]
        );
        await audit('UPDATE', 'إدخال شهادة CSID يدويًا من مركز الإعدادات', { environment: cfg.environment }, req);
        logger.info(`[zatca-settings] manual CSID stored by user ${req.user.id}`);
        res.json({ ok: true, csid_masked: maskSecret(token, 6), config: publicConfig(await loadConfig()) });
    } catch (e) {
        logger.error('[zatca/csid/manual]', e);
        res.status(500).json({ error: 'CSID_MANUAL_FAILED', message: 'تعذر حفظ الشهادة' });
    }
});

// ─── POST /apply-vat — stamp the hub VAT onto every department ───────────────
// The hub VAT is the company VAT. Departments/branches of the same legal
// entity share it, so one click keeps receipts and QRs compliant everywhere.
router.post('/apply-vat', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const cfg = await loadConfig();
        if (!cfg) {return res.status(500).json({ error: 'ZATCA_CONFIG_MISSING' });}
        const vat = normalizeVat(req.body?.vat_number || cfg.vat_number);
        if (!vat) {
            return res.status(422).json({
                error: 'NO_VAT_NUMBER',
                message: 'احفظ الرقم الضريبي (15 رقمًا) في مركز الإعدادات أولاً أو أرسله في الطلب',
            });
        }
        const updated = await pool.query(
            `UPDATE pos_departments SET vat_number = $1 WHERE COALESCE(vat_number, '') <> $1
              RETURNING id, name_ar, vat_number;`,
            [vat]
        );
        await audit('UPDATE', `تطبيق الرقم الضريبي على ${updated.rows.length} قسماً`, { vat, departments: updated.rows.map((r) => r.id) }, req);
        logger.info(`[zatca-settings] VAT ${vat} applied to ${updated.rows.length} department(s) by user ${req.user.id}`);
        res.json({
            ok: true,
            vat_number: vat,
            updated: updated.rows.length,
            departments: updated.rows.map((r) => ({ id: String(r.id), name_ar: r.name_ar })),
        });
    } catch (e) {
        logger.error('[zatca/apply-vat]', e);
        res.status(500).json({ error: 'APPLY_VAT_FAILED', message: 'تعذر تطبيق الرقم الضريبي على الأقسام' });
    }
});

// ─── GET /queue — queue monitor ──────────────────────────────────────────────
router.get('/queue', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const stats = await queueStats();
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const params = [];
        let where = `TRUE`;
        if (req.query.status && stats[req.query.status] !== undefined) {
            params.push(req.query.status); where = `q.status = $1`;
        }
        const rows = await pool.query(
            `SELECT q.id, q.status, q.attempts, q.max_attempts, q.next_retry_at, q.last_error,
                    q.queued_at, q.reported_at,
                    po.invoice_counter, po.total_amount, po.created_at AS order_date,
                    pd.name_ar AS department_name
               FROM pos_zatca_invoice_queue q
               JOIN pos_orders po ON po.id = q.order_id
               LEFT JOIN pos_departments pd ON pd.id = po.department_id
              WHERE ${where}
              ORDER BY q.queued_at DESC
              LIMIT ${limit};`,
            params
        );
        res.json({
            stats,
            engine: {
                mode: process.env.SKIP_BULLMQ === '1' ? 'sql_poller' : 'bullmq+sql',
                poll_interval_ms: POLL_INTERVAL_MS,
            },
            data: rows.rows.map((r) => ({
                ...r,
                total_amount: Number(r.total_amount),
                invoice_number: `#${r.invoice_counter}`,
            })),
        });
    } catch (e) {
        logger.error('[zatca/queue]', e);
        res.status(500).json({ error: 'ZATCA_QUEUE_READ_FAILED', message: 'تعذر قراءة طابور ZATCA' });
    }
});

// ─── POST /queue/retry — requeue failed / dead-letter ────────────────────────
router.post('/queue/retry', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const scope = req.body?.scope === 'all' ? 'all' : 'failed'; // failed = failed + dead_letter
        const statuses = scope === 'all'
            ? ['failed', 'dead_letter', 'queued']
            : ['failed', 'dead_letter'];
        const rows = await pool.query(
            `UPDATE pos_zatca_invoice_queue
                SET status = 'queued', attempts = 0, next_retry_at = CURRENT_TIMESTAMP,
                    last_error = CASE WHEN status = 'dead_letter' THEN NULL ELSE last_error END
              WHERE status = ANY($1::pos_zatca_status[])
              RETURNING order_id;`,
            [statuses]
        );
        for (const row of rows.rows) {
            await enqueueZatcaReporting({ orderId: row.order_id }).catch(() => {});
        }
        await audit('UPDATE', `إعادة جدولة فواتير ZATCA (${scope})`, { count: rows.rows.length }, req);
        res.json({ ok: true, requeued: rows.rows.length, scope });
    } catch (e) {
        logger.error('[zatca/queue/retry]', e);
        res.status(500).json({ error: 'ZATCA_RETRY_FAILED', message: 'تعذر إعادة الجدولة' });
    }
});

// ─── In-server poller — drains the SQL queue while enabled ───────────────────
async function zatcaQueueTick() {
    const { submitInvoiceToZatca } = require('./zatca-worker');
    const cfg = await loadConfig();
    if (!cfg || !cfg.enabled) {return;} // integration OFF → freeze everything
    const client = await pool.connect();
    try {
        // Reclaim rows stranded in 'processing' by a crash between claim and finish
        await client.query(
            `UPDATE pos_zatca_invoice_queue
                SET status = 'queued', next_retry_at = CURRENT_TIMESTAMP
              WHERE status = 'processing' AND last_attempt_at <= CURRENT_TIMESTAMP - INTERVAL '15 minutes';`
        );
        const claim = await client.query(
            `UPDATE pos_zatca_invoice_queue
                SET status = 'processing', attempts = attempts + 1, last_attempt_at = CURRENT_TIMESTAMP
              WHERE id IN (
                SELECT id FROM pos_zatca_invoice_queue
                 WHERE status IN ('queued', 'failed')
                   AND attempts < LEAST(max_attempts, $1)
                   AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
                 ORDER BY queued_at LIMIT 5 FOR UPDATE SKIP LOCKED
              )
              RETURNING id, order_id, attempts;`,
            [cfg.max_attempts || 10]
        );
        for (const job of claim.rows) {
            try {
                await submitInvoiceToZatca(job.order_id, cfg);
                logger.info(`[zatca-poller] ✓ reported ${job.order_id}`);
            } catch (err) {
                const attempts = job.attempts;
                const maxAttempts = cfg.max_attempts || 10;
                const backoffMs = Math.min(30_000 * attempts, 10 * 60_000);
                await client.query(
                    `UPDATE pos_zatca_invoice_queue
                        SET status = CASE WHEN $2 >= $3 THEN 'dead_letter' ELSE 'failed' END::pos_zatca_status,
                            last_error = $4,
                            next_retry_at = CASE WHEN $2 < $3
                                THEN CURRENT_TIMESTAMP + (INTERVAL '1 millisecond' * $5)
                                ELSE NULL END
                      WHERE id = $1;`,
                    [job.id, attempts, maxAttempts, String(err.message || 'submit failed').slice(0, 500), backoffMs]
                );
                logger.warn(`[zatca-poller] ✗ ${job.order_id} attempt ${attempts}: ${err.message}`);
            }
        }
    } finally {
        client.release();
    }
}

let pollerStarted = false;
function startPoller() {
    if (pollerStarted) {return;}
    if (process.env.ZATCA_INPROCESS_POLLER === '0') {
        logger.info('[zatca-poller] disabled by env ZATCA_INPROCESS_POLLER=0');
        return;
    }
    pollerStarted = true;
    setInterval(() => {
        zatcaQueueTick().catch((e) => logger.error('[zatca-poller]', e.message));
    }, POLL_INTERVAL_MS).unref();
    logger.info(`[zatca-poller] in-server ZATCA poller started (every ${POLL_INTERVAL_MS}ms, processes only while enabled)`);
}

function register(app) {
    app.use('/api/zatca', router);
    // Provision the settings table at boot — the sale path and receipt reads
    // CROSS JOIN zatca_settings, so it must exist before the first invoice.
    ensureZatcaSchema().catch((e) => logger.error('[zatca-settings] boot schema failed:', e.message));
    startPoller();
    logger.info('    /api/zatca/settings          (GET/PUT — ZATCA integration hub)');
    logger.info('    POST /api/zatca/toggle|test|csr|csid|csid/manual|apply-vat');
    logger.info('    GET  /api/zatca/queue | POST /api/zatca/queue/retry');
}

module.exports = { register, ensureZatcaSchema, zatcaQueueTick, ENVIRONMENTS, validateConfigPayload, validateManualCsid, publicConfig };
