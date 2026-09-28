/**
 * zkteco/protocol.js — ZKTeco standard-protocol primitives (wire-level)
 * ────────────────────────────────────────────────────────────────────────────
 * نقل أمين لخوارزميات بروتوكول ZKTeco القياسي من المصدر المُثبت تجاريًا
 * (مكتبة pyzk 0.9 المفتوحة — zk/base.py و zk/const.py) — وليس اختراعًا للحزم.
 *
 * المرجع (Section 24 — DO NOT FAKE ZKTeco support):
 *   • قيم الأوامر مطابقة لـ zk/const.py
 *   • createChecksum مطابق لـ ZK.__create_checksum (المأخوذ من zkemsdk.c)
 *   • buildHeader مطابق لـ ZK.__create_header
 *   • makeCommKey مطابق لـ make_commkey (commpro.c - MakeKey)
 *   • decodeTime/encodeTime مطابقان لـ zkemsdk.c DecodeTime/EncodeTime
 *   • تحليل سجلات الحضور مطابق لـ ZK.get_attendance (أنماط 8/16/40 بايت)
 *   • تحليل المستخدمين مطابق لـ ZK.get_users (أنماط 28/72 بايت)
 *
 * ملاحظة: منفذ 4370 مفتوح وحده لا يعني أن الجهاز ZKTeco — الهوية تُثبت
 * فقط بعد مصافحة بروتوكول حقيقية تعيد بيانات الجهاز.
 */

'use strict';

// ─── ZK command set (zk/const.py) ───────────────────────────────────────────
const CMD_CONNECT = 1000;             // بدء الجلسة (مصافحة)
const CMD_EXIT = 1001;                // إنهاء الجلسة
const CMD_ENABLEDEVICE = 1002;
const CMD_DISABLEDEVICE = 1003;
const CMD_RESTART = 1004;
const CMD_GET_VERSION = 1100;         // إصدار الفيرموير
const CMD_CHANGE_SPEED = 1101;
const CMD_AUTH = 1102;                // مصادقة بكلمة مرور الجهاز
const CMD_OPTIONS_RRQ = 11;           // قراءة خيار تكوين (~SerialNumber ...)
const CMD_USERTEMP_RRQ = 9;           // قراءة بيانات المستخدمين (FCT_USER=5)
const CMD_ATTLOG_RRQ = 13;            // قراءة سجلات الحضور
const CMD_GET_FREE_SIZES = 50;        // إحصاءات الذاكرة (عدد السجلات...)
const CMD_GET_TIME = 201;
const CMD_SET_TIME = 202;

// أوامر المخزن المؤقت (read_with_buffer في pyzk)
const CMD_BUFFER_RDQ = 1503;          // طلب قراءة مجموعة بيانات مخزنة
const CMD_CHUNK_RDQ = 1504;           // قراءة جزء من المخزن
const CMD_FREE_DATA = 1502;           // تفريغ مخزن الجهاز

// أكواد الرد
const CMD_ACK_OK = 2000;
const CMD_ACK_ERROR = 2001;
const CMD_ACK_DATA = 2002;
const CMD_ACK_UNAUTH = 2005;
const CMD_PREPARE_DATA = 1500;        // الجهاز سيبث بيانات
const CMD_DATA = 1501;                // حزمة بيانات

// ترويسة TCP (zk/base.py __create_tcp_top: pack('<HHI', 0x5050, 0x7d82, len))
// ملاحظة: تعليق pyzk يقول 0x7282 لكن القيمة الفعلية 32130 = 0x7d82 —
// وبذلك يصبح السحر 50 50 82 7d كما في كل أجهزة ZKTeco الحقيقية.
const MACHINE_PREPARE_DATA_1 = 0x5050;
const MACHINE_PREPARE_DATA_2 = 0x7D82;   // 32130
const USHRT_MAX = 65535;

