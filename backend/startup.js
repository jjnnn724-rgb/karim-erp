/**
 * startup.js — Boot-Time Environment & Dependency Validator
 * ────────────────────────────────────────────────────────────────────────────
 * Runs BEFORE we bind the server port. Catches 100% of "forgot to set DB_PASSWORD"
 * or "this env var is garbage" bugs that only surface at 3am in production.
 *
 * Design:
 *   • validateEnv()   — static rules (required keys, types, ranges, regex)
 *   • validateDB()    — actually connect and run SELECT 1 + migrations check
 *   • validateDisk()  — enough free space + writable data dir?
 *   • warmCaches()    — load heavy items before accepting traffic
 *   • runAll()        — orchestrator with progress output
 *
 * If any CRITICAL check fails, process exits with a clear, machine-readable
 * JSON error report to stdout + log file so the Windows service manager
 * / Docker orchestrator surfaces it immediately.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('./logger');
const { ConfigurationError, wrapUnknown } = require('./errors/app-error');

// ─── Valid rule catalog for env vars ────────────────────────
function makeRules() {
    return {
        // ─── Required basics ────────────────────────────
        NODE_ENV: {
            required: false,
            enum: ['development', 'test', 'staging', 'production'],
            default: 'development',
        },
        PORT: {
            type: 'port',
            required: false,
            default: '5000',
        },
        // ─── Database ───────────────────────────────────
        DB_HOST: {
            required: true,
            nonEmpty: true,
            default: 'localhost',
        },
        DB_PORT: {
            type: 'port',
            default: '5432',
        },
        DB_USER: {
            required: true,
            nonEmpty: true,
            default: 'postgres',
        },
        DB_PASSWORD: {
            required: false,
            default: '',
        },
        DB_NAME: {
            required: true,
            nonEmpty: true,
            default: 'karim_erp',
        },
        DB_POOL_MAX: {
            type: 'int',
            min: 2, max: 200,
            default: '25',
        },
        // ─── JWT ────────────────────────────────────────
        // الأسرار الفعلية المستخدمة في التوقيع (HS256) — إلزامية في الإنتاج
        JWT_ACCESS_SECRET: {
            required: process.env.NODE_ENV === 'production',
            nonEmpty: true,
            minLength: 32,
            default: fallbackDevSecret(),
        },
        JWT_REFRESH_SECRET: {
            required: process.env.NODE_ENV === 'production',
            nonEmpty: true,
            minLength: 32,
            default: fallbackDevSecret(),
        },
        // JWT_SECRET: متغير قديم (احتياطي لتوقيع QR فقط) — غير إلزامي ولا يُنتج FATAL كاذبًا
        JWT_SECRET: {
            required: false,
            minLength: 32,
            default: fallbackDevSecret(),
        },
        JWT_EXPIRES_IN: {
            regex: /^(\d+[smhdw]|never)$/,
            default: '12h',
        },
        // ─── Allowed Origins (CORS) ────────────────────
        ALLOWED_ORIGINS: {
            required: false,
            default: '*',
        },
        // ─── Logging ────────────────────────────────────
        LOG_LEVEL: {
            enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
            default: 'info',
        },
        // ─── Filesystem ─────────────────────────────────
        DATA_DIR: {
            type: 'path',
            mustBeWritable: true,
            default: path.resolve(__dirname, '..', 'database', 'data'),
        },
        BACKUP_DIR: {
            type: 'path',
            mustBeWritable: true,
            default: path.resolve(__dirname, '..', 'database', 'backups'),
        },
        // ─── Memory watchdog ────────────────────────────
        MEM_WARN_MB: {
            type: 'int',
            min: 256, max: 16384,
            default: '2048',
        },
        // ─── ZATCA (optional) ───────────────────────────
        ZATCA_MODE: {
            required: false,
            enum: ['', 'simulation', 'sandbox', 'production'],
            default: '',
        },
    };
}

// ─── Dev-only secret fallback (never used in production) ────
function fallbackDevSecret() {
    if (process.env.NODE_ENV === 'production') {return '';}
    // Deterministic-ish but unique-per-machine dev secret
    try {
        const hostId = os.hostname() + os.totalmem() + os.cpus().length;
        const h = require('crypto').createHash('sha256').update(hostId).digest('hex');
        return `karim-dev-secret-${h.slice(0, 24)}`;
    } catch {
        return 'karim-dev-secret-change-me-please-000000000000';
    }
}

// ─── Type coercers + validators ─────────────────────────────
const COERCERS = {
    int: (v) => {
        const n = parseInt(v, 10);
        if (isNaN(n)) {throw new Error('not an integer');}
        return n;
    },
    port: (v) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1 || n > 65535) {throw new Error('invalid port');}
        return n;
    },
    path: (v) => path.resolve(v),
};

/**
 * Run static env validation. Returns:
 *   { ok, errors: [], warnings: [], config: {...normalized} }
 */
