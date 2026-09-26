/**
 * services/ServiceBase.js — Service Layer Pattern (Enterprise)
 * ────────────────────────────────────────────────────────────────────────────
 * Every business operation lives in a Service (never in Routes).
 * Routes should ONLY:
 *   • parse + validate input (Zod / schema-registry)
 *   • call ONE service method
 *   • transform the result to HTTP
 *
 * Services:
 *   • Accept plain data (never Express req/res)
 *   • Return plain data / throw AppError subclasses
 *   • Are unit-testable without a server
 *   • Use transactions automatically (this.tx())
 *   • Inherit structured logging with their class name as context
 *   • Have automatic perf timers, audit logs, and trace correlation
 *
 * Example:
 *   class OrderService extends ServiceBase {
 *     constructor() { super('orders'); }
 *     async createOrder(userId, cart) {
 *       return this.tx(async (client) => {
 *         const { rows } = await client.query('INSERT INTO orders ... RETURNING *', [...]);
 *         return rows[0];
 *       });
 *     }
 *   }
 */

'use strict';

const { logger, auditLog, createTimer, logError } = require('../logger');
const { getContext, currentTraceFields, sqlComment } = require('../middleware/correlation');
const { DatabaseError, wrapUnknown, ValidationError, ConflictError } = require('../errors/app-error');
const { safeQuery } = require('../shared-pool');

/**
 * Get the shared DB pool lazily (avoids circular requires).
 */
function getPool() {
    return require('../shared-pool').pool;
}

class ServiceBase {
    /**
     * @param {string} serviceName   Logical name (appears in logs / audit trail)
     */
    constructor(serviceName) {
        this.serviceName = serviceName || this.constructor.name;
        this.log = logger.child({ service: this.serviceName });
    }

    // ══════════════════════════════════════════════════════
    // DATABASE HELPERS
    // ══════════════════════════════════════════════════════

    /**
     * Execute a query via the shared pool, with retry on transient errors,
     * correlation SQL comment, and automatic DatabaseError wrapping.
     */
    async query(label, text, params = []) {
        const pool = getPool();
        const safeLabel = label || this.serviceName;
        const comment = sqlComment(safeLabel);
        const timer = createTimer(`${this.serviceName}.${safeLabel}`, this.log);

        try {
            const result = await safeQuery(comment + text, params);
            timer.end({ rows: result.rowCount });
            return result;
        } catch (raw) {
            timer.end({ error: true, message: raw?.message });
            throw this._normalizeDBError(raw, safeLabel, text);
        }
    }

    /**
     * Query with first-row convenience.
     */
    async queryOne(label, text, params = []) {
        const r = await this.query(label, text, params);
        return r?.rows?.[0] || null;
    }

    /**
     * Run a sequence of queries inside a single Postgres transaction.
     *
     *   return this.tx(async (client) => {
     *     await client.query('INSERT...');
     *     await client.query('UPDATE...');
     *   });
     *
     * On throw — ROLLBACK. Otherwise — COMMIT.
     */
    async tx(fn, opts = {}) {
        const pool = getPool();
        const client = await pool.connect();
        const label = opts.label || `${this.serviceName}.tx`;
        const timer = createTimer(label, this.log);
        const trace = getContext();

        try {
            await client.query('BEGIN');
            const result = await fn(client, { trace, log: this.log });
            await client.query('COMMIT');
            timer.end({ committed: true });
            this.log.debug({ ...currentTraceFields(), event: 'tx.commit', label });
            return result;
        } catch (raw) {
            try { await client.query('ROLLBACK'); } catch (e) { this.log.warn('ROLLBACK failed:', e.message); }
            timer.end({ rolledBack: true, error: raw?.message });
            this.log.warn({ ...currentTraceFields(), event: 'tx.rollback', label, message: raw?.message });
            throw this._normalizeDBError(raw, label, 'BEGIN/COMMIT block');
        } finally {
            client.release();
        }
    }

