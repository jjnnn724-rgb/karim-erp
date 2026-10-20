/**
 * pos-channel-meter.test.js — استنتاج قناة واجهة POS (Phase 4.1)
 * ─────────────────────────────────────────────────────────────────
 * القاعدة: القرار من مرجع المتصفح (Referer/Origin)، ولا يُوثق بترويسة
 * يرسلها العميل. والوحدة لا تفتح اتصال قاعدة ولا ترمي خطأ في مسار الطلب.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PosChannelMeter, inferChannel, dayStamp } = require('../backend/middleware/pos-channel-meter');

const req = (headers = {}, url = '/api/sales/complete', method = 'POST') => ({
    method, url, originalUrl: url, headers,
});

describe('قياس قناة POS', () => {
    test('الاستنتاج من Referer: الشاشات الثلاث', () => {
        expect(inferChannel(req({ referer: 'http://h/app/pos.html' }))).toBe('pos');
        expect(inferChannel(req({ referer: 'http://h/app/cashier/' }))).toBe('cashier');
        expect(inferChannel(req({ referer: 'http://h/app/v2.html?live=1' }))).toBe('v2-embedded');
    });

    test('الاستنتاج من Origin أيضاً', () => {
        expect(inferChannel(req({ origin: 'http://h/app/cashier/index.html' }))).toBe('cashier');
        expect(inferChannel(req({ origin: 'http://h/app/pos.html' }))).toBe('pos');
    });

    test('بلا مرجع معروف → unknown (لا تخمين)', () => {
        expect(inferChannel(req({}))).toBe('unknown');
        expect(inferChannel(req({ referer: 'http://h/app/settings.html' }))).toBe('unknown');
    });

    test('ترويسة X-POS-Channel من العميل لا تُغيّر القرار', () => {
        const r = req({ referer: 'http://h/app/pos.html', 'x-pos-channel': 'cashier' });
        expect(inferChannel(r)).toBe('pos');
    });

    test('يسجّل الأحداث في القناة الصحيحة + ترويسة العميل كادّعاء للمقارنة', () => {
        const m = new PosChannelMeter({ logDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pcm-')) });
        m.record(req({ referer: 'http://h/app/pos.html', 'x-pos-channel': 'v2-embedded' }));
        m.record(req({ referer: 'http://h/app/pos.html' }));
        m.record(req({ referer: 'http://h/app/cashier/' }));
        m.record(req({ referer: 'http://h/app/cashier/' }, '/api/pos/products', 'GET'));
        m.record(req({ referer: 'http://h/app/pos.html' }, '/api/not-metered', 'GET'));

        const snap = m.snapshot();
        expect(snap.channels.pos.requests).toBe(2);
        expect(snap.channels.pos.sales).toBe(2);
        expect(snap.channels.cashier.requests).toBe(2);
        expect(snap.channels.cashier.sales).toBe(1);
        expect(snap.channels.cashier.events.products).toBe(1);
        // المسار غير المقيس لا يُحسب
        expect(snap.channels.pos.requests).toBe(2);
        // ادّعاء العميل مسجَّل للمقارنة لكنه لم يغيّر القناة
        expect(snap.channels.pos.claimed['v2-embedded']).toBe(1);
    });

    test('الجلسات تُعدّ ببصمة الرمز لا بالرمز نفسه', () => {
        const m = new PosChannelMeter({ logDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pcm-')) });
        const token = 'Bearer secret-token-value';
        m.record(req({ referer: 'http://h/app/pos.html', authorization: token }));
        m.record(req({ referer: 'http://h/app/pos.html', authorization: token }));
        m.record(req({ referer: 'http://h/app/pos.html', authorization: 'Bearer other-token' }));
        const snap = m.snapshot();
        expect(snap.channels.pos.sessions).toBe(2);
        expect(JSON.stringify(snap)).not.toContain('secret-token-value');
    });

    test('يكتب ملف القياس اليومي بصيغة JSON صالحة', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcm-'));
        const m = new PosChannelMeter({ logDir: dir });
        m.record(req({ referer: 'http://h/app/cashier/' }));
        await m.flush();
        const file = path.join(dir, `pos-channel-usage-${dayStamp()}.json`);
        expect(fs.existsSync(file)).toBe(true);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(data.channels.cashier.sales).toBe(1);
        expect(data.channels.pos.sales).toBe(0);
    });

    test('يوم القياس يتبع توقيت الرياض لا UTC', () => {
        const stamp = dayStamp(new Date('2026-10-19T22:30:00.000Z')); // 01:30_operationة في الرياض
        expect(stamp).toBe('2026-10-20');
    });

    test('خطأ في التسجيل لا يُسقط الطلب', () => {
        const m = new PosChannelMeter({ logDir: '/nonexistent-root/xyz' });
        expect(() => m.record(req({ referer: 'http://h/app/pos.html' }))).not.toThrow();
    });
});
