// .env قد يحمل ATTENDANCE_DELAY_ENGINE=false (إنتاج) — ثبّت السلوك المختبر هنا
process.env.ATTENDANCE_DELAY_ENGINE = 'true';
/**
 * tests/whatsapp-engine.test.js — وحدات محرك واتساب (منطق نقي بلا شبكة/قاعدة)
 */
'use strict';

const {
    normalizeText, matchRule, firstMatch,
    isValidChatJid, isGroupJid, isLidJid, phoneDigitsOf, extractText, backoffDelayMs,
    parseSchedule, scheduleAllowance, bulkFrozen, humanGapMs, bodyHash,
} = require('../backend/whatsapp-engine/rules');
const { validateConfig } = require('../backend/whatsapp-engine/config');
const { buildMediaPayload } = require('../backend/whatsapp-engine/sender');
const { parseQuestion, formatAttendanceEntrySummary } = require('../backend/whatsapp-engine/system-query');
const { Analytics } = require('../backend/whatsapp-engine/analytics');
const { normalizeEmployeeCode, normalizeDepartmentCode, calculateDelayParts } = require('../backend/shift-day');

describe('whatsapp normalizeText', () => {
    test('يوحد الهمزات والتاء والمسافات', () => {
        expect(normalizeText('  السّلامُ   عليكم  ')).toBe('السلام عليكم');
        expect(normalizeText('مساعدة')).toBe('مساعده');
        expect(normalizeText('HELLO')).toBe('hello');
        expect(normalizeText(null)).toBe('');
    });
});

describe('whatsapp matchRule', () => {
    test('exact يطابق بعد التطبيع', () => {
        expect(matchRule({ match_type: 'exact', pattern: 'مساعدة' }, 'مساعده')).toBeTruthy();
        expect(matchRule({ match_type: 'exact', pattern: 'مساعدة' }, 'مساعدة الآن')).toBeNull();
    });
    test('contains', () => {
        expect(matchRule({ match_type: 'contains', pattern: 'طلب' }, 'حالة طلب 5')).toBeTruthy();
    });
    test('command يفصل الوسائط', () => {
        const hit = matchRule({ match_type: 'command', pattern: 'حالة طلب' }, 'حالة طلب 1234');
        expect(hit && hit.args).toBe('1234');
        expect(matchRule({ match_type: 'command', pattern: 'حالة طلب' }, 'حالة طلبية')).toBeNull();
    });
    test('firstMatch يحترم الأولوية والتعطيل', () => {
        const rules = [
            { name: 'off', match_type: 'exact', pattern: 'x', response: '', enabled: false },
            { name: 'a', match_type: 'exact', pattern: 'x', response: 'A' },
        ];
        expect(firstMatch(rules, 'x').rule.name).toBe('a');
    });
});

describe('whatsapp JID', () => {
    test('خاص ومجموعة صالحان', () => {
        expect(isValidChatJid('966500000000@s.whatsapp.net')).toBe(true);
        expect(isValidChatJid('123456@g.us')).toBe(true);
        expect(isGroupJid('123456@g.us')).toBe(true);
        expect(isGroupJid('966500000000@s.whatsapp.net')).toBe(false);
    });
    test('مرفوض: بث/قنوات/صيغ غريبة', () => {
        expect(isValidChatJid('status@broadcast')).toBe(false);
        expect(isValidChatJid('abc@s.whatsapp.net')).toBe(false);
        expect(isValidChatJid('')).toBe(false);
        expect(isValidChatJid(null)).toBe(false);
    });
    test('v7: عناوين LID مقبولة', () => {
        expect(isValidChatJid('181235640963145@lid')).toBe(true);
        expect(isLidJid('181235640963145@lid')).toBe(true);
        expect(isLidJid('9665@s.whatsapp.net')).toBe(false);
        expect(phoneDigitsOf('181235640963145@lid')).toBe('181235640963145');
        expect(phoneDigitsOf('966560229281:12@s.whatsapp.net')).toBe('966560229281');
    });
});

