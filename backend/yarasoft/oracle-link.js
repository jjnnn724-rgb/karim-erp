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

// ─── كسر الدائرة: مضيف يارا ميت كان يعلّق كل شاشة 15 ثانية ──────────────────
// القياس من لوج الإنتاج 2026-10-13: /api/yara-reports/cashiers-today p50 = 15008ms
// لأن كل طلب ينتظر طابور اتصال Oracle كاملًا بينما الجهاز مطفأ. بعد ثلاثة إخفاقات
// متتالية تُفتح الدائرة فيُرفض فورًا بـ ORACLE_UNREACHABLE، وبعد فترة الاستعادة
// تُسمح محاولة واحدة (نصف مفتوحة) فتعود الخدمة تلقائيًا حين يعود الجهاز.
const ORACLE_BREAKER_THRESHOLD = 3;
const ORACLE_BREAKER_COOLDOWN_MS = 45000;
const oracleBreaker = { failures: 0, openedAt: 0, openedAtIso: null, lastError: '' };

function guardOracle() {
    if (!oracleBreaker.openedAt) {return;}
    if (Date.now() - oracleBreaker.openedAt >= ORACLE_BREAKER_COOLDOWN_MS) {
        oracleBreaker.openedAt = 0;
        oracleBreaker.failures = ORACLE_BREAKER_THRESHOLD - 1;
        return;
    }
    const err = new Error(`ORACLE_UNREACHABLE: قاعدة يارا سوفت غير متاحة الآن (${oracleBreaker.lastError || 'آخر فشل غير مسجّل'})`);
    err.code = 'ORACLE_UNREACHABLE';
    err.oracleCircuitOpen = true;
    throw err;
}

function noteOracleSuccess() {
    oracleBreaker.failures = 0;
    oracleBreaker.openedAt = 0;
    oracleBreaker.openedAtIso = null;
    oracleBreaker.lastError = '';
}

function isOracleDownError(e) {
    const m = String((e && e.message) || e || '');
    // طابور المجمع ممتلئ = القاعدة حيّة والطلبات مصطفّة؛ إغلاق الدائرة عندها
    // يحرم الشاشات من بياناتها بلا سبب حقيقي.
    if (/NJS-040|NJS-044|queueTimeout|queue length/i.test(m)) {return false;}
    return /NJS-500|NJS-501|NJS-502|NJS-503|NJS-509|ORA-12541|ORA-12154|ORA-12170|ORA-12537|ORA-12571|ORA-03113|ORA-03114|ORA-03135|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/i.test(m);
}

function noteOracleFailure(e) {
    if (e && e.oracleCircuitOpen) {return;} // رفض الدائرة المفتوحة ليس إخفاقًا جديدًا
    if (!isOracleDownError(e)) {return;}    // ازدحام أو خطأ استعلام: لا يُغلق الدائرة
    oracleBreaker.failures += 1;
    oracleBreaker.lastError = sanitizeError((e && e.message) || String(e));
    if (oracleBreaker.failures >= ORACLE_BREAKER_THRESHOLD) {
        oracleBreaker.openedAt = Date.now();
        oracleBreaker.openedAtIso = new Date().toISOString();
    }
}

function oracleBreakerStatus() {
    return {
        open: oracleBreaker.openedAt > 0 && Date.now() - oracleBreaker.openedAt < ORACLE_BREAKER_COOLDOWN_MS,
        failures: oracleBreaker.failures,
        lastError: oracleBreaker.lastError,
        openedAt: oracleBreaker.openedAtIso,
        threshold: ORACLE_BREAKER_THRESHOLD,
        cooldownMs: ORACLE_BREAKER_COOLDOWN_MS,
    };
}

