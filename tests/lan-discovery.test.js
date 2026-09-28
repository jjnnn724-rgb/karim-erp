// منفذ اختبار معزول — يُضبط قبل require لأن DEFAULT_PORT يُقرأ وقت التحميل
process.env.KARIM_LAN_PORT = '50551';

const {
    encodeBeacon, parseBeacon, broadcastAddresses,
    startLanBeacon, discoverServers, DEFAULT_PORT,
} = require('../common/lan-discovery');

const validInfo = { svc: 'karim-erp', name: 'سيرفر المطبخ', version: '4.7.0', scheme: 'https', port: 5000 };

describe('lan-discovery: ترميز وتحليل حزم الإعلان', () => {
    test('ترميز ثم تحليل = نفس المعلومات', () => {
        const buf = encodeBeacon(validInfo);
        expect(Buffer.isBuffer(buf)).toBe(true);
        const info = parseBeacon(buf);
        expect(info).not.toBeNull();
        expect(info.svc).toBe('karim-erp');
        expect(info.name).toBe('سيرفر المطبخ');
        expect(info.version).toBe('4.7.0');
        expect(info.scheme).toBe('https');
        expect(info.port).toBe(5000);
        expect(typeof info.ts).toBe('number');
    });

    test('حمولات غير صالحة → null (لا إعلان لسيرفرات غريبة)', () => {
        expect(encodeBeacon({ svc: 'other-app', port: 5000, scheme: 'https' })).toBeNull();
        expect(encodeBeacon({ svc: 'karim-erp', port: 0, scheme: 'https' })).toBeNull();
        expect(encodeBeacon({ svc: 'karim-erp', port: 5000, scheme: 'ftp' })).toBeNull();
        expect(encodeBeacon(null)).toBeNull();
    });

    test('حزم غريبة أو تالفة → null (لا تفسير ولا انفجار)', () => {
        expect(parseBeacon(Buffer.from('GET / HTTP/1.1'))).toBeNull();
        expect(parseBeacon(Buffer.from('KRM1|{broken json'))).toBeNull();
        expect(parseBeacon(Buffer.from('KRM1|{"svc":"karim-erp"}'))).toBeNull(); // حقول ناقصة
        expect(parseBeacon('not a buffer')).toBeNull();
        expect(parseBeacon(Buffer.alloc(0))).toBeNull();
    });

    test('عناوين البث تشمل العام والموجّه للشبكات المحلية', () => {
        const addrs = broadcastAddresses();
        expect(addrs[0]).toBe('255.255.255.255');
        expect(addrs.length).toBeGreaterThanOrEqual(1);
    });
});

describe('lan-discovery: دورة حية على loopback (إعلان → probe → رد)', () => {
    let stopBeacon = null;
    afterAll(() => { stopBeacon && stopBeacon(); });

    test('beacon يرد على KRM_PROBE بحزمة صالحة، وdiscoverServers يجده', async () => {
        stopBeacon = startLanBeacon({
            info: validInfo,
            logger: { info() {}, warn() {}, log() {} },
            bindAddress: '127.0.0.1',
        });

        // 1) probe يدوي → رد unicast صالح
        const reply = await new Promise((resolve) => {
            const s = require('dgram').createSocket('udp4');
            const timer = setTimeout(() => { try { s.close(); } catch (_) {} resolve(null); }, 3000);
            s.on('message', (msg) => { clearTimeout(timer); try { s.close(); } catch (_) {} resolve(parseBeacon(msg)); });
            s.bind(0, '127.0.0.1', () => {
                s.send(Buffer.from('KRM_PROBE'), DEFAULT_PORT, '127.0.0.1');
            });
        });
        expect(reply).not.toBeNull();
        expect(reply.svc).toBe('karim-erp');
        expect(reply.port).toBe(5000);

        // 2) الاكتشاف الكامل: منفذ استماع عشوائي + probes إلى loopback فقط
        const servers = await discoverServers({
            listenMs: 2500,
            bindAddress: '127.0.0.1',
            bindPort: 0,
            targets: ['127.0.0.1'],
        });
        expect(servers.length).toBeGreaterThanOrEqual(1);
        const hit = servers.find(s => s.address === '127.0.0.1' && s.port === 5000);
        expect(hit).toBeDefined();
        expect(hit.url).toBe('https://127.0.0.1:5000');
    }, 15000);
});