    /**
     * Wrap an arbitrary block with:
     *   • timer + log on entry / exit
     *   • unknown error normalization → AppError
     *   • audit log when requested
     */
    async perform(opName, fn, { audit, actorId, meta } = {}) {
        const fullName = `${this.serviceName}.${opName}`;
        const timer = createTimer(fullName, this.log);
        const traceFields = currentTraceFields();
        this.log.debug({ ...traceFields, event: 'service.call', op: opName });

        try {
            const result = await fn(traceFields);
            const durationMs = timer.end({ ok: true });
            if (audit) {
                auditLog(`${fullName}.${audit.action || 'done'}`, {
                    actorId: actorId || traceFields.userId,
                    durationMs,
                    meta:    meta || null,
                });
            }
            return result;
        } catch (raw) {
            const err = wrapUnknown(raw, fullName);
            timer.end({ error: true, message: err.message });
            logError(err, { service: this.serviceName, op: opName, ...traceFields }, this.log);
            throw err;
        }
    }

    /**
     * Standardized CRUD helpers (override or compose as needed).
     */
    async findById(table, id) {
        return this.queryOne(
            `find.${table}.byId`,
            `SELECT * FROM ${this._ident(table)} WHERE id = $1 LIMIT 1`,
            [id]
        );
    }

    async list(table, { limit = 50, offset = 0, orderBy = 'id', order = 'DESC', where = '', params = [] } = {}) {
        const safeOrderBy = this._identPart(orderBy);
        const safeOrder   = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const q = `
            SELECT * FROM ${this._ident(table)}
            ${where ? 'WHERE ' + where : ''}
            ORDER BY ${safeOrderBy} ${safeOrder}
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;
        return this.query(`list.${table}`, q, [...params, limit, offset]);
    }

    async create(table, data) {
        const entries = Object.entries(data);
        if (entries.length === 0) throw new ValidationError(table, 'لا توجد حقول للإدراج');
        const columns = entries.map(([k]) => this._identPart(k)).join(', ');
        const placeholders = entries.map((_, i) => `$${i + 1}`).join(', ');
        const values = entries.map(([, v]) => v);
        const q = `INSERT INTO ${this._ident(table)} (${columns}) VALUES (${placeholders}) RETURNING *`;
        try {
            return await this.queryOne(`create.${table}`, q, values);
        } catch (raw) {
            if (raw?.code === '23505') {
                throw new ConflictError(table, 'سجل بهذه البيانات موجود مسبقاً', { constraint: raw.constraint });
            }
            throw raw;
        }
    }

    async update(table, id, data) {
        const entries = Object.entries(data);
        if (entries.length === 0) return this.findById(table, id);
        const sets = entries.map(([k], i) => `${this._identPart(k)} = $${i + 2}`).join(', ');
        const values = [id, ...entries.map(([, v]) => v)];
        const q = `UPDATE ${this._ident(table)} SET ${sets} WHERE id = $1 RETURNING *`;
        return this.queryOne(`update.${table}`, q, values);
    }

    async del(table, id) {
        const q = `DELETE FROM ${this._ident(table)} WHERE id = $1 RETURNING id`;
        const r = await this.queryOne(`delete.${table}`, q, [id]);
        return !!r;
    }

    // ══════════════════════════════════════════════════════
    // INTERNALS
    // ══════════════════════════════════════════════════════

    _normalizeDBError(raw, label, snippet) {
        if (raw && raw.code === '23505') {
            return new ConflictError(label || this.serviceName, 'تعارض — قيمة مكررة في حقول فريدة', {
                constraint: raw.constraint, detail: raw.detail,
            });
        }
        if (raw && raw.code === '23503') {
            return new ValidationError(label || this.serviceName, `لا يمكن تنفيذ الإجراء بسبب سجلات مرتبطة (${raw.constraint || ''})`, { constraint: raw.constraint });
        }
        if (raw && raw.code === '23514') {
            return new ValidationError(label || this.serviceName, 'فشل شرط صحة البيانات في قاعدة البيانات (CHECK)', { constraint: raw.constraint });
        }
        return new DatabaseError(label, raw, { snippet: snippet ? snippet.slice(0, 200) : null });
    }

    /**
     * Safe identifier quoting: only allow [A-Za-z_][A-Za-z0-9_$.*].
     * Prevents SQL-injection-via-table-name in dynamic helpers.
     */
    _ident(name) {
        if (typeof name !== 'string' || !/^[A-Za-z_][\w$.]*$/.test(name)) {
            throw new ValidationError('table_name', 'اسم جدول غير صالح');
        }
        return `"${name}"`;
    }
    _identPart(name) {
        if (typeof name !== 'string' || !/^[A-Za-z_][\w$]*$/.test(name)) {
            throw new ValidationError('column_name', 'اسم حقل غير صالح');
        }
        return `"${name}"`;
    }
}

module.exports = { ServiceBase };