/** تنفيذ استحواذ اتصال محروس بالدائرة: نجاح → إغلاق، فشل → تسجيل وعدّ */
async function oracleConnect(acquire) {
    guardOracle();
    try {
        const conn = await acquire();
        noteOracleSuccess();
        return conn;
    } catch (e) {
        noteOracleFailure(e);
        throw e;
    }
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

// ─── الموصل الصامد: تدوير بيانات الاعتماد + أثر صفري ───────────────────────
// مجموعات احتياطية YARASOFT_ORACLE_USER_2/PASSWORD_2 (+_3). عند تغيير يارا سوفت
// لكلمة المرور (ORA-01017) يُجرَّب التالي تلقائيًا دون تدخل — والقيم أبدًا لا
// تُسجَّل (sanitizeError) ولا تُعرض (testConnection يعرض رقم المجموعة فقط).
// ملاحظة أمانة مهنية: أي اتصال Oracle يظهر في V$SESSION لدى مدير قاعدتهم —
// الخفاء الحقيقي = قراءة فقط + اتصال واحد قصير + بلا أقفال إطلاقًا.
function credentialSets() {
    const sets = [];
    for (const suffix of ['', '_2', '_3']) {
        const user = (process.env[`YARASOFT_ORACLE_USER${suffix}`] || '').trim();
        const password = process.env[`YARASOFT_ORACLE_PASSWORD${suffix}`] || '';
        if (user && password) {sets.push({ index: sets.length + 1, user, password });}
    }
    return sets;
}
let activeCredIndex = 0;
let activeCredAt = null;
function credentialStatus() {
    return { setsConfigured: credentialSets().length, activeSet: activeCredIndex + 1, activeSince: activeCredAt };
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
        mod = require('oracledb');
    } catch (e) {
        driverStatus = { tried: true, available: false, thick: false, reason: 'مكتبة oracledb غير مثبتة — نفّذ: npm install oracledb' };
        throw new Error(driverStatus.reason, { cause: e });
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
            throw new Error(driverStatus.reason, { cause: e });
        }
    } else {
        driverStatus = { tried: true, available: true, thick: false, mod, reason: '' };
    }
    return mod;
}

async function connectOnce(timeoutSec = 8) {
    const cfg = loadOracleConfig();
    const sets = credentialSets();
    if (!sets.length) {throw new Error('YARASOFT_ORACLE_USER غير مضبوط في .env');}
    const oracledb = getDriver();
    // ابدأ من آخر مجموعة ناجحة (تدوير ذكي)، ثم جرّب البقية عند ORA-01017
    const order = sets.map((_, i) => i);
    order.sort((a, b) => (a === activeCredIndex ? -1 : b === activeCredIndex ? 1 : a - b));
    let lastErr = null;
    for (const i of order) {
        try {
            const conn = await oracledb.getConnection({
                user: sets[i].user,
                password: sets[i].password,
                connectString: buildConnectString(cfg),
                connectTimeout: timeoutSec,
            });
            if (activeCredIndex !== i) {
                activeCredIndex = i;
                activeCredAt = new Date().toISOString();
            }
            await tagSession(conn, 'connect');
            return conn;
        } catch (e) {
            lastErr = e;
            if (!/ORA-01017/i.test(String(e.message || ''))) {throw e;} // خطأ غير اعتمادي: لا تجرب البقية
        }
    }
    throw lastErr;
}

// ─── بصمة الجلسة: اسم جهازنا وهويتنا ظاهران لدى مدير Oracle ───────────────
// V$SESSION سيعرض: MACHINE (سيرفرنا) + CLIENT_IDENTIFIER + MODULE + ACTION.
// الشفافية المهنية: قارئ فقط، معروف الهوية، بلا أسرار.
function sessionIdentity() {
    const os = require('os');
    return {
        clientId: (process.env.KARIM_ORACLE_CLIENT_ID || 'POS-SYNC').slice(0, 64),
        module: 'POS-SYNC',
        host: os.hostname(),
    };
}
async function tagSession(conn, action) {
    try {
        const id = sessionIdentity();
        if (typeof conn.clientIdentifier !== 'undefined') {conn.clientIdentifier = id.clientId;}
        if (typeof conn.module !== 'undefined') {conn.module = id.module;}
        if (typeof conn.action !== 'undefined' && action) {conn.action = String(action).slice(0, 64);}
    } catch (_) { /* thin mode قد لا يدعمها — غير حرج */ }
}