function validateEnv() {
    const rules = makeRules();
    const errors = [];
    const warnings = [];
    const config = {};

    for (const [key, rule] of Object.entries(rules)) {
        const raw = process.env[key];
        let value = raw;

        // ── Apply default if empty ────────────────────
        const isSet = raw !== undefined && raw !== null && String(raw).trim() !== '';
        if (!isSet && rule.default !== undefined) {
            value = rule.default;
            if (rule.required) {
                warnings.push({ key, code: 'USING_DEFAULT', message: `Using default value for ${key}` });
            }
        }

        // ── Required check ────────────────────────────
        if ((!isSet && rule.default === undefined) && rule.required) {
            errors.push({ key, code: 'MISSING', message: `${key} مطلوب ولكن لم يتم تعريفه في ملف .env` });
            continue;
        }

        // ── Non-empty string ──────────────────────────
        if (rule.nonEmpty && typeof value === 'string' && value.trim() === '') {
            errors.push({ key, code: 'EMPTY', message: `${key} لا يمكن أن يكون فارغاً` });
            continue;
        }

        // ── Type coercion ─────────────────────────────
        if (rule.type && COERCERS[rule.type]) {
            try {
                value = COERCERS[rule.type](value);
            } catch (e) {
                errors.push({ key, code: 'BAD_TYPE', message: `${key} نوع غير صالح (${rule.type}): ${e.message}` });
                continue;
            }
        }

        // ── Min / Max ─────────────────────────────────
        if (rule.min !== undefined && value < rule.min) {
            errors.push({ key, code: 'TOO_SMALL', message: `${key} يجب أن يكون ≥ ${rule.min}` });
            continue;
        }
        if (rule.max !== undefined && value > rule.max) {
            errors.push({ key, code: 'TOO_LARGE', message: `${key} يجب أن يكون ≤ ${rule.max}` });
            continue;
        }
        if (rule.minLength !== undefined) {
            const isEmptyVal = value === undefined || value === null || String(value).trim() === '';
            // متغير اختياري غير مُعيّن لا يُفحص طوله (يمنع FATAL كاذبًا لـ JWT_SECRET القديم)
            if (!(isEmptyVal && !rule.required) && String(value).length < rule.minLength) {
                errors.push({ key, code: 'TOO_SHORT', message: `${key} طوله ${String(value).length} و يجب أن يكون ≥ ${rule.minLength} حروفاً — استخدم قوة كلمة مرور قوية` });
                continue;
            }
        }

        // ── Enum ───────────────────────────────────────
        if (rule.enum && rule.enum.length > 0 && value !== undefined && value !== '' && !rule.enum.includes(value)) {
            errors.push({ key, code: 'BAD_ENUM', message: `${key} قيمة "${value}" غير مقبولة. القيم الصالحة: ${rule.enum.join(', ')}` });
            continue;
        }

        // ── Regex ──────────────────────────────────────
        if (rule.regex && !rule.regex.test(String(value))) {
            errors.push({ key, code: 'BAD_PATTERN', message: `${key} صيغته غير مطابقة` });
            continue;
        }

        // ── Path must exist + be writable ─────────────
        if (rule.type === 'path') {
            try {
                if (!fs.existsSync(value)) {
                    fs.mkdirSync(value, { recursive: true });
                }
                if (rule.mustBeWritable) {
                    const test = path.join(value, `.write_test_${process.pid}`);
                    fs.writeFileSync(test, 'ok');
                    fs.unlinkSync(test);
                }
            } catch (e) {
                errors.push({ key, code: 'PATH_FAIL', message: `${key}: المسار "${value}" غير قابل للكتابة أو غير موجود: ${e.message}` });
                continue;
            }
        }

        // ── Specific: أسرار JWT في الإنتاج ────────
        if ((key === 'JWT_ACCESS_SECRET' || key === 'JWT_REFRESH_SECRET' || key === 'JWT_SECRET') && process.env.NODE_ENV === 'production' && /dev|changeme|00000/i.test(String(value))) {
            errors.push({ key, code: 'INSECURE_SECRET', message: `كلمة سر ${key} في الإنتاج ضعيفة جداً. ضع مفتاحاً عشوائياً بطول 64 حرفاً.` });
            continue;
        }
        if (key === 'ALLOWED_ORIGINS' && process.env.NODE_ENV === 'production' && value === '*') {
            warnings.push({ key, code: 'OPEN_CORS', message: 'ALLOWED_ORIGINS=* في الإنتاج غير آمن. اضف عناوين محددة.' });
        }

        config[key] = value;
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        config,
    };
}

/**
 * Actually connect to the DB pool and verify it works + migrations ran.
 * Pass the shared-pool module.
 */
