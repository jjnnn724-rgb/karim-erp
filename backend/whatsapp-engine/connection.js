/**
 * whatsapp-engine/connection.js — إدارة اتصال Baileys (مثيل واحد + حالات صريحة)
 * ────────────────────────────────────────────────────────────────────────────
 * الحالات: INITIALIZING QR_REQUIRED AUTHENTICATING CONNECTED RECONNECTING
 *          DISCONNECTED LOGGED_OUT FAILED STOPPED
 * - لا حلقات reconnect غير مضبوطة: حد أقصى للفاصل + jitter + عدّاد محاولات.
 * - لا مثيلين معًا: قفل إنشاء + تدمير كامل للمقبس القديم ومستمعيه.
 * ملاحظة v7: useMultiFileAuthState غير متزامنة (await) — تم التحقق من الحزمة 7.0.0-rc14.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('baileys');
const { logger } = require('../logger');
const { backoffDelayMs } = require('./rules');
const store = require('./store');

const STATES = ['INITIALIZING', 'QR_REQUIRED', 'AUTHENTICATING', 'CONNECTED', 'RECONNECTING', 'DISCONNECTED', 'LOGGED_OUT', 'FAILED', 'STOPPED'];

const LOGGED_OUT_CODES = new Set([
    DisconnectReason.loggedOut, 401, 403,
]);
// 428/440 (تعارض جلسة/استبدال من الهاتف) — تعارض خطير يحتاج cooldown طويل
const CONFLICT_CODES = new Set([428, 440]);
const MAX_CONSECUTIVE_CONFLICTS = 3;
const CONFLICT_WINDOW_MS = 5 * 60 * 1000;
const CONFLICT_COOLDOWN_MS = 60000; // دقيقة كاملة قبل المحاولة بعد التعارض (بدل backoff سريع)

class WhatsappConnection extends EventEmitter {
    constructor(getConfig) {
        super();
        this.getConfig = getConfig;
        this.state = 'STOPPED';
        this.sock = null;
        this.qr = null;
        this.qrAt = null;
        this.reconnects = 0;
        this.lastOkAt = null;
        this.lastError = '';
        this._starting = false;
        this._stopping = false;
        this._retryTimer = null;
        this._startingPromise = null;
        this._conflicts = [];
        this._bootAt = 0;
        this._qrRestart = false;
        this._skipSessionRestore = false;
    }

    /** عمر QR الحالي بالمللي — null إن لا يوجد */
    qrAgeMs() {
        if (!this.qr || !this.qrAt) {return null;}
        return Date.now() - new Date(this.qrAt).getTime();
    }

    /** ربط قاطع الدائرة (يستدعيه المحرك عند البدء) */
        _setCircuitBreaker(cb) { this._circuitBreaker = cb || null; }

        /** الحد الأقصى لمحاولات إعادة الاتصال قبل التوقف التام */
        static MAX_RECONNECTS = 15;

        /** فاصل زمني أقصى بين كل إعادة محاولة */
        static MAX_RECONNECT_DELAY = 120000;

        setState(s, extra) {
        if (this.state === s) {return;}
        this.state = s;
        if (extra?.error !== undefined) {this.lastError = String(extra.error || '').slice(0, 300);}
        if (s === 'QR_REQUIRED' && !this.qr) {
            try { this.emit('qr-required', { state: s, at: new Date().toISOString() }); } catch (_) {}
        }
        if (s === 'CONNECTED') {
            this.lastOkAt = new Date().toISOString(); this.reconnects = 0;
            try {
                const { pool } = require('../shared-pool');
                pool.query(`DELETE FROM wa_settings WHERE key = 'wa_link_needed'`).catch(() => {});
            } catch (_) {}
            // Session snapshot: losing creds.json = re-pairing; keep last 10.
            try {
                const { backupSession } = require('./session-backup');
                const cfg = this.getConfig ? this.getConfig() : {};
                const dest = backupSession(
                    cfg.sessionDir,
                    cfg.sessionBackupDir || process.env.WHATSAPP_BACKUP_DIR || 'C:/KarimData/whatsapp-backups'
                );
                if (dest) {try { store.logEvent('session_backup', 'creds.json', dest.slice(-60)); } catch (_) {}}
            } catch (_) {}
        }
        try { this.emit('state', { state: s, at: new Date().toISOString(), error: this.lastError }); } catch (_) {}
        try { store.logEvent('state', s, this.lastError || ''); } catch (_) {}
        logger.info(`[WHATSAPP] state → ${s}${this.lastError ? ' — ' + this.lastError : ''}`);
    }

    status() {
        return {
            state: this.state, qrAvailable: !!this.qr,
            reconnects: this.reconnects, lastOkAt: this.lastOkAt, lastError: this.lastError,
        };
    }

    async ensureSessionDir() {
        const dir = this.getConfig().sessionDir;
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    /** بدء آمن — متزامن ضد الاستدعاءات المتوازية */
    start() {
        if (this._startingPromise) {return this._startingPromise;}
        this._startingPromise = this._boot().finally(() => { this._startingPromise = null; });
        return this._startingPromise;
    }

    async _boot() {
        if (this.sock) {return;}
        this._stopping = false;
        this.reconnects = 0;
        this._bootAt = Date.now();
        this.setState('INITIALIZING');
        const cfg = this.getConfig();
        const dir = await this.ensureSessionDir();
        // استعادة تلقائية: creds مفقودة/تالفة + نسخة احتياطية موجودة = استرجاع ثم متابعة
        try {
            const credsPath = path.join(dir, 'creds.json');
            let broken = false;
            try {
                const raw = fs.readFileSync(credsPath, 'utf8');
                JSON.parse(raw);
            } catch (_) { broken = true; }
            if (broken && !this._skipSessionRestore) {
                const { latestBackup, restoreLatest } = require('./session-backup');
                const bkDir = cfg.sessionBackupDir || process.env.WHATSAPP_BACKUP_DIR || 'C:/KarimData/whatsapp-backups';
                const bk = latestBackup(bkDir);
                if (bk) {
                    restoreLatest(bkDir, dir);
                    try { store.logEvent('session_restore', dir, String(bk).slice(-60)); } catch (_) {}
                    logger.warn('[WHATSAPP] session restored from backup: ' + String(bk).slice(-60));
                }
            }
        } catch (_) {}
        // عَلَم يُستهلك مرة واحدة: بعد رفض واتساب للجلسة (401) لا نُعيد نفس النسخة التالفة
        this._skipSessionRestore = false;
        let version = undefined;
        try {
            // مهلة 6 ثوانٍ — بلا تعليق إقلاع المحرك لو تعذر الوصول لخوادم النسخ (كان يُؤخر QR خلف مهلة الـ API)
            const v = await Promise.race([
                fetchLatestBaileysVersion(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('version-timeout')), 6000)),
            ]);
            version = v.version;
        } catch (e) { logger.warn('[WHATSAPP] version fetch failed, using default: ' + String(e.message).slice(0, 120)); }
        // useMultiFileAuthState غير متزامنة في Baileys v7
        const { state, saveCreds } = await useMultiFileAuthState(dir);
        const hasCreds = !!(state.creds?.me || state.creds?.registered);
        this.setState(hasCreds ? 'AUTHENTICATING' : 'QR_REQUIRED');

        const sock = makeWASocket({
            version,
            auth: state,
            logger: logger.child ? logger.child({ mod: 'wa-sock' }) : logger,
            browser: ['Karim ERP', 'Desktop', '1.0'],
            connectTimeoutMs: 60000,      // زودنا من 30s لـ 60s — يمنع timeout مض错觉
            defaultQueryTimeoutMs: 60000,  // زودنا من 30s لـ 60s
            keepAliveIntervalMs: 15000,    // زودنا من 25s لـ 15s — WebSocket أكثر حيوية
            retryRequestDelayMs: 2000,
            maxMsgRetryCount: 5,           // زودنا من 3 لـ 5
            syncFullHistory: false,
            markOnlineOnConnect: false,
            // ─── حماية إضافية من انقطاع WebSocket الهادئ ───
            printQRInTerminal: false,
            emitOwnEvents: false,         // منع حلقات الأحداث الذاتية
            fireInitQueries: true,        // تأكيد الاستعلامات الأولية
        });
        this.sock = sock;
        this._sockSession = { saveCreds, cleaned: false };

        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', (u) => this._onConnectionUpdate(u).catch((e) =>
            logger.error('[WHATSAPP] connection.update failed: ' + String(e.message).slice(0, 200))));
        sock.ev.on('messages.upsert', (m) => {
            try { this.emit('messages', m); } catch (e) { logger.error('[WHATSAPP] messages emit failed: ' + String(e.message).slice(0, 200)); }
        });

        // ─── WebSocket liveness pinger — يكتشف الموت الصامت ويُجبر reconnect ───
        // Baileys أحياناً يُظهر CONNECTED بس الـ WebSocket ميت → رسائل لا تصل
        this._startLivenessPinger();
    }

    /**
     * WebSocket liveness pinger — يرسل ping كل 20s ويكتشف الموت الصامت.
     * إذا فشل ping مرتين متتاليتين → يجبر إعادة وصل فورية.
     */
    _startLivenessPinger() {
        this._stopLivenessPinger();
        let consecutiveFails = 0;
        this._livenessTimer = setInterval(() => {
            if (this.state !== 'CONNECTED' || !this.sock) return;
            try {
                // محاولة إرسال ping عبر WebSocket
                const ws = this.sock?.ws || this.sock?.ev;
                if (ws && typeof ws.ping === 'function') {
                    ws.ping();
                }
                // فحص حالة WebSocket الأساسية
                const readyState = this.sock?.ws?.readyState;
                // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
                if (readyState === 2 || readyState === 3) {
                    consecutiveFails++;
                    logger.warn(`[WHATSAPP] liveness: WebSocket readyState=${readyState} (fail #${consecutiveFails})`);
                    if (consecutiveFails >= 2) {
                        logger.error('[WHATSAPP] liveness: WebSocket dead — forcing reconnect');
                        consecutiveFails = 0;
                        this._onConnectionUpdate({
                            connection: 'close',
                            lastDisconnect: { error: { output: { statusCode: 500 }, message: 'liveness_dead_websocket' } },
                        }).catch(() => {});
                    }
                } else {
                    consecutiveFails = 0;
                }
            } catch (e) {
                consecutiveFails++;
                if (consecutiveFails >= 3) {
                    logger.error('[WHATSAPP] liveness: ping failed 3x — forcing reconnect');
                    consecutiveFails = 0;
                    this._onConnectionUpdate({
                        connection: 'close',
                        lastDisconnect: { error: { output: { statusCode: 500 }, message: 'liveness_ping_fail' } },
                    }).catch(() => {});
                }
            }
        }, 20000); // كل 20 ثانية
        if (this._livenessTimer && this._livenessTimer.unref) {this._livenessTimer.unref();}
    }

    _stopLivenessPinger() {
        if (this._livenessTimer) {clearInterval(this._livenessTimer); this._livenessTimer = null;}
    }

    async _onConnectionUpdate(u) {
        const { connection, lastDisconnect, qr } = u || {};
        if (qr) {
            this.qr = qr;
            this.qrAt = new Date().toISOString();
            if (this.state !== 'CONNECTED') {this.setState('QR_REQUIRED');}
            try { this.emit('qr', { qr, at: this.qrAt }); } catch (_) {}
            return;
        }
        if (connection === 'open') {
            this.qr = null;
            this.setState('CONNECTED');
            return;
        }
        if (connection !== 'close' || this._stopping) {return;}
        const code = lastDisconnect?.error?.output?.statusCode;
        const boomMsg = String(lastDisconnect?.error?.message || '');
        // تعارض جلسة (428/440: استبدال من الهاتف/شبح): cooldown طويل ثم تصعيد
        if ((code !== undefined && CONFLICT_CODES.has(code)) || /replaced|conflict/i.test(boomMsg)) {
            const now = Date.now();
            this._conflicts = (this._conflicts || []).filter((t) => now - t < CONFLICT_WINDOW_MS);
            this._conflicts.push(now);
            if (this._conflicts.length < MAX_CONSECUTIVE_CONFLICTS) {
                logger.warn(`[WHATSAPP] session conflict (${code || '?'}) #${this._conflicts.length} — cooldown ${CONFLICT_COOLDOWN_MS / 1000}s قبل إعادة الوصل`);
                // ─── cooldown طويل بدل backoff سريع — يمنع حلقة 440 اللانهائية ───
                await this._disposeSocket();
                if (this._stopping) { this.setState('STOPPED'); return; }
                this.setState('RECONNECTING', { error: `conflict cooldown ${CONFLICT_COOLDOWN_MS / 1000}s (#${this._conflicts.length}/${MAX_CONSECUTIVE_CONFLICTS}, code ${code || '?'})` });
                clearTimeout(this._retryTimer);
                this._retryTimer = setTimeout(() => {
                    this._retryTimer = null;
                    if (!this._stopping && !this.sock) {this.start().catch((e) => this.setState('FAILED', { error: e.message }));}
                }, CONFLICT_COOLDOWN_MS);
                if (this._retryTimer && this._retryTimer.unref) {this._retryTimer.unref();}
                return;
            }
            // ─── تصعيد (كان كودًا ميتًا بعد return فلا يتنفذ أبدًا): التعارض الثالث خلال
            // 5 دقائق = الجلسة مستبدَلة فعليًا من الهاتف — مسح كامل وطلب ربط جديد (QR)
            // بدل حلقة reconnect أبدية بجلسة مسمومة لا تتصل ولا تستقبل ولا ترسل ───
            logger.error(`[WHATSAPP] repeated session conflict (${code || '?'}) — wiping poisoned session, fresh link required`);
            this._conflicts = [];
            await this._disposeSocket();
            if (this._stopping) { this.setState('STOPPED'); return; }
            this._clearSessionForRelink();
            this.setState('LOGGED_OUT', { error: `تعارض متكرر (${code || '?'}) — امسح الأجهزة المرتبطة من الهاتف ثم اربط من جديد` });
            try {
                const { pool } = require('../shared-pool');
                await pool.query(
                    `CREATE TABLE IF NOT EXISTS wa_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
                await pool.query(
                    `INSERT INTO wa_settings (key, value, updated_at) VALUES ('wa_link_needed', $1, NOW())
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
                    [new Date().toISOString()]);
            } catch (_) {}
            return;
        } else if (LOGGED_OUT_CODES.has(code) || /logged.?out|multidevice mismatch|forbidden/i.test(boomMsg)) {
            // جلسة مبطلة من واتساب: لا إعادة وصل — وضع LOGGED_OUT وإجراء يدوي
            await this._disposeSocket();
            this._clearSessionForRelink();
            this.setState('LOGGED_OUT', { error: `endSession (${code || '?'}) — يلزم ربط جديد` });
            try {
                const { pool } = require('../shared-pool');
                await pool.query(
                    `CREATE TABLE IF NOT EXISTS wa_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
                await pool.query(
                    `INSERT INTO wa_settings (key, value, updated_at) VALUES ('wa_link_needed', $1, NOW())
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
                    [new Date().toISOString()]);
            } catch (_) {}
            // بدء تلقائي لجلسة ربط جديدة حتى يظهر QR فورًا في الواجهة (بلا انتظار)
            if (!this._stopping && !this._qrRestart) {
                this._qrRestart = true;
                const t = setTimeout(() => {
                    this._qrRestart = false;
                    if (!this._stopping && this.state === 'LOGGED_OUT') {this.start().catch(() => {});}
                }, 5000);
                if (t && typeof t.unref === 'function') {t.unref();}
            }
            return;
        }
        await this._disposeSocket();
        if (this._stopping) { this.setState('STOPPED'); return; }
        // انقطاع مؤقت: backoff محدود ثم إعادة إنشاء واحدة
                // لا نعيد المحاولة إلى ما لا نهاية — بعد MAX_RECONNECTS نوقف ونطلب تدخل يدوي
                if (this.reconnects >= WhatsappConnection.MAX_RECONNECTS) {
                    await this._disposeSocket();
                    this.setState('FAILED', { error: `تم تجاوز ${WhatsappConnection.MAX_RECONNECTS} محاولة — يلزم إعادة تشغيل المحرك أو مسح الجلسة` });
                    return;
                }
                this.reconnects += 1;
                // إعدادات إعادة الوصل من الكونفق الحالي (كان ReferenceError: cfg غير معرّفة هنا)
                let rBase = 2000, rMax = 60000;
                try {
                    const liveCfg = this.getConfig ? this.getConfig() : {};
                    rBase = Number(liveCfg.reconnectBaseDelayMs) || 2000;
                    rMax = Number(liveCfg.reconnectMaxDelayMs) || 60000;
                } catch (_) {}
                const rawDelay = backoffDelayMs(this.reconnects, rBase, rMax);
                const delay = Math.min(rawDelay, WhatsappConnection.MAX_RECONNECT_DELAY);
                this.setState('RECONNECTING', { error: `retry in ${delay}ms (#${this.reconnects}/${WhatsappConnection.MAX_RECONNECTS}, code ${code || '?'})` });
                clearTimeout(this._retryTimer);
                this._retryTimer = setTimeout(() => {
                    this._retryTimer = null;
                    if (!this._stopping && !this.sock) {this.start().catch((e) => this.setState('FAILED', { error: e.message }));}
                }, delay);
                if (this._retryTimer.unref) {this._retryTimer.unref();}
    }

    async _disposeSocket() {
        clearTimeout(this._retryTimer);
        this._retryTimer = null;
        this._stopLivenessPinger(); // أوقف pinger قبل التخلص من المقبس
        const s = this.sock;
        this.sock = null;
        if (this.state === 'LOGGED_OUT') { this.qr = null; }
        if (!s) {return;}
        try { s.ev.removeAllListeners('connection.update'); } catch (_) {}
        try { s.ev.removeAllListeners('messages.upsert'); } catch (_) {}
        try { s.ev.removeAllListeners('creds.update'); } catch (_) {}
        try { if (typeof s.end === 'function') {s.end();} } catch (_) {}
        try { if (s.ws && typeof s.ws.close === 'function') {s.ws.close();} } catch (_) {}
        // ─── انتظار قصير لضمان إغلاق WebSocket فعلياً (يمنع جلسة الشبح) ───
        await new Promise((r) => setTimeout(r, 500));
    }

    /**
     * مسح الجلسة المرفوضة من واتساب (401/loggedOut/تعارض متكرر) لبدء ربط جديد.
     * بدونه يبقى creds.json التالف (me موجود، registered:false) فيقلع المحرك إلى
     * AUTHENTICATING بدل QR_REQUIRED ويعيد Baileys محاولة استئناف جلسة ميتة → حلقة
     * 401 بلا نهاية ولا يظهر أي QR. النسخ الاحتياطية تحمل نفس الجلسة المرفوضة، لذا
     * نعطّل الاستعادة التلقائية لهذه المرة عبر _skipSessionRestore.
     */
    _clearSessionForRelink() {
        this._skipSessionRestore = true;
        try {
            const dir = this.getConfig().sessionDir;
            try {
                for (const f of fs.readdirSync(dir)) {
                    if (/^(creds\.json|pre-key-|session-|sender-key-|app-state)/.test(f)) {
                        try { fs.rmSync(path.join(dir, f), { force: true }); } catch (_) {}
                    }
                }
            } catch (_) {}
            try { store.logEvent('session_clear_relink', dir, '401/logout — cleared rejected session for fresh QR'); } catch (_) {}
            logger.warn('[WHATSAPP] rejected session cleared — سيصدر QR جديد عند الإقلاع التالي');
        } catch (e) {
            logger.error('[WHATSAPP] session clear failed: ' + String(e.message).slice(0, 200));
        }
    }

    /** إيقاف نظيف: بلا إعادة وصل */
    async stop() {
        this._stopping = true;
        clearTimeout(this._retryTimer);
        this._retryTimer = null;
        this.reconnects = 0;
        this._conflicts = [];
        await this._disposeSocket();
        this.setState('STOPPED');
    }

    /** خروج آمن + مسح الجلسة (إجراء مدمر يؤكد من الـ API) */
    async logout() {
        try { if (this.sock && typeof this.sock.logout === 'function') {await this.sock.logout();} } catch (_) {}
        await this.stop();
        try {
            const dir = this.getConfig().sessionDir;
            fs.rmSync(dir, { recursive: true, force: true });
            fs.mkdirSync(dir, { recursive: true });
        } catch (e) { logger.error('[WHATSAPP] session wipe failed: ' + String(e.message).slice(0, 200)); }
        this.setState('LOGGED_OUT', { error: 'logged out by admin — يلزم ربط جديد' });
    }

    /** رمز الربط برقم الهاتف (اختياري — إن دعمته النسخة والحساب) */
    /** إعادة طلب QR جديد بدون إيقاف المحرك */
    async requestQR() {
        if (this._stopping) {throw Object.assign(new Error('المحرك يتوقف'), { code: 'STOPPING' });}
        try { await this.stop(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 1000));
        try { await this.start(); } catch (e) {
            throw Object.assign(new Error('فشل إنشاء QR جديد: ' + e.message.slice(0,100)), { code: 'QR_REFRESH_FAILED' });
        }
        return this.qr ? true : false;
    }
    async pairingCode(phoneDigits) {
        const digits = String(phoneDigits || '').replace(/\D/g, '');
        if (!/^\d{7,16}$/.test(digits)) {throw Object.assign(new Error('رقم هاتف غير صالح'), { code: 'INVALID_PHONE' });}
        if (!this.sock || typeof this.sock.requestPairingCode !== 'function') {
            throw Object.assign(new Error('الربط بالرمز غير متاح في هذه الجلسة'), { code: 'PAIRING_UNAVAILABLE' });
        }
        return this.sock.requestPairingCode(digits);
    }

    getSocket() { return this.sock; }
    isConnected() { return this.state === 'CONNECTED' && !!this.sock; }

    /** إعادة توليد QR بدون إيقاف المحرك بالكامل */
    async refreshQR() {
        await this._disposeSocket();
        this._startingPromise = null;
        this.qr = null;
        this.qrAt = null;
        this.start().catch((e) => { throw Object.assign(new Error('FAILED_TO_REFRESH_QR'), { cause: e.message }); });
    }

    /** حل LID إلى رقم هاتف عبر مخزن الإشارات (v7) — يعيد '' عند التعذر */
    async resolvePN(jid) {
        try {
            const fn = this.sock?.signalRepository?.lidMapping?.getPNForLID;
            if (typeof fn !== 'function' || !jid) {return '';}
            const pn = await fn.call(this.sock.signalRepository.lidMapping, String(jid));
            return String(pn || '').split('@')[0].split(':')[0].replace(/\D/g, '');
        } catch (_) { return ''; }
    }
}

module.exports = { WhatsappConnection, STATES };
