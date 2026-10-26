/**
 * ops-inspect-routes.js — فحوصات الإدارة التشغيلية (مُستخلص من server.js)
 * خزنة كلمة المرور (أدمن) + لقطة metrics + قيود المخطط (أدمن فقط — FIX L1/L2).
 */
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const { decryptFromVault } = require('./password-vault');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function register(app, opts = {}) {
    const { metrics } = opts;

    // خزنة كلمات المرور: عرض نسخة كلمة المرور المسجلة — للأدمن حصريًا (قرار المالك
    // لمساعدة الموظف النسي كلمته). بلا نسخة محفوظة ترجع available:false بدل فشل.
    app.get('/api/users/:id/password', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {return res.status(422).json({ error: 'USER_ID_INVALID', message: 'معرف المستخدم غير صالح' });}
        try {
            const r = await pool.query('SELECT password_vault, username FROM users WHERE id = $1', [id]);
            if (!r.rows[0]) {return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'المستخدم غير موجود' });}
            // FIX 2026-10-11 (L1): audit log for password vault access — sensitive
            // operation that reveals plaintext passwords.
            logger.info({ event: 'security', securityEvent: 'password_vault_view', targetUserId: id, targetUsername: r.rows[0].username, actorUserId: req.user?.id, actorUsername: req.user?.username }, '[SECURITY] Password vault accessed');
            res.set('Cache-Control', 'no-store');
            const plain = decryptFromVault(r.rows[0].password_vault);
            if (!plain) {return res.json({ ok: true, available: false, message: 'لا توجد نسخة محفوظة لهذا الحساب — أعد تعيين كلمة المرور من «تعديل الحساب» وستُسجَّل' });}
            res.json({ ok: true, available: true, password: plain });
        } catch (e) {
            logger.error('[pw-vault] view failed:', e.message);
            res.status(500).json({ error: 'VAULT_VIEW_FAILED', message: 'تعذر جلب كلمة المرور' });
        }
    }));

    // Runtime metrics (enterprise observability) — للمالك/المدير فقط.
    app.get('/api/metrics', jwtAuth, requireRole('admin', 'manager'), (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(metrics.snapshot(pool));
    });

    // DB Constraints API (for client-side validation)
    // FIX 2026-10-11 (L2): admin-only — كان مفتوحًا لأي مستخدم مُصادَق عليه
    // ويكشف كامل مخطط قاعدة البيانات (جداول/أنواع/cلاقات FK).
    app.get('/api/schema/constraints', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
        const { loadConstraints } = require('./db-constraints');
        const constraints = await loadConstraints();

        // تبسيط الاستجابة للعميل
        const simplified = {};
        for (const [tableName, table] of Object.entries(constraints)) {
            simplified[tableName] = {
                columns: {},
                uniqueConstraints: table.constraints.filter(c => c.type === 'u').map(c => ({
                    name: c.name,
                    columns: c.def.match(/UNIQUE\s*\(([^)]+)\)/i)?.[1]?.split(',').map(s => s.trim().replace(/"/g, '')) || [],
                })),
                foreignKeys: table.constraints.filter(c => c.type === 'f').map(c => {
                    const match = c.def.match(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+)\s*\(([^)]+)\)/i);
                    return match ? {
                        name: c.name,
                        columns: match[1].split(',').map(s => s.trim().replace(/"/g, '')),
                        refTable: match[2],
                        refColumns: match[3].split(',').map(s => s.trim().replace(/"/g, '')),
                    } : null;
                }).filter(Boolean),
                checkConstraints: table.constraints.filter(c => c.type === 'c').map(c => ({
                    name: c.name,
                    def: c.def,
                })),
            };

            for (const [colName, col] of Object.entries(table.columns)) {
                simplified[tableName].columns[colName] = {
                    type: col.type,
                    nullable: col.nullable,
                    default: col.default,
                    maxLength: col.maxLength,
                    precision: col.precision,
                    scale: col.scale,
                };
            }
        }

        res.json(simplified);
    }));
}

module.exports = { register };
