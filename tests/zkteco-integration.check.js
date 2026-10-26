/**
 * zkteco-integration.check.js — اختبار تكامل شامل من طرف إلى طرف
 * ────────────────────────────────────────────────────────────────────────────
 * يشغّل جهاز ZKTeco محاكى (يتحدث نفس البروتوكول على sockets حقيقية)
 * + المحرك الفعلي داخل ERP على قاعدة PostgreSQL الحية:
 *   1) مصافحة + مصادقة commkey خاطئ/صحيح
 *   2) قراءة هوية الجهاز (تسلسلي/فيرموير/اسم)
 *   3) مزامنة كاملة: بصمات → attendance_logs (idempotent) → ربط موظفين
 *      → ملء attendance (fill-only) → نقطة تفتيش لا ترجع للخلف
 *   4) صفر تعارض: سجل يدوي موجود لا يُمس — الجهاز يملأ الانصراف فقط
 *   5) إعادة المزامنة لا تكرر شيئًا
 *
 * التشغيل: node tests/zkteco-integration.check.js
 */
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME = process.env.DB_NAME || 'karim_erp';
process.env.DB_USER = process.env.DB_USER || 'postgres';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'karim_local_preview_2026_secure_password';

const net = require('net');
const { ZKClient } = require('../backend/zkteco/client');
const proto = require('../backend/zkteco/protocol');
const { AttendanceSyncEngine, matchUserToEmployee } = require('../backend/zkteco/engine');
const { ensureZktecoSchema } = require('../backend/zkteco/schema');
const { pool } = require('../backend/shared-pool');

// ───────────────────────────── جهاز ZKTeco محاكى ─────────────────────────────
class FakeZKDevice {
    constructor({ port = 0, commKey = 0, users = [], attendance = [], requireAuth = true } = {}) {
        this.port = port;
        this.commKey = commKey;
        this.users = users;              // {uid, userId, name}
        this.attendance = attendance;    // {uid, userId, status, ts(Date), punch}
        this.requireAuth = requireAuth;
        this.sessionId = 0x1234;
        this.server = null;
        this.stats = { connects: 0, reads: 0 };
    }

    encodeAttendancePayload() {
        // نمط 40 بايت + بادئة الحجم المنطقي
        const rows = this.attendance.map(a => {
            const t = proto.encodeTime(a.ts);
            const tb = Buffer.alloc(4); tb.writeUInt32LE(t, 0);
            const ub = Buffer.from(String(a.userId), 'utf8').subarray(0, 24);
            const row = Buffer.alloc(40);
            row.writeUInt16LE(a.uid, 0);
            ub.copy(row, 2);
            row[26] = a.status;
            tb.copy(row, 27);
            row[31] = a.punch || 0;
            return row;
        });
        const body = Buffer.concat(rows);
        const size = Buffer.alloc(4);
        size.writeUInt32LE(40 * rows.length, 0);
        return Buffer.concat([size, body]);
    }

    encodeUsersPayload() {
        // نمط 72 بايت + بادئة الحجم
        const rows = this.users.map(u => {
            const row = Buffer.alloc(72);
            row.writeUInt16LE(u.uid, 0);
            row[2] = u.privilege || 0;
            Buffer.from('0000').copy(row, 3);
            Buffer.from(String(u.name || ''), 'utf8').subarray(0, 24).copy(row, 11);
            row.writeUInt32LE(0, 35);
            Buffer.from('G1').copy(row, 40);
            Buffer.from(String(u.userId), 'utf8').subarray(0, 24).copy(row, 48);
            return row;
        });
        const body = Buffer.concat(rows);
        const size = Buffer.alloc(4);
        size.writeUInt32LE(72 * rows.length, 0);
        return Buffer.concat([size, body]);
    }

    buildFrame(zkPacket) { return proto.buildTcpTop(zkPacket); }

