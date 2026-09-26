/**
 * yarasoft/oracle-link.js — ربط مباشر بقاعدة Yarasoft (Oracle) للسحب الحي
 * ────────────────────────────────────────────────────────────────────────────
 * الاكتشاف الحي أثبت: Oracle Listener على 192.168.1.188:1521 بخدمة ORACLE
 * (إصدار قديم < 12c — يحتاج Thick mode + Instant Client 12.2 عند التشغيل).
 *
 *owied قواعد صارمة:
 *  - كل الإعدادات من البيئة فقط (.env) — لا بيانات اعتماد في الكود إطلاقًا.
 *  - كلمة المرور لا تُسجَّل ولا تُرجَع في أي API أبدًا (تعقيم الأخطاء).
 *  - معطّل افتراضيًا (YARASOFT_ORACLE_ENABLED=false) — آمن تمامًا قبل الإعداد.
 *  - القراءة فقط من Oracle — الكتابة الوحيدة ملفات staging محلية يستهلكها
 *    خط الملفات المُختبَر (نفس idempotency والمراجعة والربط).
 *  - يعمل بدون مكتبة oracledb (حالة driver:false) ولا يكسر الإقلاع.
 *
 * مراحل التشغيل:
 *  1) فحص الاتصال: POST /api/yarasoft/oracle/test
 *  2) اكتشاف الجداول: GET /api/yarasoft/oracle/tables (لضبط SQL السحب)
 *  3) ضبط YARASOFT_ORACLE_INVOICE_SQL ثم تفعيل المحرك (staging تلقائي)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../logger');

function boolEnv(name, def) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {return def;}
    return ['1', 'true', 'yes', 'on', 'y'].includes(String(raw).trim().toLowerCase());
}

function loadOracleConfig() {
    return Object.freeze({
        enabled: boolEnv('YARASOFT_ORACLE_ENABLED', false),
        host: (process.env.YARASOFT_ORACLE_HOST || '192.168.1.188').trim(),
        port: Math.max(1, Math.min(65535, Number(process.env.YARASOFT_ORACLE_PORT) || 1521)),
        service: (process.env.YARASOFT_ORACLE_SERVICE || 'ORACLE').trim(),
        user: (process.env.YARASOFT_ORACLE_USER || '').trim(),
        // كلمة المرور تُقرأ عند الاتصال فقط ولا تُخزَّن في الكائن المجمّد
        icPath: (process.env.YARASOFT_ORACLE_IC_PATH || '').trim(),
        pollMinutes: Math.max(1, Math.min(1440, Number(process.env.YARASOFT_ORACLE_POLL_MIN) || 15)),
        stagingDir: (process.env.YARASOFT_ORACLE_STAGING || '').trim(),
        invoiceSql: (process.env.YARASOFT_ORACLE_INVOICE_SQL || '').trim(),
    });
}

/** إزالة أي أثر لكلمة المرور من رسائل الخطأ قبل التسجيل/الإرجاع */
function sanitizeError(msg) {
    let s = String(msg || '');
    s = s.replace(/password[^,;}]*?(,|;|})/gi, 'password=***$1');
    s = s.replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"***"');
    return s.slice(0, 400);
}

// ─── حارس القراءة فقط على قاعدة يارا سوفت (أمر مالك النظام) ───
// أي SQL لا يبدأ بـ SELECT أو WITH يُرفض قبل الوصول للشبكة.
// تُستخدم عبر oraExecute() بدل conn.execute() المباشر في كل ملفات yarasoft/.
function assertOracleReadOnly(sql) {
    const s = String(sql == null ? '' : sql).trim().replace(/^\(+/, '');
    if (!/^(SELECT|WITH)\b/i.test(s)) {
        throw new Error('ORACLE_READ_ONLY: مسموح بـ SELECT فقط على قاعدة يارا سوفت — رُفضت جملة من نوع آخر');
    }
    // منع تكديس جمل متعددة بفاصلة منقوطة
    const body = s.replace(/'([^']|'')*'/g, "''");
    if (/;\s*\S/.test(body)) {
        throw new Error('ORACLE_READ_ONLY: جملة واحدة فقط لكل تنفيذ');
    }
}

async function oraExecute(conn, sql, binds, opts) {
    assertOracleReadOnly(sql);
    // لا تمرير undefined صريح — oracledb يرفضه (NJS-005)
    if (binds === undefined) {return conn.execute(sql);}
    if (opts === undefined) {return conn.execute(sql, binds);}
    return conn.execute(sql, binds, opts);
}