// أسماء حالة البصمة (0 حضور، 1 انصراف، 2/3 استراحة، 4/5 أوفر تايم)
const PUNCH_STATE_NAMES = {
    0: 'check_in', 1: 'check_out', 2: 'break_out', 3: 'break_in',
    4: 'overtime_in', 5: 'overtime_out',
};
// أنواع التحقق: 1 بصمة، 2 بطاقة، 15 وجه
const VERIFY_TYPE_NAMES = { 1: 'fingerprint', 2: 'card', 15: 'face' };

// حالات تُعامل كـ"حضور" أو "انصراف" عند ملء سجل اليوم
const CHECK_IN_STATES = new Set([0, 2, 4]);
const CHECK_OUT_STATES = new Set([1, 3, 5]);

// ─── Checksum (zkemsdk.c عبر pyzk __create_checksum) ────────────────────────
/**
 * المجموع 16-بت بترتيب little-endian مع طيّ الحمل بنفس سلوك pyzk الحرفي
 * (طرح 65535 لا 65536 — سلوك مثبت ضد الأجهزة الحقيقية).
 * @param {Buffer|number[]} bytes
 * @returns {number} 0..65534
 */
function createChecksum(bytes) {
    const p = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    let checksum = 0;
    let i = 0;
    const len = p.length;
    while (len - i > 1) {
        checksum += p[i] | (p[i + 1] << 8);      // unpack('H') بترتيب LE
        if (checksum > USHRT_MAX) {checksum -= USHRT_MAX;}
        i += 2;
    }
    if (len - i === 1) {checksum += p[i];}         // بايت فردي متبقٍ
    while (checksum > USHRT_MAX) {checksum -= USHRT_MAX;}
    // ~checksum في بايثون = -x-1 ثم إضافة 65535 حتى يصبح غير سالب
    checksum = -checksum - 1;
    while (checksum < 0) {checksum += USHRT_MAX;}
    return checksum;
}

// ─── بناء حزمة ZK (ترويسة 8 بايت + البيانات) ────────────────────────────────
/**
 * مطابق لـ __create_header: يُحسب checksum على الترويسة (بمجموع صفري) + البيانات،
 * ثم يُكتب المجموع ويزيد reply_id (مع اللف عند USHRT_MAX).
 * @returns {{packet: Buffer, replyId: number}}
 */
function buildHeader(command, commandString, sessionId, replyId) {
    const cs = commandString ? commandString : Buffer.alloc(0);
    const probe = Buffer.alloc(8 + cs.length);
    probe.writeUInt16LE(command & 0xFFFF, 0);
    probe.writeUInt16LE(0, 2);                   // checksum placeholder
    probe.writeUInt16LE(sessionId & 0xFFFF, 4);
    probe.writeUInt16LE(replyId & 0xFFFF, 6);
    cs.copy(probe, 8);
    const checksum = createChecksum(probe);

    let nextReplyId = replyId + 1;
    if (nextReplyId >= USHRT_MAX) {nextReplyId -= USHRT_MAX;}

    const packet = Buffer.alloc(8 + cs.length);
    packet.writeUInt16LE(command & 0xFFFF, 0);
    packet.writeUInt16LE(checksum & 0xFFFF, 2);
    packet.writeUInt16LE(sessionId & 0xFFFF, 4);
    packet.writeUInt16LE(nextReplyId & 0xFFFF, 6);
    cs.copy(packet, 8);
    return { packet, replyId: nextReplyId };
}

// ─── تغليف TCP ───────────────────────────────────────────────────────────────
/** pack('<HHI', 0x5050, 0x7282, len(packet)) + packet → ترويسة 8 بايت + الحزمة */
function buildTcpTop(packet) {
    const top = Buffer.alloc(8);
    top.writeUInt16LE(MACHINE_PREPARE_DATA_1, 0);
    top.writeUInt16LE(MACHINE_PREPARE_DATA_2, 2);
    top.writeUInt32LE(packet.length, 4);
    return Buffer.concat([top, packet]);
}

/** يُعيد طول الحمولة الكاملة للحزمة (ترويسة ZK 8 بايت + البيانات) أو 0 */
function parseTcpTop(buf) {
    if (!buf || buf.length <= 8) {return 0;}
    if (buf.readUInt16LE(0) !== MACHINE_PREPARE_DATA_1) {return 0;}
    if (buf.readUInt16LE(2) !== MACHINE_PREPARE_DATA_2) {return 0;}
    return buf.readUInt32LE(4);
}