    reply(socket, received, cmd, data, { sessionOverride } = {}) {
        const rid = received.readUInt16LE(6);
        const sid = sessionOverride !== undefined ? sessionOverride : received.readUInt16LE(4);
        const resp = Buffer.alloc(8 + (data ? data.length : 0));
        resp.writeUInt16LE(cmd, 0);
        resp.writeUInt16LE(0, 2);            // الجهاز الحقيقي يرسل checksum صحيحًا؛ عميلنا لا يتحقق منه (كما pyzk)
        resp.writeUInt16LE(sid, 4);
        resp.writeUInt16LE(rid, 6);
        if (data) {data.copy(resp, 8);}
        socket.write(this.buildFrame(resp));
    }

    start() {
        return new Promise((resolve) => {
            this.server = net.createServer((socket) => {
                let buf = Buffer.alloc(0);
                socket.on('data', (chunk) => {
                    buf = Buffer.concat([buf, chunk]);
                    for (;;) {
                        if (buf.length < 8) {return;}
                        const len = proto.parseTcpTop(buf);
                        if (len <= 0) { buf = Buffer.alloc(0); return; }
                        if (buf.length < 8 + len) {return;}
                        const pkt = buf.subarray(8, 8 + len);
                        buf = buf.subarray(8 + len);
                        this.handle(socket, pkt);
                    }
                });
            });
            this.server.listen(this.port, '127.0.0.1', () => {
                this.port = this.server.address().port;
                resolve(this.port);
            });
        });
    }

    handle(socket, pkt) {
        const cmd = pkt.readUInt16LE(0);
        const data = pkt.subarray(8);
        switch (cmd) {
            case proto.CMD_CONNECT: {
                this.stats.connects += 1;
                if (this.requireAuth && this.commKey > 0) {
                    this.reply(socket, pkt, proto.CMD_ACK_UNAUTH, null, { sessionOverride: this.sessionId });
                } else {
                    this.reply(socket, pkt, proto.CMD_ACK_OK, null, { sessionOverride: this.sessionId });
                }
                break;
            }
            case proto.CMD_AUTH: {
                const expected = proto.makeCommKey(this.commKey, this.sessionId);
                const ok = data.length === 4 && data.equals(expected);
                this.reply(socket, pkt, ok ? proto.CMD_ACK_OK : proto.CMD_ACK_UNAUTH, null);
                break;
            }
            case proto.CMD_GET_VERSION:
                this.reply(socket, pkt, proto.CMD_ACK_OK, Buffer.from('Ver8.0.4.7-2026SIM\x00'));
                break;
            case proto.CMD_OPTIONS_RRQ: {
                const key = data.toString('latin1').replace(/\0/g, '');
                const map = {
                    '~SerialNumber': `~SerialNumber=SIM${this.port}SERIAL\x00`,
                    '~Platform': '~Platform=ZMM220_TJV\x00',
                    '~DeviceName': '~DeviceName=Karim-Sim\x00',
                };
                this.reply(socket, pkt, proto.CMD_ACK_OK, Buffer.from(map[key] || `${key}=\x00`));
                break;
            }
            case proto.CMD_GET_FREE_SIZES: {
                const b = Buffer.alloc(80);
                b.writeInt32LE(0, 0);
                b.writeInt32LE(this.users.length, 4 * 4);       // users
                b.writeInt32LE(this.users.length, 6 * 4);       // fingers
                b.writeInt32LE(this.attendance.length, 8 * 4);  // records
                this.reply(socket, pkt, proto.CMD_ACK_OK, b);
                break;
            }
            case proto.CMD_BUFFER_RDQ: {
                this.stats.reads += 1;
                const fct = data.readInt32LE(3);
                const payload = fct === proto.FCT_USER ? this.encodeUsersPayload() : this.encodeAttendancePayload();
                // سلوك الأجهزة الحقيقية: PREPARE_DATA مع الحجم عند الإزاحة 1
                const prep = Buffer.alloc(5);
                prep[0] = 0;
                prep.writeUInt32LE(payload.length, 1);
                this.reply(socket, pkt, proto.CMD_PREPARE_DATA, prep);
                this._pendingPayload = payload;
                break;
            }
            case proto.CMD_CHUNK_RDQ: {
                const start = data.readInt32LE(0);
                const size = data.readInt32LE(4);
                const slice = this._pendingPayload.subarray(start, Math.min(start + size, this._pendingPayload.length));
                this.reply(socket, pkt, proto.CMD_DATA, slice);
                break;
            }
            case proto.CMD_FREE_DATA:
                this.reply(socket, pkt, proto.CMD_ACK_OK, null);
                this._pendingPayload = null;
                break;
            case proto.CMD_EXIT:
                this.reply(socket, pkt, proto.CMD_ACK_OK, null);
                break;
            default:
                this.reply(socket, pkt, proto.CMD_ACK_OK, null);
        }
    }

