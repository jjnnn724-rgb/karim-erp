/**
 * zkteco/client.js — عميل ZKTeco قياسي عبر TCP (داخل خادم ERP مباشرة)
 * ────────────────────────────────────────────────────────────────────────────
 * نقل سلوك pyzk 0.9 (TCP mode) إلى Node.js:
 *   • توجيه TCP: ترويسة 8 بايت (magic + طول) + حزمة ZK (8 ترويسة + بيانات).
 *     Node يدير البث فيسانسنا تعقيدات pyzk مع recv الجزئي — نفس البروتوكول.
 *   • connect: CMD_CONNECT → جلسة من الرد → CMD_AUTH عند CMD_ACK_UNAUTH.
 *   • readWithBuffer: CMD_BUFFER_RDQ(1503) → PREPARE_DATA بالحجم الكلي ثم
 *     قراءة أجزاء CMD_CHUNK_RDQ(1504) بمقاس 0xFFc0 ثم CMD_FREE_DATA(1502).
 *     (نفس تسلسل pyzk read_with_buffer/__read_chunk.)
 *   • getAttendance: readSizes → (مستخدمون إن لزم) → readWithBuffer(ATTLOG).
 */

'use strict';

const net = require('net');
const proto = require('./protocol');

class ZKError extends Error {
    constructor(message, code = 'ZK_ERROR') { super(message); this.code = code; }
}
class ZKConnectionError extends ZKError {
    constructor(m) { super(m, 'ZK_CONNECTION_FAILED'); }
}
class ZKTimeoutError extends ZKError {
    constructor(m) { super(m, 'ZK_TIMEOUT'); }
}
class ZKAuthenticationError extends ZKError {
    constructor(m) { super(m, 'ZK_UNAUTHENTICATED'); }
}
class ZKProtocolError extends ZKError {
    constructor(m) { super(m, 'ZK_PROTOCOL_ERROR'); }
}
class DeviceNotZKTecoError extends ZKError {
    constructor(m) { super(m, 'NOT_ZK_DEVICE'); }
}

const DEFAULT_TIMEOUT_MS = 8000;

class ZKClient {
    /**
     * @param {object} opts
     * @param {string} opts.host عنوان IP للجهاز
     * @param {number} [opts.port=4370]
     * @param {number} [opts.commKey=0] كلمة مرور الجهاز (commkey)
     * @param {number} [opts.timeoutMs=8000] مهلة الاتصال والعمليات
     */
    constructor({ host, port = 4370, commKey = 0, timeoutMs = DEFAULT_TIMEOUT_MS }) {
        if (!host) {throw new ZKError('host مطلوب', 'ZK_CONFIG');}
        this.host = String(host);
        this.port = Number(port) || 4370;
        this.commKey = Number(commKey) || 0;
        this.timeoutMs = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;

        this.socket = null;
        this.buffer = Buffer.alloc(0);
        this.sessionId = 0;
        this.replyId = proto.USHRT_MAX - 1;      // كما في pyzk connect()
        this.connected = false;
        this._waiters = [];                       // طلبات انتظار إطارات
        this._pendingFrames = [];
        this._connectWaiter = null;
    }

    // ─────────────────────────────── طبقة النقل ──────────────────────────────
    _setupSocket(socket) {
        socket.setNoDelay(true);
        socket.setTimeout(0);
        socket.on('data', (chunk) => {
            this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
            this._drainFrames();
        });
        socket.on('error', (err) => this._failWaiters(new ZKConnectionError(`socket: ${err.message}`)));
        socket.on('close', () => {
            this.connected = false;
            this._failWaiters(new ZKConnectionError('انقطع الاتصال بالجهاز'));
        });
    }

    _drainFrames() {
        // كل إطار: 8 بايت ترويسة TCP + حمولة بطولها (ترويسة ZK + بيانات)
        for (;;) {
            if (this.buffer.length < 8) {return;}
            const length = proto.parseTcpTop(this.buffer);
            if (length <= 0) {
                // ترويسة غير صالحة — ليست جهاز ZKTeco (أو تدفق تالف): تجاهل بايتًا وإعادة المحاولة
                const err = new DeviceNotZKTecoError('ترويسة TCP غير صالحة — الجهاز لا يلتزم ببروتوكول ZK');
                this.buffer = Buffer.alloc(0);
                this._failWaiters(err);
                return;
            }
            if (this.buffer.length < 8 + length) {return;}   // نحتاج باقي الإطار
            const frame = this.buffer.subarray(8, 8 + length);
            this.buffer = this.buffer.subarray(8 + length);
            this._deliverFrame(frame);
        }
    }

    _deliverFrame(frame) {
        if (this._waiters.length > 0) {
            this._waiters.shift()(frame);
        } else {
            this._pendingFrames.push(frame);
        }
    }

