/**
 * audit-engine/checks/database.js — فحوصات قاعدة البيانات (PostgreSQL)
 * ────────────────────────────────────────────────────────────────────────────
 * النظام يتتبّع الترحيلات عبر ملف قفل (database/data/.migrations_applied) لا جدول DB.
 * لذلك فحص "الانحراف" يقارن الملفات القابلة للتطبيق مقابل القفل، ويتحقق من وجود
 * كائنات كل ترحيل فعليًا في القاعدة قبل تعليمه كمُطبَّق (إصلاح آمن idempotent).
 */
'use strict';

const fs = require('fs');
const path = require('path');

async function q(ctx, sql, params) {
    if (!ctx.pool) {throw new Error('لا يوجد اتصال بقاعدة البيانات (pool)');}
    const r = await ctx.pool.query(sql, params || []);
    return r.rows;
}

function lockPath(ctx) {
    return path.join(ctx.root, 'database', 'data', '.migrations_applied');
}

function readLock(ctx) {
    const f = lockPath(ctx);
    if (!fs.existsSync(f)) {return { exists: false, applied: [] };}
    try { return { exists: true, applied: JSON.parse(fs.readFileSync(f, 'utf8')) }; }
    catch (_) { return { exists: true, applied: null }; }
}

function listMigrations(ctx) {
    const dir = ctx.paths.migrationsDir;
    try { return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort(); }
    catch (_) { return []; }
}

/** أسماء الجداول التي ينشئها ملف ترحيل (CREATE TABLE [IF NOT EXISTS] x) */
function createdTables(ctx, file) {
    try {
        const src = fs.readFileSync(path.join(ctx.paths.migrationsDir, file), 'utf8');
        const out = [];
        const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w.]*)/gi;
        let m;
        while ((m = re.exec(src))) {out.push(m[1].replace(/^public\./i, '').toLowerCase());}
        return out;
    } catch (_) { return []; }
}

// مطابقة منطق scripts/shared.js دون استيراده (يتجنب تحميل dotenvx وطباعة شعاره)
const DEMO_MIGRATIONS = new Set(['006_demo_seed.sql']);
function isDemoMode(ctx) {
    const v = String(ctx.envValue('KARIM_MIGRATION_MODE') || ctx.envValue('HORUS_MIGRATION_MODE') || '').toLowerCase();
    return v === 'demo';
}
function shouldApply(ctx, f) { return isDemoMode(ctx) || !DEMO_MIGRATIONS.has(path.basename(String(f || ''))); }

