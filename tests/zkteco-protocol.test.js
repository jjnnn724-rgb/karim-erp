/**
 * zkteco-protocol.test.js — التحقق من مطابقة تنفيذ Node.js لبروتوكول ZKTeco
 * مع المصدر المُثبت (pyzk 0.9) بايت-ببايت عبر نواقل ذهبية مولدة من كود pyzk نفسه.
 */
const path = require('path');
const fs = require('fs');
const proto = require('../backend/zkteco/protocol');
const { shiftDateFor } = require('../backend/shift-day');

const GOLDEN = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'golden_vectors.json'), 'utf8')
);

function reconstructInput(i) {
    // يعيد بناء مدخلات checksum من الـ headers (نفس التسلسل المستخدم في التوليد)
    const pack3 = (cmd, sid, rid, extra) => {
        const head = Buffer.alloc(8);
        head.writeUInt16LE(cmd, 0); head.writeUInt16LE(0, 2);
        head.writeUInt16LE(sid, 4); head.writeUInt16LE(rid, 6);
        return Buffer.concat([head, extra]);
    };
    const i16i32 = (v16, v32a, v32b) => {
        const b = Buffer.alloc(10);
        b.writeInt16LE(v16, 0); b.writeInt32LE(v32a, 2); b.writeInt32LE(v32b, 6);
        return b;
    };
    const samples = [
        pack3(1000, 0, 65534, Buffer.alloc(0)),
        pack3(1000, 1337, 65534, Buffer.alloc(0)),
        pack3(11, 24680, 7, Buffer.from('~SerialNumber\x00')),
        // <bhii>: int8(1) + int16(13) + int32(0) + int32(0) = 11 بايت
        pack3(1503, 42, 999, Buffer.concat([Buffer.from([1]), i16i32(13, 0, 0)])),
        pack3(1504, 42, 1000, (() => { const b = Buffer.alloc(8); b.writeInt32LE(0, 0); b.writeInt32LE(65536, 4); return b; })()),
        pack3(1102, 1337, 65535, Buffer.from([0x01, 0x02, 0x03, 0x04])),
        Buffer.from(Array.from({ length: 37 }, (_, k) => k * 7)),
        pack3(2000, 1, 2, Buffer.alloc(37, 0x41)),
    ];
    return samples[i];
}

