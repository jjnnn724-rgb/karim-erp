/**
 * ops-inspect-routes.js — فحوصات الإدارة التشغيلية (مُستخلص من server.js)
 * لقطة metrics + قيود المخطط (أدمن/مدير — FIX L1/L2).
 */
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { pool } = require('./shared-pool');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function register(app, opts = {}) {
    const { metrics } = opts;

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