module.exports = [
    {
        id: 'db.connectivity',
        domain: 'database',
        title: 'الاتصال بقاعدة البيانات',
        description: 'التأكد من قدرة الخادم على تنفيذ استعلام حي (SELECT 1) على PostgreSQL.',
        severity: 'CRITICAL',
        detect: async (ctx) => {
            try {
                const t0 = Date.now();
                await q(ctx, 'SELECT 1 AS ok');
                return { status: 'pass', detail: `الاتصال سليم (${Date.now() - t0}ms)` };
            } catch (e) {
                return { status: 'fail', severity: 'CRITICAL', detail: 'تعذّر الاتصال بالقاعدة: ' + String(e.message).slice(0, 160), remediation: 'تحقق من خدمة PostgreSQL ومن DB_HOST/DB_PORT/DB_USER/DB_PASSWORD في .env' };
            }
        },
    },

    {
        id: 'db.migrations_lock',
        domain: 'database',
        title: 'سلامة قفل الترحيلات وعدم وجود انحراف',
        description: 'ملف القفل يجب أن يكون JSON صالحًا وأن يعكس كل الترحيلات القابلة للتطبيق المطبَّقة فعلًا في القاعدة.',
        severity: 'MEDIUM',
        detect: async (ctx) => {
            const lock = readLock(ctx);
            if (!lock.exists) {
                return { status: 'fail', severity: 'HIGH', detail: 'ملف قفل الترحيلات مفقود — قد يُعاد تطبيق ترحيلات', evidence: { path: lockPath(ctx) }, remediation: 'أنشئ القفل وعلّم الترحيلات المطبَّقة فعليًا' };
            }
            if (!Array.isArray(lock.applied)) {
                return { status: 'fail', severity: 'HIGH', detail: 'ملف القفل تالف (ليس JSON/مصفوفة)', remediation: 'أعد بناء القفل من حالة القاعدة الفعلية' };
            }
            const all = listMigrations(ctx);
            const applied = new Set(lock.applied);
            // الترحيلات المعلّمة كمطبَّقة لكن ملفها لم يعد موجودًا (انحراف عكسي)
            const ghost = lock.applied.filter((f) => !all.includes(f));
            // القابلة للتطبيق وغير المعلَّمة (تجاهل ملفات الديمو)
            const pendingApplicable = all.filter((f) => !applied.has(f) && shouldApply(ctx, f));
            if (!pendingApplicable.length && !ghost.length) {
                return { status: 'pass', detail: `القفل سليم — ${applied.size} ترحيلًا مُعلَّمًا ولا انحراف` };
            }
            return {
                status: 'warn', severity: 'MEDIUM',
                detail: `انحراف في القفل: ${pendingApplicable.length} ترحيلًا قابلًا للتطبيق غير مُعلَّم${ghost.length ? `، و${ghost.length} مُعلَّم بلا ملف` : ''} (${pendingApplicable.slice(0, 6).join(', ')})`,
                evidence: { pendingApplicable, ghost },
                remediation: 'علّم الترحيلات التي كائناتها موجودة فعلًا في القاعدة داخل ملف القفل (بعد نسخة احتياطية)',
            };
        },
        remediate: async (ctx) => {
            const lock = readLock(ctx);
            const all = listMigrations(ctx);
            const applied = Array.isArray(lock.applied) ? lock.applied.slice() : [];
            const appliedSet = new Set(applied);
            const pending = all.filter((f) => !appliedSet.has(f) && shouldApply(ctx, f));

            // نعلّم فقط الترحيلات التي كل جداولها المنشأة موجودة فعلًا في القاعدة (تحقق آمن)
            const verified = [];
            for (const f of pending) {
                const tables = createdTables(ctx, f);
                if (!tables.length) {continue;} // لا جداول (تغييرات أعمدة/فهارس) — لا نُعلّمه تلقائيًا
                let allExist = true;
                for (const t of tables) {
                    try {
                        const rows = await q(ctx, 'SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2 LIMIT 1', ['public', t]);
                        if (!rows.length) {allExist = false; break;}
                    } catch (_) { allExist = false; break; }
                }
                if (allExist) {verified.push(f);}
            }
            if (!verified.length) {
                return { ok: false, message: `لا ترحيلات يمكن تعليمها بأمان — ${pending.length} بانتظار التطبيق اليدوي (node database/scripts/run-migration.js)` };
            }
            // نسخة احتياطية للقفل ثم الكتابة
            ctx.backupFile(lockPath(ctx), 'audit');
            for (const f of verified) { if (!appliedSet.has(f)) {applied.push(f); appliedSet.add(f);} }
            fs.mkdirSync(path.dirname(lockPath(ctx)), { recursive: true });
            fs.writeFileSync(lockPath(ctx), JSON.stringify(applied, null, 2), 'utf8');
            return { ok: true, message: `تم تعليم ${verified.length} ترحيلًا مُتحقَّقًا من وجود كائناته (${verified.join(', ')})`, changed: true };
        },
    },

    {
        id: 'db.critical_tables',
        domain: 'database',
        title: 'وجود الجداول الجوهرية',
        description: 'التحقق من وجود الجداول الأساسية التي يقوم عليها النظام (مستخدمون/نقاط بيع/موارد بشرية/واتساب).',
        severity: 'HIGH',
        detect: async (ctx) => {
            const required = ['users', 'pos_departments', 'hrDepartments', 'wa_chat_meta'];
            try {
                const rows = await q(ctx, "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)", [required]);
                const have = new Set(rows.map((r) => r.table_name));
                const missing = required.filter((t) => !have.has(t));
                if (!missing.length) {return { status: 'pass', detail: `كل الجداول الجوهرية موجودة (${required.length})` };}
                return { status: 'fail', severity: 'HIGH', detail: 'جداول جوهرية مفقودة: ' + missing.join(', '), evidence: { missing }, remediation: 'شغّل الترحيلات: node database/scripts/run-migration.js' };
            } catch (e) {
                return { status: 'error', detail: 'تعذّر فحص الجداول: ' + String(e.message).slice(0, 140) };
            }
        },
    },

    {
        id: 'db.idle_in_transaction',
        domain: 'database',
        title: 'جلسات idle in transaction المعلّقة',
        description: 'الجلسات الخاملة داخل معاملة لأكثر من 5 دقائق تحبس الأقفال وقد تُسقط الأداء.',
        severity: 'MEDIUM',
        detect: async (ctx) => {
            try {
                const rows = await q(ctx, "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state='idle in transaction' AND state_change < NOW() - INTERVAL '5 minutes'");
                const n = rows[0]?.n || 0;
                if (n === 0) {return { status: 'pass', detail: 'لا جلسات خاملة داخل معاملات' };}
                return { status: 'warn', severity: 'MEDIUM', detail: `${n} جلسة idle-in-transaction لأكثر من 5 دقائق`, evidence: { count: n }, remediation: 'افحص الاتصالات غير المُغلقة؛ consider idle_in_transaction_session_timeout' };
            } catch (_) {
                return { status: 'info', detail: 'تعذّر قراءة pg_stat_activity (صلاحيات)' };
            }
        },
    },

    {
        id: 'db.pg_version',
        domain: 'database',
        title: 'إصدار خادم PostgreSQL',
        description: 'تسجيل إصدار الخادم للتوافق والدعم.',
        severity: 'INFO',
        detect: async (ctx) => {
            try {
                const rows = await q(ctx, 'SHOW server_version');
                const v = rows[0]?.server_version || '?';
                const major = parseInt(String(v).split('.')[0], 10) || 0;
                if (major && major < 13) {return { status: 'warn', severity: 'LOW', detail: `إصدار قديم (${v}) — يُنصح بـ 13+` };}
                return { status: 'info', detail: `PostgreSQL ${v}` };
            } catch (_) {
                return { status: 'info', detail: 'تعذّر قراءة الإصدار' };
            }
        },
    },
];