// ─── مفتاح المصادقة (commpro.c - MakeKey) ────────────────────────────────────
/**
 * تشويش كلمة مرور الجهاز + معرف الجلسة لإرسالها في CMD_AUTH.
 * @param {number} key كلمة مرور الجهاز (commkey) 0..65535
 * @param {number} sessionId معرف الجلسة من رد CMD_CONNECT
 */
function makeCommKey(key, sessionId, ticks = 50) {
    key = Number(key) >>> 0;
    sessionId = Number(sessionId) >>> 0;
    // عكس بتات المفتاح على 32 بت
    let k = 0;
    for (let i = 0; i < 32; i++) {
        k = (key & (1 << i)) ? ((k << 1) | 1) : (k << 1);
    }
    k = (k + sessionId) >>> 0;
    const b = Buffer.alloc(4);
    b.writeUInt32LE(k >>> 0, 0);
    // XOR مع 'Z' 'K' 'S' 'O'
    const b0 = b[0] ^ 0x5A, b1 = b[1] ^ 0x4B, b2 = b[2] ^ 0x53, b3 = b[3] ^ 0x4F;
    // تبديل الكلمتين 16-بت: pack('HH', w1, w0)
    const w0 = b0 | (b1 << 8);
    const w1 = b2 | (b3 << 8);
    const c0 = w1 & 0xFF, c1 = (w1 >> 8) & 0xFF, c2 = w0 & 0xFF, c3 = (w0 >> 8) & 0xFF;
    // XOR بالticks (البايت الثالث يصبح B نفسه)
    const B = 0xFF & ticks;
    return Buffer.from([c0 ^ B, c1 ^ B, B, c3 ^ B]);
}

// ─── ترميز/فك الوقت (zkemsdk.c) ──────────────────────────────────────────────
/** فك 4 بايت LE إلى مكونات ساعة الجهاز المحلية (سنة 2000+، شهر×31 يوم) */
function decodeTime(buf, offset = 0) {
    let t = buf.readUInt32LE(offset);
    const second = t % 60; t = Math.floor(t / 60);
    const minute = t % 60; t = Math.floor(t / 60);
    const hour = t % 24;   t = Math.floor(t / 24);
    const day = (t % 31) + 1; t = Math.floor(t / 31);
    const month = (t % 12) + 1; t = Math.floor(t / 12);
    const year = t + 2000;
    return { year, month, day, hour, minute, second };
}

/** فك إلى كائن Date مُفسَّر بتوقيت الجهاز المحلي (offset النظام) */
function decodeTimeToDate(buf, offset = 0) {
    const t = decodeTime(buf, offset);
    return new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
}

/** ترميز Date إلى عدد الثواني بصيغة ZK (لضبط وقت الجهاز) */
function encodeTime(date) {
    return (((date.getFullYear() % 100) * 12 * 31 + ((date.getMonth()) * 31) + (date.getDate() - 1))
        * (24 * 60 * 60)) + ((date.getHours() * 60 + date.getMinutes()) * 60) + date.getSeconds();
}

// ─── تحليل سجلات الحضور (get_attendance) ─────────────────────────────────────
function readNullTerminated(buf, start, size) {
    const end = Math.min(start + size, buf.length);
    let stop = start;
    while (stop < end && buf[stop] !== 0) {stop++;}
    // إزالة محارف الاستبدال � الناتجة عن قطع الجهاز للأسماء العربية
    // mid-character (حقل الاسم 24 بايت فقط والحرف العربي بايتان)
    return buf.subarray(start, stop).toString('utf8').replace(/�/g, '');
}

/**
 * تحليل مخزن سجلات الحضور كما يعيده readWithBuffer(CMD_ATTLOG_RRQ).
 * أول 4 بايت = الحجم المنطقي الكلي، وستريد السجل = الحجم / عدد السجلات.
 * @param {Buffer} data
 * @param {number} expectedRecords عدد السجلات من readSizes (0 → اكتشاف تلقائي)
 * @param {Array<{uid:number,userId:string}>} [users] مستخدمو الجهاز (لنمط 8 بايت)
 */
