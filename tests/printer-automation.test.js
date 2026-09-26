// ────────────────────────────────────────────────────────────────────────────
// printer-automation.test.js — Task 36 (التسليم): إدارة الطابعات الحرارية
// والطباعة الأوتوماتيكية: الاشتقاق القياسي للمعرفات، التحقق من العناوين،
// التراجع الذكي عن المهام، مخططات zod، بناء شبكة الفحص، فحص TCP حقيقي،
// وسلوك الاختيار على صفوف قاعدة حقيقية مع تنظيف ذاتي.
// ────────────────────────────────────────────────────────────────────────────
const net = require('net');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
    kindOfPrinterId,
    resolvePrinterId,
    normalizeNetworkAddress,
    normalizeShareAddress,
    validatePrinterAddress,
    pickPrinterForJob,
    printerRegistrationSchema,
    printerUpdateSchema,
    buildSubnetHosts,
    detectLanIp,
    subnetBaseFromIp,
    PRINTER_ID_RE,
} = require('../backend/cashier-module/printer-logic');
const { tcpProbe } = require('../backend/cashier-module/printer-routes');
const { pool } = require('../backend/cashier-module/db-pool');

afterAll(async () => {
    await pool.end().catch(() => {});
});

describe('kindOfPrinterId — النوع من البادئة', () => {
    test('kot-* → kot و pos-* → receipt والقيم الفارغة → receipt', () => {
        expect(kindOfPrinterId('kot-3')).toBe('kot');
        expect(kindOfPrinterId('pos-7')).toBe('receipt');
        expect(kindOfPrinterId('')).toBe('receipt');
        expect(kindOfPrinterId(null)).toBe('receipt');
    });
});

describe('resolvePrinterId — الاشتقاق القياسي من النوع + القسم', () => {
    test('receipt → pos-<id> و kot → kot-<id>', () => {
        expect(resolvePrinterId('receipt', 7)).toEqual({ ok: true, id: 'pos-7' });
        expect(resolvePrinterId('kot', '12')).toEqual({ ok: true, id: 'kot-12' });
    });
    test('يرفض نوعًا غير معروف وقسمًا غير رقمي/غير موجب', () => {
        expect(resolvePrinterId('label', 7)).toEqual({ ok: false, code: 'BAD_KIND' });
        expect(resolvePrinterId('receipt', 0)).toEqual({ ok: false, code: 'BAD_DEPARTMENT' });
        expect(resolvePrinterId('receipt', -3)).toEqual({ ok: false, code: 'BAD_DEPARTMENT' });
        expect(resolvePrinterId('receipt', null)).toEqual({ ok: false, code: 'BAD_DEPARTMENT' });
        expect(resolvePrinterId('receipt', 7.5)).toEqual({ ok: false, code: 'BAD_DEPARTMENT' });
    });
});

describe('normalizeNetworkAddress — host:port بمنفذ 9100 الافتراضي', () => {
    test('مضيف فقط → المنفذ الافتراضي، ومضيف:منفذ صريح', () => {
        expect(normalizeNetworkAddress('192.168.1.50')).toEqual({ host: '192.168.1.50', port: 9100 });
        expect(normalizeNetworkAddress('PRINTER.local:9200')).toEqual({ host: 'PRINTER.local', port: 9200 });
    });
    test('يرفض الصيغ غير الصالحة', () => {
        expect(normalizeNetworkAddress('')).toBeNull();
        expect(normalizeNetworkAddress(null)).toBeNull();
        expect(normalizeNetworkAddress('host:99999')).toBeNull();
        expect(normalizeNetworkAddress('host:')).toBeNull();
        expect(normalizeNetworkAddress('has space')).toBeNull();
        expect(normalizeNetworkAddress('http://x')).toBeNull();
    });
});

describe('normalizeShareAddress — server/share', () => {
    test('صيغة صحيحة تُقبل', () => {
        expect(normalizeShareAddress('POSPC/POS58')).toEqual({ server: 'POSPC', share: 'POS58' });
    });
    test('بلا شرطة أو شرطة زائدة تُرفض', () => {
        expect(normalizeShareAddress('server-only')).toBeNull();
        expect(normalizeShareAddress('a/')).toBeNull();
        expect(normalizeShareAddress('a/b/c')).toBeNull();
    });
});