describe('whatsapp extractText', () => {
    test('نص عادي وممتد', () => {
        expect(extractText({ message: { conversation: 'hi' } })).toBe('hi');
        expect(extractText({ message: { extendedTextMessage: { text: 'yo' } } })).toBe('yo');
    });
    test('حمولة تالفة/بلا نص', () => {
        expect(extractText(null)).toBe('');
        expect(extractText({ message: { imageMessage: {} } })).toBe('');
        expect(extractText({})).toBe('');
    });
});

describe('whatsapp backoffDelayMs', () => {
    const fixed = () => 0.5; // jitter صفري للتحديدية
    test('أسي محدود بالسقف', () => {
        expect(backoffDelayMs(1, 2000, 60000, fixed)).toBe(2000);
        expect(backoffDelayMs(3, 2000, 60000, fixed)).toBe(8000);
        expect(backoffDelayMs(99, 2000, 60000, fixed)).toBe(60000);
    });
    test('jitter ضمن ±20%', () => {
        const v = backoffDelayMs(2, 1000, 60000, () => 1);
        expect(v).toBeGreaterThanOrEqual(2000 * 0.99);
        expect(v).toBeLessThanOrEqual(2000 * 1.21);
    });
});

describe('whatsapp anti-ban pacing', () => {
    test('parseSchedule يتجاهل الفاسد', () => {
        expect(parseSchedule('20,40,xx,80')).toEqual([20, 40, 80]);
        expect(parseSchedule('')).toEqual([20]);
        expect(parseSchedule('5')).toEqual([5]);
    });
    test('scheduleAllowance: أول عنصر لليوم 1 والأخير سقف دائم', () => {
        const s = [20, 40, 80];
        expect(scheduleAllowance(s, 1)).toBe(20);
        expect(scheduleAllowance(s, 2)).toBe(40);
        expect(scheduleAllowance(s, 99)).toBe(80);
        expect(scheduleAllowance(s, 0)).toBe(20);
    });
    test('bulkFrozen: نفس النص لجهات مميزة ≥ الحد داخل النافذة', () => {
        const now = 1_000_000;
        const mk = (jid, at) => ({ hash: 'bX', jid, at });
        const recent = [mk('a', now - 1000), mk('b', now - 2000), mk('a', now - 3000)];
        expect(bulkFrozen(recent, 'bX', now, 600000, 3)).toBe(false); // جهتان فقط
        expect(bulkFrozen([...recent, mk('c', now - 4000)], 'bX', now, 600000, 3)).toBe(true);
        expect(bulkFrozen(recent, 'bY', now, 600000, 2)).toBe(false); // بصمة مختلفة
        expect(bulkFrozen([mk('a', now - 9999999)], 'bX', now, 60000, 1)).toBe(false); // خارج النافذة (والحد 1 مرفوض)
    });
    test('humanGapMs: حد أدنى + jitter', () => {
        expect(humanGapMs(3000, 0, () => 0.99)).toBe(3000);
        const v = humanGapMs(3000, 2000, () => 0.5);
        expect(v).toBe(4000);
    });
    test('bodyHash مستقر ويتجاهل الأرقام والمسافات', () => {
        expect(bodyHash('عرض 100 ريال')).toBe(bodyHash('عرض  200 ريال'));
        expect(bodyHash('صباح الخير')).not.toBe(bodyHash('مساء الخير'));
    });
});

describe('whatsapp validateConfig', () => {
    const good = () => ({
        enabled: false, sessionDir: 'C:/KarimData/whatsapp-sessions', logLevel: 'info',
        reconnectBaseDelayMs: 2000, reconnectMaxDelayMs: 60000,
    });
    test('يقبل الصالح', () => { expect(validateConfig(good())).toBe(true); });
    test('يرفض المستوى والمدد المقلوبة', () => {
        expect(() => validateConfig({ ...good(), logLevel: 'verbose' })).toThrow('WHATSAPP_CONFIG_INVALID');
        expect(() => validateConfig({ ...good(), reconnectBaseDelayMs: 99999 })).toThrow('WHATSAPP_CONFIG_INVALID');
        expect(() => validateConfig({ ...good(), sessionDir: '' })).toThrow('WHATSAPP_CONFIG_INVALID');
    });
});