// ─── حارس الجلسة الدائمة: تغيير الباسورد في Oracle لا يقتل الجلسات المفتوحة ─
// نبقي جلسة SELECT واحدة حية (تُفحص بنبضة قبل كل استخدام) لمسار المرآة عالي
// التكرار؛ فحتى لو غيّروا كلمة المرور نبقى داخلين بالجلسة القديمة حتى تسقط
// طبيعيًا — وحينها يعمل التدوير التلقائي. تُغلق نظيفًا عند إيقاف الخادم.
let keptConn = null;
async function getKeptConn(action = 'mirror') {
    if (keptConn) {
        try {
            await keptConn.execute(`SELECT SYSDATE FROM DUAL`);
            await tagSession(keptConn, action);
            return keptConn;
        } catch (_) { try { await keptConn.close(); } catch (_) {} keptConn = null; }
    }
    keptConn = await connectOnce(15);
    await tagSession(keptConn, action);
    return keptConn;
}
async function closeKeptConn() {
    if (!keptConn) {return;}
    try { await keptConn.close(); } catch (_) {}
    keptConn = null;
}

/** فحص الاتصال — قراءة فقط (banner) ثم إغلاق فوري */
async function testConnection() {
    const cfg = loadOracleConfig();
    const started = Date.now();
    let conn = null;
    // الفحص الصريح من المسؤول يتجاوز الدائرة المفتوحة: الغرض منه التحقق الآن
    // بعد إرجاع الجهاز أو تغيير الـ IP، لا انتظار فترة الاستعادة.
    noteOracleSuccess();
    try {
        conn = await connectOnce(8);
        let version = '';
        try {
            const r = await oraExecute(conn, `SELECT banner FROM v$version WHERE rownum = 1`);
            version = r.rows && r.rows[0] ? String(r.rows[0][0]).slice(0, 120) : '';
        } catch (_) { version = ''; }
        return { ok: true, ms: Date.now() - started, version, thick: driverStatus.thick, host: cfg.host, port: cfg.port, service: cfg.service, user: cfg.user, credentialSet: activeCredIndex + 1, credentialSets: credentialSets().length, identity: sessionIdentity() };
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
            `SELECT ITM_NO, ITMNAME, BAR_CODE, UNIT1, COST_PRICE, LAS_BUY_PRICE, SALE_PRICE1, LVL, INV_MIN_BAL, ITEM_TYPE FROM ITEMS ORDER BY ITM_NO`
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
                lvl: Number(x[7]) || 0,
                minBal: Math.max(0, Number(x[8]) || 0),
                itemType: x[9] != null ? String(x[9]).trim() : '',
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
            // مرآة الكاشيرية: نسخ أوامر اليوم محليًا (best-effort — لا تكسر الدورة)
            try {
                const { refreshMirrorOrders } = require('./mirror');
                const m = await refreshMirrorOrders({ io: this.io });
                if (m.ok && m.upserted > 0) {logger.info && logger.info(`[yarasoft_mirror] upserted ${m.upserted} orders`);}
                else if (!m.ok) {logger.warn && logger.warn('[yarasoft_mirror] skipped: ' + (m.error || ''));}
            } catch (e) {
                logger.warn && logger.warn('[yarasoft_mirror] cycle failed (non-fatal): ' + sanitizeError(e.message));
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
        try { closeKeptConn().catch(() => {}); } catch (_) {}
    },

    /** سحب فوري عند الطلب (زر "سحب الآن") — نفس دورة المؤقت تمامًا */
    async pollNow() {
        return this.pollOnce();
    },
};

module.exports = { loadOracleConfig, getDriver, testConnection, discoverTables, pullItems,
    oracleEngine: engine, sanitizeError, assertOracleReadOnly, oraExecute, credentialSets, credentialStatus,
    sessionIdentity, tagSession, getKeptConn, closeKeptConn,
    guardOracle, oracleConnect, noteOracleSuccess, noteOracleFailure, oracleBreakerStatus, isOracleDownError };