describe('validatePrinterAddress — القاعدة الموحدة حسب النوع', () => {
    test('usb مرفوض عمدًا (يتطلب escpos-usb — لا مهام مستحيلة)', () => {
        expect(validatePrinterAddress('usb', 'anything')).toBeNull();
    });
    test('network و windows_share يمرران الصيغ الصحيحة فقط', () => {
        expect(validatePrinterAddress('network', '10.0.0.9:9100')).toEqual({ host: '10.0.0.9', port: 9100 });
        expect(validatePrinterAddress('windows_share', 'pc/printer')).toEqual({ server: 'pc', share: 'printer' });
        expect(validatePrinterAddress('network', 'x y')).toBeNull();
    });
});

describe('pickPrinterForJob — قلب الأوتوماتيك: مطابقة ثم تراجع ذكي', () => {
    const rows = [
        { id: 'pos-3', kind: 'receipt', is_online: false },
        { id: 'pos-5', kind: 'receipt', is_online: true },
        { id: 'kot-9', kind: 'kot', is_online: true },
        { id: 'kot-11', kind: null, is_online: true }, // صف قديم بلا kind — يُشتق من البادئة
    ];

    test('المطابقة التامة المتصلة أولاً بلا تراجع', () => {
        const chosen = pickPrinterForJob(rows, 'pos-5');
        expect(chosen.fallback).toBe(false);
        expect(chosen.printer.id).toBe('pos-5');
    });

    test('مهمة إيصالات لقسم بلا طابعة متصلة → أول طابعة receipt متصلة', () => {
        const chosen = pickPrinterForJob(rows, 'pos-13');
        expect(chosen.fallback).toBe(true);
        expect(chosen.printer.id).toBe('pos-5');
    });

    test('مهمة مطبخ → طابعة kot فقط لا receipt', () => {
        const chosen = pickPrinterForJob(rows, 'kot-42');
        expect(chosen.fallback).toBe(true);
        expect(chosen.printer.id).toBe('kot-9');
    });

    test('صف قديم بلا kind يُصنّف من بادئة معرفه', () => {
        const chosen = pickPrinterForJob(rows, 'kot-77');
        expect(chosen.printer.id).toBe('kot-9'); // kot-9 قبل kot-11 بالترتيب
    });

    test('لا متاح إطلاقًا → null (رسالة عربية واضحة + backoff)', () => {
        expect(pickPrinterForJob([{ id: 'pos-3', kind: 'receipt', is_online: false }], 'pos-3')).toBeNull();
        expect(pickPrinterForJob([], 'pos-3')).toBeNull();
        expect(pickPrinterForJob(null, 'pos-3')).toBeNull();
    });
});

describe('printerRegistrationSchema — بوابة التسجيل', () => {
    test('تسجيل Network بالحد الأدنى يمر مع المنفذ الافتراضي ضمن العنوان', () => {
        const parsed = printerRegistrationSchema.safeParse({
            kind: 'receipt', department_id: 7, connection_type: 'network', address: '192.168.1.50',
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.paper_width_mm).toBe(80);
            expect(parsed.data.charset).toBe('utf8');
        }
    });
    test('usb مرفوض، والعنوان المخالف مرفوض برسالة عربية', () => {
        const usb = printerRegistrationSchema.safeParse({
            kind: 'receipt', department_id: 7, connection_type: 'usb', address: 'x',
        });
        expect(usb.success).toBe(false);
        const badAddr = printerRegistrationSchema.safeParse({
            kind: 'receipt', department_id: 7, connection_type: 'network', address: 'not a host!',
        });
        expect(badAddr.success).toBe(false);
        if (!badAddr.success) {expect(badAddr.error.issues[0].message).toContain('host:port');}
    });
    test('بلا id ولا department_id مرفوض — لا معرف بلا مصدر', () => {
        const parsed = printerRegistrationSchema.safeParse({
            kind: 'receipt', connection_type: 'network', address: '192.168.1.50',
        });
        expect(parsed.success).toBe(false);
    });
    test('عرض ورق خارج 58/80 مرفوض، والمعرف الحر ب regex صارم', () => {
        expect(printerRegistrationSchema.safeParse({
            kind: 'receipt', department_id: 7, connection_type: 'network', address: '1.2.3.4', paper_width_mm: 57,
        }).success).toBe(false);
        expect(PRINTER_ID_RE.test('pos-7')).toBe(true);
        expect(PRINTER_ID_RE.test('Pos-7')).toBe(false);
        expect(PRINTER_ID_RE.test('-abc')).toBe(false);
        expect(PRINTER_ID_RE.test('a'.repeat(41))).toBe(false);
    });
});