function parseAttendanceLogs(data, expectedRecords, users = []) {
    if (!data || data.length < 4) {return [];}
    const totalSize = data.readUInt32LE(0);
    const body = data.subarray(4);
    const records = [];
    if (totalSize <= 0 || body.length < 8) {return records;}

    let stride = expectedRecords > 0 ? Math.round(totalSize / expectedRecords) : 0;
    if (![8, 16, 40].includes(stride)) {
        // اكتشاف عملي: بعض الفيرمويرات لا يطابق القسمة — جرّب الأنماط المعروفة
        if (body.length % 40 === 0) {stride = 40;}
        else if (body.length % 16 === 0) {stride = 16;}
        else {stride = 8;}
    }
    const userByUid = new Map(users.map(u => [Number(u.uid), u]));

    // كشف تكيفي لفيرموير MB20-VL على نمط 40 بايت: بعض الأجهزة تضع طريقة التحقق
    // (1 بصمة / 15 وجه) في البايت 26 والحالة (0-5) في البايت 31 بدل توزيع pyzk
    // الرسمي (الحالة@26). نفعّل التفسير البديل فقط إذا كانت الدفعة كلها (≥4 سجلات)
    // تطابق بصمة الفيرموير بدقة — وإلا بقينا على المواصفة الرسمية.
    let mb20Quirk = false;
    if (stride === 40 && body.length / 40 >= 4) {
        mb20Quirk = true;
        for (let off = 0; off + 40 <= body.length; off += 40) {
            const b26 = body[off + 26], b31 = body[off + 31];
            if (!([1, 15].includes(b26) && b31 >= 0 && b31 <= 5)) { mb20Quirk = false; break; }
        }
    }

    for (let off = 0; off + stride <= body.length; off += stride) {
        const row = body.subarray(off, off + stride);
        let deviceUserId, uid = null;
        let timeBuf, status, punch, verify = null;
        if (stride === 8) {
            // <HB4sB — uid يشير لجدول المستخدمين
            uid = row.readUInt16LE(0);
            status = row[2];
            timeBuf = row.subarray(3, 7);
            punch = row[7];
            const u = userByUid.get(uid);
            deviceUserId = u ? String(u.userId) : String(uid);
        } else if (stride === 16) {
            // <I4sBB2sI
            deviceUserId = String(row.readUInt32LE(0));
            timeBuf = row.subarray(4, 8);
            status = row[8];
            punch = row[9];
        } else if (mb20Quirk) {
            // فيرموير MB20-VL: البايت 26 = طريقة التحقق (1 بصمة / 15 وجه) والحالة في 31
            uid = row.readUInt16LE(0);
            deviceUserId = readNullTerminated(row, 2, 24);
            verify = row[26];
            timeBuf = row.subarray(27, 31);
            status = row[31];
            punch = row[31];
        } else {
            // <H24sB4sB8s — pyzk الرسمي: الحالة (0-5 حضور/انصراف) في البايت 26 والانصراف/التحقق في 31
            uid = row.readUInt16LE(0);
            deviceUserId = readNullTerminated(row, 2, 24);
            timeBuf = row.subarray(27, 31);
            status = row[26];
            punch = row[31];
        }
        if (!deviceUserId) {continue;}
        const t = decodeTime(timeBuf, 0);
        // حماية من تواريخ فاسدة: قراءة منحرفة للبروتوكول قد تنتج سنوات مستقبلية
        // (شوهد 2055-2062) فتسمم نقطة التفتيش وتوقف المزامنة — السنة المقبولة حتى السنة القادمة فقط
        if (t.year < 2000 || t.year > new Date().getFullYear() + 1) {continue;}
        records.push({
            deviceUserId,
            uid,
            // مكونات ساعة الجهاز المحلية هي المرجع (توقيت العمل Asia/Riyadh)
            wall: t,
            // لحظة زمنية موحّدة مفسَّرة كـ UTC داخليًا (المحرك يحوّلها إلى
            // لحظة حقيقية بإزاحة توقيت العمل — بلا اعتماد على توقيت الخادم)
            timestamp: new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)),
            status: status & 0xFF,
            punch: punch & 0xFF,
            verifyType: verify != null ? verify & 0xFF : 1,
        });
    }
    return records;
}

