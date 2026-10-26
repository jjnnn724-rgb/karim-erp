/**
 * audit-engine/context.js — بناء سياق الفحص المشترك لكل الفحوصات
 * ────────────────────────────────────────────────────────────────────────────
 * يوفّر: env (من .env + process.env)، pool (قاعدة البيانات)، paths، httpBase،
 *         أدوات نسخ احتياطي آمنة قبل أي إصلاح مُعدِّل، وlogger.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

/** تحليل ملف .env إلى كائن (بدون تحميله في process.env) */
function parseEnvFile(file) {
    const out = {};
    try {
        const raw = fs.readFileSync(file, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
            if (!m) {continue;}
            let v = m[2];
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {v = v.slice(1, -1);}
            out[m[1]] = v;
        }
    } catch (_) {}
    return out;
}

/** قيمة متغير بيئة: process.env أولًا ثم .env */
function envValue(env, key) {
    const p = process.env[key];
    if (p !== undefined && p !== '') {return p;}
    return env[key];
}

function isSet(v) { return typeof v === 'string' && v.trim() !== ''; }

/** توليد سرّ عشوائي قوي (hex) */
function generateSecret(bytes = 48) {
    return crypto.randomBytes(bytes).toString('hex');
}

/** قراءة/كتابة .env مع نسخة احتياطية قبل التعديل */
function backupFile(file, tag = 'audit') {
    try {
        if (!fs.existsSync(file)) {return null;}
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const dest = `${file}.${tag}-backup-${ts}`;
        fs.copyFileSync(file, dest);
        return dest;
    } catch (_) { return null; }
}

/** ضبط/استبدال مفتاح في .env (يضيفه إن غاب) مع إرجاع نص النسخة الجديدة */
function upsertEnvKey(file, key, value) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { raw = ''; }
    const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
    let next;
    if (re.test(raw)) { next = raw.replace(re, `${key}=${value}`); }
    else { next = (raw.endsWith('\n') || raw === '' ? raw : raw + '\n') + `${key}=${value}\n`; }
    fs.writeFileSync(file, next, 'utf8');
    return next;
}

/** نسخة احتياطية لقاعدة البيانات عبر pg_dump (best-effort) */
function pgDumpBackup(ctx, label = 'audit') {
    try {
        const env = ctx.env;
        const dir = ctx.paths.backupDir;
        fs.mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const file = path.join(dir, `pre-${label}-${ts}.sql`);
        const candidates = [
            process.env.PG_BIN && path.join(process.env.PG_BIN, 'pg_dump'),
            'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe',
            'C:/Program Files/PostgreSQL/17/bin/pg_dump.exe',
            'C:/Program Files/PostgreSQL/16/bin/pg_dump.exe',
            'pg_dump',
        ].filter(Boolean);
        let lastErr = null;
        for (const bin of candidates) {
            try {
                execFileSync(bin, [
                    '-h', envValue(env, 'DB_HOST') || '127.0.0.1',
                    '-p', String(envValue(env, 'DB_PORT') || '5432'),
                    '-U', envValue(env, 'DB_USER') || 'postgres',
                    '-d', envValue(env, 'DB_NAME') || 'karim_erp',
                    '-f', file,
                ], {
                    env: Object.assign({}, process.env, { PGPASSWORD: envValue(env, 'DB_PASSWORD') || '' }),
                    stdio: 'ignore', timeout: 120000, windowsHide: true,
                });
                if (fs.existsSync(file) && fs.statSync(file).size > 0) {return file;}
            } catch (e) { lastErr = e; }
        }
        if (lastErr) {ctx.logger && ctx.logger.warn && ctx.logger.warn('[AUDIT] pg_dump backup failed: ' + String(lastErr.message).slice(0, 120));}
        return null;
    } catch (_) { return null; }
}

/** مسار HTTP الأساسي للخادم المحلي (للفحوصات الحية الاختيارية) */
function httpBase(env) {
    const port = envValue(env, 'PORT') || '5001';
    const hasCert = isSet(envValue(env, 'SSL_CERT')) && isSet(envValue(env, 'SSL_KEY'));
    return `${hasCert ? 'https' : 'http'}://127.0.0.1:${port}`;
}

/** بناء السياق الكامل */
function buildContext(opts = {}) {
    const root = opts.root || path.resolve(__dirname, '..', '..');
    const envFile = path.join(root, '.env');
    const env = parseEnvFile(envFile);

    let pool = opts.pool || null;
    let logger = opts.logger || console;
    if (!pool) {
        try { pool = require('../shared-pool').pool; } catch (_) { pool = null; }
    }
    try { logger = require('../logger').logger; } catch (_) { /* keep fallback */ }

    const dataDir = envValue(env, 'DATA_DIR') || 'C:/HorusData';
    const paths = {
        root,
        envFile,
        envExample: path.join(root, '.env.example'),
        migrationsDir: path.join(root, 'database', 'migrations'),
        backupDir: opts.backupDir || path.join(root, 'logs', 'audit', 'backups'),
        reportDir: opts.reportDir || path.join(root, 'logs', 'audit'),
        dataDir,
        whatsappSessionDir: envValue(env, 'WHATSAPP_SESSION_DIR') || path.join(dataDir, 'whatsapp-sessions'),
        whatsappBackupDir: envValue(env, 'WHATSAPP_BACKUP_DIR') || 'C:/KarimData/whatsapp-backups',
    };

    return {
        root, env, envFile, paths, pool, logger,
        httpBase: httpBase(env),
        envValue: (k) => envValue(env, k),
        isSet: (k) => isSet(envValue(env, k)),
        generateSecret,
        backupFile, upsertEnvKey, pgDumpBackup,
        now: () => new Date().toISOString(),
    };
}

module.exports = { buildContext, parseEnvFile, envValue, isSet, generateSecret, backupFile, upsertEnvKey, pgDumpBackup };