describe('printerUpdateSchema — التحديث الجزئي', () => {
    test('تعديل عنوان فقط يمر، والنوع الجديد مع عنوان لا يطابقه يُرفض', () => {
        expect(printerUpdateSchema.safeParse({ address: '10.0.0.9' }).success).toBe(true);
        const bad = printerUpdateSchema.safeParse({ connection_type: 'windows_share', address: '10.0.0.9' });
        expect(bad.success).toBe(false);
    });
});

describe('buildSubnetHosts / detectLanIp / subnetBaseFromIp — اكتشاف الشبكة', () => {
    test('/24 تعطي 254 مضيفًا من .1 إلى .254', () => {
        const hosts = buildSubnetHosts('192.168.1.0');
        expect(hosts).toHaveLength(254);
        expect(hosts[0]).toBe('192.168.1.1');
        expect(hosts[253]).toBe('192.168.1.254');
    });
    test('المدخلات الفاسدة تعيد مصفوفة فارغة لا استثناء', () => {
        expect(buildSubnetHosts('nonsense')).toEqual([]);
        expect(buildSubnetHosts('999.0.0.0')).toEqual([]);
        expect(buildSubnetHosts(null)).toEqual([]);
    });
    test('detectLanIp يتخطى internal و IPv6 ويعيد أول IPv4 حقيقي', () => {
        expect(detectLanIp({ lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] })).toBeNull();
        expect(detectLanIp({
            lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
            eth0: [{ family: 'IPv6', internal: false, address: 'fe80::1' },
                   { family: 'IPv4', internal: false, address: '172.20.0.5' }],
        })).toBe('172.20.0.5');
    });
    test('subnetBaseFromIp يقص آخر جزء فقط', () => {
        expect(subnetBaseFromIp('10.20.30.44')).toBe('10.20.30.0');
        expect(subnetBaseFromIp('junk')).toBeNull();
    });
});

describe('tcpProbe — فحص TCP حقيقي على مقبس محلي', () => {
    test('خادم يستمع → reachable=true بزمن استجابة رقمي', async () => {
        const server = net.createServer(() => {});
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const { port } = server.address();
        const result = await tcpProbe('127.0.0.1', port, 1000);
        expect(result.reachable).toBe(true);
        expect(typeof result.latency_ms).toBe('number');
        server.close();
    });
    test('منفذ مغلق → reachable=false مع رمز الخطأ', async () => {
        const result = await tcpProbe('127.0.0.1', 1, 800);
        expect(result.reachable).toBe(false);
        expect(result.error).toBeTruthy();
        expect(result.latency_ms).toBeNull();
    });
});

describe('سلوك الاختيار على صفوف قاعدة حقيقية (تنظيف ذاتي)', () => {
    const TEST_ID = 'zztest-pos-1';
    test('تسجيل صف receipt متصل ثم اختيار مهمة لقسم آخر → تراجع له', async () => {
        await pool.query(`DELETE FROM pos_printers WHERE id = $1;`, [TEST_ID]);
        await pool.query(
            `INSERT INTO pos_printers (id, name, kind, connection_type, address, paper_width_mm, charset, is_online)
             VALUES ($1, 'اختبار jest', 'receipt', 'network', '127.0.0.1:1', 80, 'utf8', true);`,
            [TEST_ID]
        );
        try {
            const res = await pool.query(`SELECT * FROM pos_printers WHERE id = $1;`, [TEST_ID]);
            const chosen = pickPrinterForJob(res.rows, 'pos-999999');
            expect(chosen).not.toBeNull();
            expect(chosen.fallback).toBe(true);
            expect(chosen.printer.id).toBe(TEST_ID);
        } finally {
            await pool.query(`DELETE FROM pos_printers WHERE id = $1;`, [TEST_ID]);
        }
    });
});