// ─── تحليل المستخدمين (get_users) ────────────────────────────────────────────
/**
 * تحليل مخزن المستخدمين كما يعيده readWithBuffer(CMD_USERTEMP_RRQ, FCT_USER).
 * @returns {Array<{uid:number,userId:string,name:string,privilege:number,card:number,groupId:string}>}
 */
function parseUsers(data, expectedUsers) {
    if (!data || data.length < 4) {return [];}
    const totalSize = data.readUInt32LE(0);
    const body = data.subarray(4);
    const users = [];
    if (totalSize <= 0 || body.length < 28) {return users;}
    let stride = expectedUsers > 0 ? Math.round(totalSize / expectedUsers) : 0;
    if (stride !== 28 && stride !== 72) {stride = body.length % 72 === 0 ? 72 : 28;}

    for (let off = 0; off + stride <= body.length; off += stride) {
        const row = body.subarray(off, off + stride);
        let user;
        if (stride === 28) {
            user = {
                uid: row.readUInt16LE(0),
                privilege: row[2],
                password: readNullTerminated(row, 3, 5),
                name: readNullTerminated(row, 8, 8),
                card: row.readUInt32LE(16),
                groupId: String(row.readInt16LE(22)),
                userId: String(row.readUInt32LE(24)),
            };
        } else {
            user = {
                uid: row.readUInt16LE(0),
                privilege: row[2],
                password: readNullTerminated(row, 3, 8),
                name: readNullTerminated(row, 11, 24).trim(),
                card: row.readUInt32LE(35),
                groupId: readNullTerminated(row, 40, 7).trim(),
                userId: readNullTerminated(row, 48, 24),
            };
        }
        if (!user.userId) {continue;}
        if (!user.name) {user.name = `NN-${user.userId}`;}
        users.push(user);
    }
    return users;
}

/** تحليل قيمة خيار التكوين 'key=value\0' كما في get_serialnumber */
function parseOptionValue(data) {
    if (!data) {return '';}
    const text = data.toString('latin1');
    const eq = text.indexOf('=');
    const raw = (eq >= 0 ? text.slice(eq + 1) : text);
    return raw.split('\0')[0].replace(/=/g, '').trim();
}

/** أول سلسلة نصية حتى NULL (لإصدار الفيرموير) */
function parseNullTerminatedString(data) {
    if (!data) {return '';}
    const zero = data.indexOf(0);
    return (zero >= 0 ? data.subarray(0, zero) : data).toString('utf8').trim();
}

module.exports = {
    CMD_CONNECT, CMD_EXIT, CMD_ENABLEDEVICE, CMD_DISABLEDEVICE, CMD_RESTART,
    CMD_GET_VERSION, CMD_CHANGE_SPEED, CMD_AUTH, CMD_OPTIONS_RRQ,
    CMD_USERTEMP_RRQ, CMD_ATTLOG_RRQ, CMD_GET_FREE_SIZES, CMD_GET_TIME, CMD_SET_TIME,
    CMD_BUFFER_RDQ, CMD_CHUNK_RDQ, CMD_FREE_DATA,
    CMD_ACK_OK, CMD_ACK_ERROR, CMD_ACK_DATA, CMD_ACK_UNAUTH,
    CMD_PREPARE_DATA, CMD_DATA,
    MACHINE_PREPARE_DATA_1, MACHINE_PREPARE_DATA_2, USHRT_MAX,
    PUNCH_STATE_NAMES, VERIFY_TYPE_NAMES, CHECK_IN_STATES, CHECK_OUT_STATES,
    FCT_USER: 5,
    createChecksum, buildHeader, buildTcpTop, parseTcpTop,
    makeCommKey, decodeTime, decodeTimeToDate, encodeTime,
    parseAttendanceLogs, parseUsers, parseOptionValue, parseNullTerminatedString,
};