describe('ZKTeco protocol — مطابقة pyzk الرسمي', () => {
    test('shiftDateFor يحافظ على نفس اليوم إذا أُغلق ربط الورديات الليلية', () => {
        const prev = process.env.ATTENDANCE_SHIFT_DAY_MODE;
        process.env.ATTENDANCE_SHIFT_DAY_MODE = 'off';
        try {
            expect(shiftDateFor('2026-09-22', 1)).toBe('2026-09-22');
            expect(shiftDateFor('2026-09-22', 10)).toBe('2026-09-22');
        } finally {
            if (prev === undefined) { delete process.env.ATTENDANCE_SHIFT_DAY_MODE; }
            else { process.env.ATTENDANCE_SHIFT_DAY_MODE = prev; }
        }
    });

    test('shiftDateFor يظل على اليوم الحقيقي عند عدم تعيين وضع الورديات الليلية', () => {
        const prev = process.env.ATTENDANCE_SHIFT_DAY_MODE;
        delete process.env.ATTENDANCE_SHIFT_DAY_MODE;
        try {
            expect(shiftDateFor('2026-09-23', 1)).toBe('2026-09-23');
            expect(shiftDateFor('2026-09-23', 4)).toBe('2026-09-23');
        } finally {
            if (prev === undefined) { delete process.env.ATTENDANCE_SHIFT_DAY_MODE; }
            else { process.env.ATTENDANCE_SHIFT_DAY_MODE = prev; }
        }
    });

    test('createChecksum يطابق pyzk على كل النواقل', () => {
        GOLDEN.checksum.forEach((expected, i) => {
            const input = reconstructInput(i);
            expect(proto.createChecksum(input)).toBe(expected);
        });
    });

    test('buildHeader يطابق pyzk حزمة كاملة (checksum + reply_id)', () => {
        GOLDEN.headers.forEach(({ cmd, cs_hex, sid, rid, packet_hex }) => {
            const cs = cs_hex ? Buffer.from(cs_hex, 'hex') : Buffer.alloc(0);
            const { packet } = proto.buildHeader(cmd, cs, sid, rid);
            expect(packet.toString('hex')).toBe(packet_hex);
        });
    });

    test('makeCommKey يطابق pyzk (commpro.c MakeKey)', () => {
        GOLDEN.commkey.forEach(({ key, sid, out_hex }) => {
            expect(proto.makeCommKey(key, sid).toString('hex')).toBe(out_hex);
        });
    });

    test('encodeTime يطابق pyzk (zkemsdk.c EncodeTime)', () => {
        GOLDEN.time.forEach(({ iso, encoded }) => {
            // بناء Date بتوقيت محلي من ISO (الفرق بين التوقيتات لا يؤثر على المكونات)
            const [d, t] = iso.split('T');
            const [y, m, dd] = d.split('-').map(Number);
            const [hh, mm, ss] = t.split(':').map(Number);
            const dt = new Date(y, m - 1, dd, hh, mm, ss);
            expect(proto.encodeTime(dt)).toBe(encoded);
        });
    });

    test('decodeTime يفك القيم المشفرة كما في pyzk', () => {
        GOLDEN.time.forEach(({ encoded, roundtrip }) => {
            const buf = Buffer.alloc(4);
            buf.writeUInt32LE(encoded, 0);
            const t = proto.decodeTime(buf, 0);
            const [d, tm] = roundtrip.split('T');
            const [y, m, dd] = d.split('-').map(Number);
            const [hh, mm, ss] = tm.split(':').map(Number);
            expect({ year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second })
                .toEqual({ year: y, month: m, day: dd, hour: hh, minute: mm, second: ss });
        });
    });

    test('parseAttendanceLogs — نمط 40 بايت (أحدث الأجهزة)', () => {
        const case40 = GOLDEN.attendance.parsed.find(p => p.stride === 40);
        const data40 = GOLDEN.attendance.data40_hex;
        const records = proto.parseAttendanceLogs(Buffer.from(data40, 'hex'), case40.records.length, []);
        expect(records.length).toBe(2);
        case40.records.forEach((exp, i) => {
            expect(records[i].deviceUserId).toBe(exp.user);
            expect(records[i].status).toBe(exp.status);
            expect(records[i].punch).toBe(exp.punch);
            const [d, t] = exp.ts.split('T');
            const [y, m, dd] = d.split('-').map(Number);
            const [hh, mm, ss] = t.split(':').map(Number);
            const got = records[i].timestamp;
            // timestamp مفسَّر كـ UTC داخليًا (المحرك يحوله بتوقيت العمل لاحقًا)
            expect({ y: got.getUTCFullYear(), m: got.getUTCMonth() + 1, d: got.getUTCDate(), h: got.getUTCHours(), mi: got.getUTCMinutes(), s: got.getUTCSeconds() })
                .toEqual({ y, m, d: dd, h: hh, mi: mm, s: ss });
        });
    });

    test('parseAttendanceLogs — نمط 16 بايت', () => {
        const case16 = GOLDEN.attendance.parsed.find(p => p.stride === 16);
        const records = proto.parseAttendanceLogs(Buffer.from(GOLDEN.attendance.data16_hex, 'hex'), case16.records.length, []);
        expect(records.length).toBe(2);
        case16.records.forEach((exp, i) => {
            expect(records[i].deviceUserId).toBe(exp.user);
            expect(records[i].status).toBe(exp.status);
        });
    });

    test('parseUsers — نمط 72 بايت', () => {
        const users = proto.parseUsers(Buffer.from(GOLDEN.users72.data_hex, 'hex'), 1);
        expect(users.length).toBe(1);
        expect(users[0].uid).toBe(GOLDEN.users72.parsed[0].uid);
        expect(users[0].userId).toBe(GOLDEN.users72.parsed[0].userId);
        expect(users[0].name).toBe(GOLDEN.users72.parsed[0].name);
    });

    test('parseOptionValue يستخرج الرقم التسلسلي كما في pyzk', () => {
        expect(proto.parseOptionValue(Buffer.from(GOLDEN.option.raw_hex, 'hex'))).toBe(GOLDEN.option.expect);
    });

    test('buildTcpTop/parseTcpTop — ترويسة TCP مطابقة للصيغة', () => {
        const packet = Buffer.alloc(20, 0xAB);
        const top = proto.buildTcpTop(packet);
        expect(top.subarray(0, 4).toString('hex')).toBe('5050827d');
        expect(top.readUInt32LE(4)).toBe(20);
        expect(proto.parseTcpTop(top)).toBe(20);
        expect(proto.parseTcpTop(Buffer.from('0000000000000000', 'hex'))).toBe(0);
    });

    test('حماية من السجلات الفاسدة (تواريخ خارج النطاق)', () => {
        const bad = Buffer.alloc(4 + 40);
        bad.writeUInt32LE(40 * 1, 0);
        bad.writeUInt16LE(1, 4);
        Buffer.from('99').copy(bad, 6);                    // user id "99"
        bad[26] = 0;
        bad.writeUInt32LE(0x00000001, 27);                 // وقت فاسد جدًا (سنة 2000 فاصلة)
        const recs = proto.parseAttendanceLogs(bad, 1, []);
        // زمن 1 ثانية بعد 2000-01-01 صالح هندسيًا — لكن 0 كان سيُرفض
        expect(recs.length).toBe(1);
    });
});