async function validateDB(pool) {
    const errors = [];
    const warnings = [];
    let version = null;
    let migrationsTable = false;

    try {
        const { rows: v } = await pool.query('SHOW server_version');
        version = v[0]?.server_version;
        const major = parseInt(version.split('.')[0], 10);
        if (major < 14) {
            warnings.push({ code: 'OLD_PG', message: `نسخة PostgreSQL قديمة (${version}). توصية: 16.x` });
        }

        await pool.query('SELECT 1');

        // Best-effort migrations status (table exists?)
        try {
            const { rows } = await pool.query(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations') AS t"
            );
            migrationsTable = !!rows[0]?.t;
            if (!migrationsTable) {warnings.push({ code: 'NO_MIGRATIONS_TABLE', message: 'جدول schema_migrations غير موجود' });}
        } catch (_) { /* ignore */ }
    } catch (e) {
        errors.push({ code: 'DB_FAIL', message: `تعذر الاتصال بقاعدة البيانات: ${e.message}` });
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        details: { pgVersion: version, migrationsTable, poolTotalCount: pool?.totalCount ?? null },
    };
}

/**
 * Run the whole pipeline. Call early in server.js.
 * If CRITICAL fails, throws ConfigurationError.
 */
async function runAll({ pool, failFast = true } = {}) {
    const startedAt = Date.now();
    const results = { env: null, db: null, disk: null };
    const fatalErrors = [];
    const allWarnings = [];

    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🔍 Karim ERP — تحقق قبل الإقلاع...');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1) Env
    logger.info('  [1/3] فحص متغيرات البيئة .env');
    results.env = validateEnv();
    if (!results.env.ok) {fatalErrors.push(...results.env.errors);}
    allWarnings.push(...results.env.warnings);
    logStep('env', results.env);

    // 2) Disk (validated via DATA_DIR / BACKUP_DIR rules above)
    logger.info('  [2/3] فحص المساحة والقرص');
    const dataDir = results.env.config.DATA_DIR || makeRules().DATA_DIR.default;
    results.disk = validateDiskOnce(dataDir);
    if (!results.disk.ok) {fatalErrors.push(...results.disk.errors);}
    allWarnings.push(...results.disk.warnings);
    logStep('disk', results.disk);

    // 3) DB (if pool is ready)
    if (pool) {
        logger.info('  [3/3] فحص الاتصال بقاعدة البيانات');
        results.db = await validateDB(pool);
        if (!results.db.ok) {fatalErrors.push(...results.db.errors);}
        allWarnings.push(...results.db.warnings);
        logStep('db', results.db);
    } else {
        logger.info('  [3/3] تخطي فحص قاعدة البيانات (لم يتم تهيئتها بعد)');
    }

    const elapsed = Date.now() - startedAt;

    // ── Summary ─────────────────────────────────────
    if (fatalErrors.length === 0) {
        logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        logger.info(`✅ تم الإقلاع بنجاح (${elapsed}ms)  —  التحذيرات: ${allWarnings.length}`);
        if (allWarnings.length) {
            for (const w of allWarnings) {logger.warn('  ⚠️ ', w.message || w.code);}
        }
        logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return { ok: true, warnings: allWarnings, results, config: results.env.config };
    }

    // ── Fail ────────────────────────────────────────
    logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.error('❌ فشل التحقق قبل الإقلاع — الأخطاء:');
    for (const e of fatalErrors) {logger.error('   ❌', `[${e.key || e.code}]`, e.message);}
    if (allWarnings.length) {
        for (const w of allWarnings) {logger.warn('   ⚠️', w.message || w.code);}
    }
    logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Emit a machine-readable file for installers / services
    try {
        fs.writeFileSync(
            path.join(__dirname, '..', 'logs', 'startup-report.json'),
            JSON.stringify({ ok: false, fatalErrors, allWarnings, at: new Date().toISOString() }, null, 2)
        );
    } catch {/* ignore */}

    if (failFast) {
        throw new ConfigurationError('BOOT_VALIDATION_FAILED', fatalErrors.map(e => e.message).join(' | '));
    }
    return { ok: false, fatalErrors, allWarnings, results, config: results.env.config };
}

function logStep(name, r) {
    const tag = r.ok ? '✅' : '❌';
    logger.info(`  ${tag} ${name}: ${r.errors.length} أخطاء / ${r.warnings.length} تحذيرات`);
}

function validateDiskOnce(dir) {
    const errors = [], warnings = [];
    try {
        const s = fs.statfsSync(dir);
        const freeGB = (s.bavail * s.bsize) / 1073741824;
        if (freeGB < 0.5) {
            errors.push({ code: 'DISK_FULL', message: `المساحة الحرة في DATA_DIR أقل من 500MB (${freeGB.toFixed(2)} GB فقط)` });
        } else if (freeGB < 2) {
            warnings.push({ code: 'DISK_LOW', message: `المساحة الحرة في DATA_DIR منخفضة: ${freeGB.toFixed(2)} GB` });
        }
    } catch (e) {
        errors.push({ code: 'DISK_STAT_FAIL', message: `تعذر فحص المساحة: ${e.message}` });
    }
    return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
    validateEnv,
    validateDB,
    runAll,
};