    stop() {
        return new Promise((resolve) => this.server ? this.server.close(() => resolve()) : resolve());
    }
}

// ───────────────────────────── سيناريو الاختبار ─────────────────────────────
async function main() {
    let passed = 0, failed = 0;
    const check = (name, cond, extra = '') => {
        if (cond) { passed++; console.log(`  ✓ ${name}`); }
        else { failed++; console.error(`  ✗ ${name} ${extra}`); }
    };

    console.log('═══ 1) تهيئة المخطط على القاعدة الحية ═══');
    await ensureZktecoSchema();
    check('ensureZktecoSchema نجح', true);

    // تنظيف آمن لنطاق الاختبار فقط
    await pool.query(`DELETE FROM attendance_logs WHERE "deviceUserId" LIKE 'SIMTEST%'`);
    await pool.query(`DELETE FROM attendance_devices WHERE name LIKE 'SIM-TEST%'`);
    await pool.query(`DELETE FROM employees WHERE "employeeId" LIKE 'SIMTEST%'`);

    console.log('═══ 2) مصافحة الجهاز المحاكى ═══');
    const device = new FakeZKDevice({
        commKey: 7331,
        users: [
            { uid: 1, userId: 'SIMTEST-1', name: 'موظف محاكاة أول' },
            { uid: 2, userId: 'SIMTEST-2', name: 'موظف محاكاة ثانٍ' },
        ],
        attendance: [
            { uid: 1, userId: 'SIMTEST-1', status: 0, ts: new Date(2026, 8, 10, 8, 12, 0), punch: 0 },
            { uid: 1, userId: 'SIMTEST-1', status: 1, ts: new Date(2026, 8, 10, 17, 5, 0), punch: 0 },
            { uid: 2, userId: 'SIMTEST-2', status: 0, ts: new Date(2026, 8, 10, 9, 0, 0), punch: 0 },
        ],
    });
    const port = await device.start();
    check(`الجهاز المحاكى يستمع على ${port}`, port > 0);

    // مصادقة خاطئة يجب أن تفشل
    const badClient = new ZKClient({ host: '127.0.0.1', port, commKey: 111, timeoutMs: 3000 });
    let badAuthFailed = false;
    try { await badClient.connect(); } catch (e) { badAuthFailed = e.code === 'ZK_UNAUTHENTICATED'; }
    finally { await badClient.disconnect().catch(() => {}); }
    check('commkey خاطئ → رفض مصادقة واضح (ZK_UNAUTHENTICATED)', badAuthFailed);

    // مصادقة صحيحة + هوية
    const client = new ZKClient({ host: '127.0.0.1', port, commKey: 7331, timeoutMs: 4000 });
    await client.connect();
    const identity = await client.readIdentity();
    check('مصافحة ناجحة مع commkey صحيح', true);
    check(`الهوية: serial=${identity.serial} firmware=${identity.firmware}`,
        identity.serial && identity.serial.includes('SERIAL') && identity.firmware.includes('Ver8'));
    const usersFromDevice = await client.getUsers();
    check(`مستخدمو الجهاز: ${usersFromDevice.length} (متوقع 2)`, usersFromDevice.length === 2);
    check('user_id يعود كاملاً (72 بايت)', usersFromDevice[0].userId === 'SIMTEST-1');
    const { records } = await client.getAttendance();
    check(`سجلات الحضور المقروءة: ${records.length} (متوقع 3)`, records.length === 3);
    check('تفكيك user_id عربي/نصي في نمط 40', records[2].deviceUserId === 'SIMTEST-2');
    await client.disconnect();

    console.log('═══ 3) المزامنة الكاملة عبر المحرك (داخل ERP) ═══');
    const engine = new AttendanceSyncEngine();
    // موظفان: الأول مرتبط برقم البصمة مباشرة، والثاني بالرقم الوظيفي فقط (auto-match)
    const empIns = await pool.query(
        `INSERT INTO employees (id, name, "employeeId", "deviceUserId", status)
         VALUES (900000000001, 'موظف بصمة أول', 'SIMTEST-1', 'SIMTEST-1', 'active'),
                (900000000002, 'موظف بصمة ثانٍ', 'SIMTEST-2', NULL, 'active')
         RETURNING id`
    );
    check('موظفان جاهزان (أول مرتبط، ثانٍ بالرقم الوظيفي)', empIns.rows.length === 2);

    const devIns = await pool.query(
        `INSERT INTO attendance_devices (name, "ipAddress", port, "commKey", enabled, "syncIntervalSeconds")
         VALUES ('SIM-TEST-GATE', '127.0.0.1', $1, 7331, true, 30) RETURNING id`,
        [port]
    );
    const deviceId = devIns.rows[0].id;

    const r1 = await engine.syncDeviceById(deviceId);
    check(`مزامنة أولى: قراءة=${r1.read} جديد=${r1.inserted} ربط=${r1.writeBacks}`,
        r1.ok && r1.read === 3 && r1.inserted === 3 && r1.writeBacks === 3);

    const logs1 = await pool.query(
        `SELECT l.*, e.name FROM attendance_logs l LEFT JOIN employees e ON e.id = l."employeeId"
         WHERE l."deviceUserId" LIKE 'SIMTEST%' ORDER BY l."attendanceTime"`
    );
    check('ثلاث بصمات خام مخزنة', logs1.rows.length === 3);
    check('البصمة الأولى مرتبطة عبر deviceUserId', Number(logs1.rows[0].employeeId) === 900000000001);
    check('بصمة الموظف الثاني مرتبطة عبر الرقم الوظيفي (auto-match)', Number(logs1.rows[1].employeeId) === 900000000002);
    const att1 = await pool.query(
        `SELECT * FROM attendance WHERE "employeeId" IN (900000000001, 900000000002) AND date = '2026-09-10' ORDER BY "employeeId"`
    );
    check('صفا حضور يوميان أُنشئا من البصمات', att1.rows.length === 2);
    const e1 = att1.rows.find(a => Number(a.employeeId) === 900000000001);
    check('حضور 08:12 وانصراف 17:05 من الجهاز',
        e1 && e1.checkIn === '08:12' && e1.checkOut === '17:05',
        e1 ? `(فعلي: ${e1.checkIn}-${e1.checkOut})` : '(الصف غير موجود)');
    check('المصدر = device', e1.source === 'device');

    console.log('═══ 4) صفر تعارض: سجل يدوي محمي + الجهاز يملأ الفراغ فقط ═══');
    // موظف ثالث: سجل يدوي بحضور 07:30 — الجهاز سيسجل بصمة حضور 08:00 لاحقًا
    await pool.query(
        `INSERT INTO employees (id, name, "employeeId", status)
         VALUES (900000000003, 'موظف يدوي', 'SIMTEST-3', 'active')`
    );
    await pool.query(
        `INSERT INTO attendance (id, "employeeId", date, "checkIn", late, notes, source)
         VALUES (900000000301, 900000000003, '2026-09-10', '07:30', false, 'تسجيل يدوي من المدير', 'manual')`
    );
    device.attendance.push(
        { uid: 3, userId: 'SIMTEST-3', status: 0, ts: new Date(2026, 8, 10, 8, 0, 0), punch: 0 },
        { uid: 3, userId: 'SIMTEST-3', status: 1, ts: new Date(2026, 8, 10, 16, 30, 0), punch: 0 },
    );
    const r2 = await engine.syncDeviceById(deviceId);
    check(`مزامنة ثانية: جديد=${r2.inserted} (البصمات الجديدة فقط)`, r2.inserted === 2);
    const att2 = await pool.query(`SELECT * FROM attendance WHERE "employeeId" = 900000000003`);
    const manual = att2.rows.find(_a => true);
    check('الحضور اليدوي 07:30 لم يُمس بالبصمة 08:00', manual.checkIn === '07:30' && manual.source === 'manual');
    check('الجهاز ملأ الانصراف فقط (16:30)', manual.checkOut === '16:30');
    check('ملاحظة المصدر في السجل', (manual.notes || '').includes('بصمة'));

    console.log('═══ 5) إعادة المزامنة = صفر تكرار (idempotent) ═══');
    const r3 = await engine.syncDeviceById(deviceId);
    check('مزامنة ثالثة: جديد=0', r3.inserted === 0);
    const logs3 = await pool.query(`SELECT COUNT(*)::int AS c FROM attendance_logs WHERE "deviceUserId" LIKE 'SIMTEST%'`);
    check(`إجمالي البصمات الخام ثابت (5) = ${logs3.rows[0].c}`, logs3.rows[0].c === 5);

    console.log('═══ 6) نقطة التفتيش لا تعود للخلف + إحصاءات ═══');
    const state = await pool.query(`SELECT * FROM device_sync_state WHERE "deviceId" = $1`, [deviceId]);
    check('checkpoint مسجل', state.rows.length === 1 && state.rows[0].lastRecordTime);
    const devRow = await pool.query(`SELECT * FROM attendance_devices WHERE id = $1`, [deviceId]);
    check('حالة الجهاز online والهوية التسلسلية محفوظة',
        devRow.rows[0].status === 'online' && devRow.rows[0].deviceUid && devRow.rows[0].deviceUid.includes('SERIAL'));

    console.log('═══ 7) مطابقة الموظفين (matchUserToEmployee) ═══');
    const m1 = matchUserToEmployee('SIMTEST-1', new Map([['SIMTEST-1', 111]]), new Map());
    const m2 = matchUserToEmployee('SIMTEST-2', new Map(), new Map([['SIMTEST-2', 222]]));
    const m3 = matchUserToEmployee('007', new Map([['7', 333]]), new Map());
    check('تطابق حرفي عبر deviceUserId', m1.employeeId === 111);
    check('تطابق عبر الرقم الوظيفي', m2.employeeId === 222);
    check('تطابق رقمي (007 = 7)', m3.employeeId === 333);

    // تنظيف نطاق الاختبار
    await pool.query(`DELETE FROM attendance_logs WHERE "deviceUserId" LIKE 'SIMTEST%'`);
    await pool.query(`DELETE FROM attendance WHERE "employeeId" IN (900000000001,900000000002,900000000003)`);
    await pool.query(`DELETE FROM device_sync_state WHERE "deviceId" = $1`, [deviceId]);
    await pool.query(`DELETE FROM attendance_devices WHERE id = $1`, [deviceId]);
    await pool.query(`DELETE FROM employees WHERE id IN (900000000001,900000000002,900000000003)`);
    engine.stop();
    await device.stop();
    await pool.end();

    console.log(`\n════════ النتيجة: ${passed} ناجح — ${failed} فاشل ════════`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