describe('whatsapp media safety', () => {
    test('allows HTTPS media URLs', () => {
        const payload = buildMediaPayload({ media_type: 'image', media_path: 'https://example.com/image.jpg', caption: 'test' });
        expect(payload.image).toEqual({ url: 'https://example.com/image.jpg' });
    });

    test('rejects local media outside the configured media directory', () => {
        expect(() => buildMediaPayload(
            { media_type: 'document', media_path: 'C:/Windows/System32/config/SAM' },
            { mediaDir: 'C:/KarimData/whatsapp-media' }
        )).toThrow('MEDIA_PATH_FORBIDDEN');
    });
});

describe('employee normalization and delay logic', () => {
    test('normalizes irregular employee codes to EMP-XXX', () => {
        expect(normalizeEmployeeCode('EMP-063')).toBe('EMP-063');
        expect(normalizeEmployeeCode('63')).toBe('EMP-063');
        expect(normalizeEmployeeCode('EMP131')).toBe('EMP-131');
        expect(normalizeEmployeeCode(' emp 137 ')).toBe('EMP-137');
    });

    test('normalizes department aliases to canonical external sales label', () => {
        expect(normalizeDepartmentCode('اسيوارد')).toBe('steward');
        expect(normalizeDepartmentCode('استيوارد')).toBe('steward');
        expect(normalizeDepartmentCode('استيورد')).toBe('steward');
        expect(normalizeDepartmentCode('البيع الخارجي')).toBe('ys_b4_ext');
    });

    test('counts only actual late minutes, not early-leave minutes as delay', () => {
        const row = { checkIn: '09:35', checkOut: '17:30' };
        const employee = { shift_start: '09:00', shift_karim: 8 };
        const parts = calculateDelayParts(row, employee);
        expect(parts.arrivalLateMinutes).toBe(35);
        expect(parts.earlyLeaveMinutes).toBe(0);
        expect(parts.lateMinutes).toBe(35);
    });
});

describe('whatsapp ERP understanding and analytics', () => {
    test('recognizes Arabic questions across core ERP modules', () => {
        expect(parseQuestion('كم الإيرادات وحالة المخزون اليوم').categories.map((x) => x.category)).toEqual(expect.arrayContaining(['revenue', 'inventory']));
        expect(parseQuestion('حضور أحمد 12/9').categories[0].category).toBe('attendance');
        expect(parseQuestion('عدد الموظفين').categories[0].category).toBe('employees');
    });

    test('builds controlled ERP intents for attendance and revenue live queries', () => {
        const revenueIntent = parseQuestion('إيرادات أمس');
        expect(revenueIntent.intent).toBe('REVENUE_QUERY');
        expect(revenueIntent.scope).toBe('DAILY');
        expect(revenueIntent.date_from).toBeTruthy();
        expect(revenueIntent.date_to).toBeTruthy();

        const attendanceIntent = parseQuestion('حضور الموظف 125 بتاريخ 20/09/2026');
        expect(attendanceIntent.intent).toBe('ATTENDANCE_QUERY');
        expect(attendanceIntent.employeeId).toBe('125');
        expect(attendanceIntent.date_from).toMatch(/2026-09-20/);
        expect(attendanceIntent.date_to).toMatch(/2026-09-20/);

        const employeeNameIntent = parseQuestion('دخول وخروج أحمد اليوم');
        expect(employeeNameIntent.intent).toBe('ATTENDANCE_QUERY');
        expect(employeeNameIntent.employee).toContain('أحمد');
        expect(employeeNameIntent.include_check_in).toBe(true);
        expect(employeeNameIntent.include_check_out).toBe(true);
    });

    test('formats the exact employee check-in time for attendance lookups', () => {
        const text = formatAttendanceEntrySummary({
            employeeName: 'أحمد',
            date: '2026-09-24',
            checkIn: '08:30',
            checkOut: '17:00',
            shift_start: '09:00',
            late: true,
        });
        expect(text).toContain('أحمد');
        expect(text).toContain('08:30');
        expect(text).toContain('17:00');
        expect(text).toMatch(/دخول|check in/i);
    });

    test('analytics cache can be cleared between reporting windows', () => {
        const analytics = new Analytics();
        analytics._cache.set('test', { data: { ok: true }, ts: Date.now() });
        analytics.clearCache();
        expect(analytics._cache.size).toBe(0);
    });
});