    _failWaiters(err) {
        const waiters = this._waiters.splice(0);
        waiters.forEach(w => w(err));
        const pending = this._pendingFrames.splice(0);
        pending.length = 0;
    }

    /** انتظار إطار TCP التالي مع مهلة */
    _nextFrame(timeoutMs = this.timeoutMs) {
        if (this._pendingFrames.length > 0) {
            return Promise.resolve(this._pendingFrames.shift());
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this._waiters.indexOf(waiter);
                if (idx >= 0) {this._waiters.splice(idx, 1);}
                reject(new ZKTimeoutError(`انتهت مهلة انتظار رد الجهاز (${timeoutMs}ms)`));
            }, timeoutMs);
            const waiter = (value) => {
                clearTimeout(timer);
                if (value instanceof Error) {reject(value);}
                else {resolve(value);}
            };
            this._waiters.push(waiter);
        });
    }

    /** اتصال TCP خام */
    async _openSocket() {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: this.host, port: this.port });
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) {return;}
                settled = true;
                socket.destroy();
                reject(new ZKTimeoutError(`تعذر الاتصال بـ ${this.host}:${this.port} خلال ${this.timeoutMs}ms`));
            }, this.timeoutMs);
            socket.once('connect', () => {
                if (settled) {return;}
                settled = true;
                clearTimeout(timer);
                this._setupSocket(socket);
                resolve(socket);
            });
            socket.once('error', (err) => {
                if (settled) {return;}
                settled = true;
                clearTimeout(timer);
                socket.destroy();
                reject(new ZKConnectionError(`تعذر الاتصال بـ ${this.host}:${this.port}: ${err.message}`));
            });
        });
    }

    // ─────────────────────────────── أوامر البروتوكول ────────────────────────
    /**
     * إرسال أمر وانتظار رده (مطابق لـ __send_command).
     * @returns {Promise<{cmd:number, sessionId:number, replyId:number, data:Buffer, ok:boolean}>}
     */
    async sendCommand(command, commandString = null, timeoutMs = this.timeoutMs) {
        if (!this.socket) {throw new ZKConnectionError('لا يوجد اتصال بالجهاز');}
        // كما في pyzk: الحزمة تحمل reply_id+1 الداخلي، و this.replyId يُحدّث
        // من صدى الجهاز في الرد (header[3]) — لا زيادة يدوية مزدوجة.
        const { packet } = proto.buildHeader(command, commandString, this.sessionId, this.replyId);
        await new Promise((resolve, reject) => {
            this.socket.write(proto.buildTcpTop(packet), (err) => (err ? reject(new ZKConnectionError(err.message)) : resolve()));
        });
        const frame = await this._nextFrame(timeoutMs);
        // ترويسة ZK داخل الإطار: cmd, checksum, sessionId, replyId
        const cmd = frame.readUInt16LE(0);
        const sessionId = frame.readUInt16LE(4);
        const replyId = frame.readUInt16LE(6);
        this.replyId = replyId;
        const data = frame.subarray(8);
        const ok = cmd === proto.CMD_ACK_OK || cmd === proto.CMD_PREPARE_DATA || cmd === proto.CMD_DATA;
        return { cmd, sessionId, replyId, data, ok };
    }

    /** المصافحة والاتصال (connect في pyzk) */
    async connect() {
        if (this.connected) {return this;}
        this.socket = await this._openSocket();
        this.buffer = Buffer.alloc(0);
        this.sessionId = 0;
        this.replyId = proto.USHRT_MAX - 1;

        const res = await this.sendCommand(proto.CMD_CONNECT);
        this.sessionId = res.sessionId;                      // كما في pyzk: من رد المصافحة
        if (res.cmd === proto.CMD_ACK_UNAUTH) {
            const authKey = proto.makeCommKey(this.commKey, this.sessionId);
            const authRes = await this.sendCommand(proto.CMD_AUTH, authKey);
            if (authRes.cmd === proto.CMD_ACK_UNAUTH) {
                await this._closeQuietly();
                throw new ZKAuthenticationError('فشلت مصادقة الجهاز — تحقق من كلمة مرور الجهاز (Comm Key)');
            }
            if (!authRes.ok) {
                await this._closeQuietly();
                throw new ZKProtocolError(`رد غير متوقع على المصادقة: ${authRes.cmd}`);
            }
        } else if (!res.ok) {
            await this._closeQuietly();
            // بعض الأجهزة تعيد ACK_ERROR لجهاز ليس ZKTeco على نفس المنفذ
            throw new DeviceNotZKTecoError(`الجهاز رفض المصافحة (كود ${res.cmd}) — ليس جهاز ZKTeco متوافقًا`);
        }
        this.connected = true;
        return this;
    }

    async disconnect() {
        if (!this.socket) {return;}
        try {
            if (this.connected) {
                await this.sendCommand(proto.CMD_EXIT, null, 3000);
            }
        } catch (_) { /* الإغلاق بلا شرط */ }
        await this._closeQuietly();
    }

    async _closeQuietly() {
        this.connected = false;
        const socket = this.socket;
        this.socket = null;
        this._failWaiters(new ZKConnectionError('أُغلق الاتصال'));
        if (socket) {
            try { socket.destroy(); } catch (_) { /* لا شيء */ }
        }
    }

    // ─────────────────────────────── عمليات عالية المستوى ────────────────────
    /** إصدار الفيرموير (CMD_GET_VERSION) */
    async getFirmwareVersion() {
        const res = await this.sendCommand(proto.CMD_GET_VERSION, null, 4000);
        if (!res.ok) {throw new ZKProtocolError('تعذر قراءة إصدار الفيرموير');}
        return proto.parseNullTerminatedString(res.data);
    }

    /** قراءة خيار تكوين (~SerialNumber / ~Platform / ~DeviceName ...) */
    async getOption(name) {
        const cs = Buffer.from(`${name}\0`, 'latin1');
        const res = await this.sendCommand(proto.CMD_OPTIONS_RRQ, cs, 4000);
        if (!res.ok) {throw new ZKProtocolError(`تعذر قراءة الخيار ${name}`);}
        return proto.parseOptionValue(res.data);
    }

    async getSerialNumber() { return this.getOption('~SerialNumber'); }
    async getPlatform() { return this.getOption('~Platform'); }
    async getDeviceName() { return this.getOption('~DeviceName'); }

    /** إحصاءات الذاكرة (read_sizes) — عدد المستخدمين والسجلات والسعات */
    async readSizes() {
        const res = await this.sendCommand(proto.CMD_GET_FREE_SIZES, null, 6000);
        if (!res.ok) {throw new ZKProtocolError('تعذر قراءة إحصاءات الجهاز');}
        const d = res.data;
        const out = { users: 0, fingers: 0, records: 0, cards: 0, faces: 0 };
        if (d.length >= 80) {
            out.users = d.readInt32LE(4 * 4);
            out.fingers = d.readInt32LE(6 * 4);
            out.records = d.readInt32LE(8 * 4);
            out.cards = d.readInt32LE(12 * 4);
        }
        const rest = d.length > 80 ? d.subarray(80) : Buffer.alloc(0);
        if (rest.length >= 12) {
            out.faces = rest.readInt32LE(0);
        }
        return out;
    }

    /** تفريغ مخزن الجهاز (free_data) */
    async freeData() {
        try { await this.sendCommand(proto.CMD_FREE_DATA, null, 4000); } catch (_) { /* غير حرج */ }
    }

    /**
     * قراءة مخزن بيانات كامل مع التجزئة (read_with_buffer في pyzk).
     * @param {number} command أمر قراءة البيانات (CMD_ATTLOG_RRQ / CMD_USERTEMP_RRQ)
     * @param {number} [fct=0] نوع البيانات الفرعي (FCT_USER=5)
     * @returns {Promise<Buffer>} المخزن الكامل (يبدأ بحجم منطقي 4 بايت)
     */
    async readWithBuffer(command, fct = 0) {
        const MAX_CHUNK = 0xFFC0;                     // كما في pyzk TCP
        const req = Buffer.alloc(11);
        req.writeInt8(1, 0);
        req.writeInt16LE(command, 1);
        req.writeInt32LE(fct, 3);
        req.writeInt32LE(0, 7);

        const first = await this.sendCommand(proto.CMD_BUFFER_RDQ, req, 8000);
        if (!first.ok) {throw new ZKProtocolError('الجهاز لا يدعم قراءة المخزن (RWB)');}

        if (first.cmd === proto.CMD_DATA) {
            // بعض الفيرمويرات (مثل MB20-VL) تُتبع البيانات بإطار ACK_OK زائد —
            // ابتلاعه وإلا انزاح تسلسل الردود ورجعت القراءات التالية أصفارًا
            try {
                const trail = await this._nextFrame(400);
                if (trail.readUInt16LE(0) !== proto.CMD_ACK_OK) {this._pendingFrames.unshift(trail);}
            } catch (_) { /* لا إطار زائد — طبيعي */ }
            await this.freeData();                  // تحرير مخزن الجهاز وإلا تُرجع القراءة التالية فارغة
            return first.data;                        // البيانات كاملة في إطار واحد
        }

        // PREPARE_DATA: الحجم الكلي (كما في pyzk: unpack I من بيانات الرد)
        let size = 0;
        if (first.data.length >= 5) {size = first.data.readUInt32LE(1);}
        else if (first.data.length >= 4) {size = first.data.readUInt32LE(0);}
        if (size <= 0) {return Buffer.alloc(0);}

        const chunks = [];
        let start = 0;
        const remain = size % MAX_CHUNK;
        const packets = (size - remain) / MAX_CHUNK;
        for (let i = 0; i < packets; i++) {
            chunks.push(await this._readChunk(start, MAX_CHUNK));
            start += MAX_CHUNK;
        }
        if (remain > 0) {
            chunks.push(await this._readChunk(start, remain));
            start += remain;
        }
        await this.freeData();
        return Buffer.concat(chunks);
    }

    /** قراءة جزء من المخزن (__read_chunk مع 3 محاولات) */
    async _readChunk(start, size) {
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const cs = Buffer.alloc(8);
                cs.writeInt32LE(start, 0);
                cs.writeInt32LE(size, 4);
                const res = await this.sendCommand(proto.CMD_CHUNK_RDQ, cs, Math.max(this.timeoutMs, 10000));
                if (res.cmd === proto.CMD_DATA) {return res.data;}
                if (res.cmd === proto.CMD_PREPARE_DATA) {
                    // بث متسلسل (سلوك UDP في pyzk): إطار الإعداد يحمل الحجم فقط،
                    // البيانات الفعلية تأتي في إطارات CMD_DATA تليها ACK_OK.
                    const parts = [];
                    let got = 0;
                    let ended = false;
                    for (;;) {
                        const f = await this._nextFrame(Math.max(this.timeoutMs, 10000));
                        const fcmd = f.readUInt16LE(0);
                        const fdata = f.subarray(8);
                        if (fcmd === proto.CMD_DATA) {
                            parts.push(fdata);
                            got += fdata.length;
                            if (got >= size) {break;}
                        } else if (fcmd === proto.CMD_ACK_OK) {
                            ended = true;
                            break;
                        } else if (fcmd === proto.CMD_ACK_ERROR || fcmd === proto.CMD_ACK_UNAUTH) {
                            throw new ZKProtocolError(`الجهاز أوقف بث الجزء (${fcmd})`);
                        }
                    }
                    if (!ended) {
                        // بعض الأجهزة (MB20-VL) ترسل ACK_OK ختاميًا بعد آخر DATA —
                        // ابتلاعه وإلا بقي إطارًا شاردًا يُفسد الرد التالي (أصفار)
                        try {
                            const tail = await this._nextFrame(1500);
                            if (tail.readUInt16LE(0) !== proto.CMD_ACK_OK) {this._pendingFrames.unshift(tail);}
                        } catch (_) { /* لا ذيل — طبيعي */ }
                    }
                    return Buffer.concat(parts);
                }
                lastErr = new ZKProtocolError(`رد غير متوقع على قراءة الجزء (${res.cmd})`);
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr || new ZKProtocolError(`تعذر قراءة الجزء ${start}:${size}`);
    }

    /** قائمة مستخدمي الجهاز (get_users) */
    async getUsers() {
        const sizes = await this.readSizes();
        if (!sizes.users) {return [];}
        const buf = await this.readWithBuffer(proto.CMD_USERTEMP_RRQ, proto.FCT_USER);
        return proto.parseUsers(buf, sizes.users);
    }

    /**
     * قراءة سجلات الحضور (get_attendance).
     * @param {object} [opts]
     * @param {boolean} [opts.includeUsers=true] إحضار المستخدمين (ضروري لنمط 8 بايت)
     * @returns {Promise<{records: Array, sizes: object, users: Array}>}
     */
    async getAttendance({ includeUsers = true } = {}) {
        const sizes = await this.readSizes();
        if (!sizes.records) {return { records: [], sizes, users: [] };}
        let users = [];
        if (includeUsers) {
            try { users = await this.getUsers(); } catch (_) { users = []; }
        }
        const buf = await this.readWithBuffer(proto.CMD_ATTLOG_RRQ, 0);
        const records = proto.parseAttendanceLogs(buf, sizes.records, users);
        return { records, sizes, users };
    }

    /** جمع معلومات هوية الجهاز (إثبات أنه ZKTeco حقيقي) */
    async readIdentity() {
        const identity = { firmware: null, serial: null, platform: null, deviceName: null };
        const tasks = [
            ['firmware', () => this.getFirmwareVersion()],
            ['serial', () => this.getSerialNumber()],
            ['platform', () => this.getPlatform()],
            ['deviceName', () => this.getDeviceName()],
        ];
        for (const [key, fn] of tasks) {
            try { identity[key] = (await fn()) || null; } catch (_) { identity[key] = null; }
        }
        return identity;
    }
}

module.exports = {
    ZKClient,
    ZKError, ZKConnectionError, ZKTimeoutError, ZKAuthenticationError,
    ZKProtocolError, DeviceNotZKTecoError,
};