function buildConnectString(cfg) {
    return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${cfg.host})(PORT=${cfg.port}))(CONNECT_DATA=(SERVICE_NAME=${cfg.service})))`;
}

let driverStatus = { tried: false, available: false, thick: false, reason: '' };

function getDriver() {
    if (driverStatus.tried) {
        if (!driverStatus.available) {throw new Error(driverStatus.reason || 'ORACLE_DRIVER_MISSING');}
        return driverStatus.mod;
    }
    driverStatus.tried = true;
    let mod;
    try {
        // eslint-disable-next-line import/no-dynamic-require
        mod = require('oracledb');
    } catch (e) {
        driverStatus = { tried: true, available: false, thick: false, reason: 'مكتبة oracledb غير مثبتة — نفّذ: npm install oracledb' };
        throw new Error(driverStatus.reason);
    }
    const cfg = loadOracleConfig();
    if (cfg.icPath && fs.existsSync(cfg.icPath)) {
        try {
            // قاعدة يارا بترميز AR8MSWIN1256 — بدونه العربي يظهر ����
            if (!process.env.NLS_LANG) {process.env.NLS_LANG = 'AMERICAN_AMERICA.AR8MSWIN1256';}
            mod.initOracleClient({ libDir: cfg.icPath });
            driverStatus = { tried: true, available: true, thick: true, mod, reason: '' };
        } catch (e) {
            driverStatus = { tried: true, available: false, thick: false, mod: null, reason: 'تعذر تهيئة Thick mode: ' + sanitizeError(e.message) };
            throw new Error(driverStatus.reason);
        }
    } else {
        driverStatus = { tried: true, available: true, thick: false, mod, reason: '' };
    }
    return mod;
}

async function connectOnce(timeoutSec = 8) {
    const cfg = loadOracleConfig();
    if (!cfg.user) {throw new Error('YARASOFT_ORACLE_USER غير مضبوط في .env');}
    const password = process.env.YARASOFT_ORACLE_PASSWORD || '';
    if (!password) {throw new Error('YARASOFT_ORACLE_PASSWORD غير مضبوط في .env');}
    const oracledb = getDriver();
    const conn = await oracledb.getConnection({
        user: cfg.user,
        password,
        connectString: buildConnectString(cfg),
        connectTimeout: timeoutSec,
    });
    return conn;
}

/** فحص الاتصال — قراءة فقط (banner) ثم إغلاق فوري */
async function testConnection() {
    const cfg = loadOracleConfig();
    const started = Date.now();
    let conn = null;
    try {
        conn = await connectOnce(8);
        let version = '';
        try {
            const r = await oraExecute(conn, `SELECT banner FROM v$version WHERE rownum = 1`);
            version = r.rows && r.rows[0] ? String(r.rows[0][0]).slice(0, 120) : '';
        } catch (_) { version = ''; }
        return { ok: true, ms: Date.now() - started, version, thick: driverStatus.thick, host: cfg.host, port: cfg.port, service: cfg.service, user: cfg.user };
    } catch (e) {
        const raw = String(e.message || e);
        const hint = raw.includes('NJS-138')
            ? 'قاعدة قديمة (< 12c) — ثبّت Instant Client 12.2 واضبط YARASOFT_ORACLE_IC_PATH ثم أعد الفحص'
            : raw.includes('NJS-518') ? 'اسم الخدمة غير مسجل — راجع YARASOFT_ORACLE_SERVICE'
            : raw.includes('ORA-01017') ? 'اسم المستخدم أو كلمة المرور مرفوضة من القاعدة'
            : raw.includes('ORA-12541') || raw.includes('NJS-5') ? 'لا وصول للخادم/المنفذ — تحقق أن جهاز اليارسوفت يعمل'
            : '';
        return { ok: false, ms: Date.now() - started, error: sanitizeError(raw), hint, host: cfg.host, port: cfg.port, service: cfg.service, user: cfg.user };
    } finally {
        try { if (conn) {await conn.close();} } catch (_) {}
    }
}

/** سحب دليل الأصناف كاملًا (ITM_NO/الاسم/الباركود/الوحدة/التكلفة) */
async function pullItems() {
    let conn = null;
    try {
        conn = await connectOnce(30);
        const r = await oraExecute(conn,
            `SELECT ITM_NO, ITMNAME, BAR_CODE, UNIT1, COST_PRICE, LAS_BUY_PRICE, SALE_PRICE1 FROM ITEMS ORDER BY ITM_NO`
        );
        return {
            ok: true,
            items: (r.rows || []).map(x => ({
                code: x[0] != null ? String(x[0]).trim() : '',
                name: x[1] != null ? String(x[1]).trim() : '',
                barcode: x[2] != null ? String(x[2]).trim() : '',
                unit: x[3] != null ? String(x[3]).trim() : '',
                cost: Number(x[4] ?? x[5] ?? 0) || 0,
                price: Number(x[6] ?? 0) || 0,
            })).filter(i => i.code || i.name),
        };
    } catch (e) {
        return { ok: false, error: sanitizeError(e.message), items: [] };
    } finally {
        try { if (conn) {await conn.close();} } catch (_) {}
    }
}
async function discoverTables(limit = 100) {
    let conn = null;
    try {
        conn = await connectOnce(10);
        const r = await oraExecute(conn,
            `SELECT table_name FROM user_tables WHERE rownum <= :lim ORDER BY table_name`,
            { lim: Math.max(1, Math.min(500, Number(limit) || 100)) }
        );
        return { ok: true, tables: (r.rows || []).map(x => String(x[0])) };
    } catch (e) {
        return { ok: false, error: sanitizeError(e.message), tables: [] };
    } finally {
        try { if (conn) {await conn.close();} } catch (_) {}
    }
}

// ─── محرك السحب الدوري (staging خام → يستهلكه خط الملفات) ────────────────────
const engine = {
    timer: null,
    running: false,
    lastPoll: null,
    lastOk: null,
    lastError: '',
    stagedTotal: 0,
    io: null, // يُحقن من server.js ليبث الأحداث لحظيًا للواجهات

    status() {
        const cfg = loadOracleConfig();
        return {
            enabled: cfg.enabled,
            driver: driverStatus.tried ? driverStatus.available : null,
            thick: driverStatus.thick,
            host: cfg.host, port: cfg.port, service: cfg.service,
            hasUser: Boolean(cfg.user),
            hasPassword: Boolean(process.env.YARASOFT_ORACLE_PASSWORD),
            hasSql: Boolean(cfg.invoiceSql),
            running: this.running,
            pollMinutes: cfg.pollMinutes,
            lastPoll: this.lastPoll,
            lastOk: this.lastOk,
            lastError: this.lastError,
            stagedTotal: this.stagedTotal,
        };
    },

    async pollOnce() {
        const cfg = loadOracleConfig();
        if (!cfg.enabled || !cfg.invoiceSql) {return { skipped: true };}
        this.lastPoll = new Date().toISOString();
        let conn = null;
        try {
            conn = await connectOnce(20);
            const r = await oraExecute(conn, cfg.invoiceSql, {}, { outFormat: require('oracledb').OBJECT });
            const rows = r.rows || [];
            if (rows.length && cfg.stagingDir) {
                fs.mkdirSync(cfg.stagingDir, { recursive: true });
                const fname = `ys_ora_${Date.now()}.json`;
                fs.writeFileSync(path.join(cfg.stagingDir, fname), JSON.stringify({ source: 'yarasoft_oracle', pulledAt: new Date().toISOString(), rows }, null, 1));
                this.stagedTotal += rows.length;
            }
            this.lastOk = new Date().toISOString();
            this.lastError = '';
            logger.info && logger.info(`[yarasoft_oracle] poll ok: ${rows.length} rows staged`);
            // ترحيل فوري للمرحلة: staging → إيرادات (idempotent) — مع بث حي للواجهات
            try {
                const { consumeAllPending } = require('./oracle-consume');
                const c = await consumeAllPending({ io: this.io });
                const done = (c.results || []).reduce((s, r) => s + (r.completed || 0), 0);
                const dups = (c.results || []).reduce((s, r) => s + (r.duplicates || 0), 0);
                const needMap = (c.results || []).reduce((s, r) => s + (r.needsMapping || 0), 0);
                logger.info && logger.info(`[yarasoft_oracle] consume: ${done} posted, ${dups} duplicates, ${needMap} needs-mapping`);
                if (this.io && (done > 0 || needMap > 0)) {
                    this.io.emit('yarasoft:oracle-sync', { posted: done, duplicates: dups, needsMapping: needMap, at: this.lastOk });
                }
            } catch (e) {
                logger.error && logger.error('[yarasoft_oracle] consume failed: ' + sanitizeError(e.message));
            }
            return { ok: true, rows: rows.length };
        } catch (e) {
            this.lastError = sanitizeError(e.message);
            logger.error && logger.error('[yarasoft_oracle] poll failed: ' + this.lastError);
            return { ok: false, error: this.lastError };
        } finally {
            try { if (conn) {await conn.close();} } catch (_) {}
        }
    },

    start() {
        const cfg = loadOracleConfig();
        if (!cfg.enabled || this.running) {return;}
        this.running = true;
        const ms = cfg.pollMinutes * 60 * 1000;
        this.timer = setInterval(() => { this.pollOnce().catch(() => {}); }, ms);
        if (this.timer.unref) {this.timer.unref();}
        this.pollOnce().catch(() => {});
    },

    stop() {
        this.running = false;
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    },

    /** سحب فوري عند الطلب (زر "سحب الآن") — نفس دورة المؤقت تمامًا */
    async pollNow() {
        return this.pollOnce();
    },
};

module.exports = { loadOracleConfig, testConnection, discoverTables, pullItems, oracleEngine: engine, sanitizeError, assertOracleReadOnly, oraExecute };
