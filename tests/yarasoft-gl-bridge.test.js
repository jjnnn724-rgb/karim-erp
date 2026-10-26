'use strict';

/**
 * جسر إيراد يارسوفت إلى الدفتر — عقد المفتاح الثابت وحارس التجويع.
 * سبب الاختبار (2026-10-24): كان الجسر يثبَّت على معرّف صفّ متغيّر، فترحّل نفس
 * المبيعات مرتين (1,447 قيدًا / 129,182.64)، ثم كان الكاسح يمرّر row.id بينما
 * التوقيع يقرأ revenueId فأصبح المفتاح 'undefined' وأُبثّ «replay» لكل صفّ تالٍ.
 */

const postedEntry = { id: 9001, entry_no: 'JE-20261005-0001', status: 'posted' };

const mockPostJournal = jest.fn(async (db, payload) => ({ entry: { id: 9100, entry_no: 'JE-NEW', ...payload } }));

jest.mock('../backend/accounting-routes', () => ({ postJournal: mockPostJournal }));

const bridge = require('../backend/yarasoft/gl-bridge');

/** بركة مزيفة: نتائج مُجهّزة بترتيب الاستدعاء، وتسجيل كل استعلام. */
function fakePool(results) {
    const seen = [];
    let i = 0;
    return {
        seen,
        async query(sql, params) {
            seen.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
            const next = results[i++];
            if (next instanceof Error) {throw next;}
            return { rows: next === undefined ? [] : next };
        },
    };
}

describe('yarasoft/gl-bridge — مفتاح الجسر الثابت', () => {
    beforeEach(() => {mockPostJournal.mockClear();});

    test('bridgeKeyOf يُقدِّم المرجع الخارجي على المعرّف المتغيّر', () => {
        expect(bridge.bridgeKeyOf({ externalRef: 'ora:CC:12', revenueId: 455 })).toBe('ora:CC:12');
        expect(bridge.bridgeKeyOf({ revenueId: 455 })).toBe('id:455');
        expect(bridge.bridgeKeyOf({})).toBe('');
    });

    test('bridgeKeysOf يقبل المفاتيح القديمة حتى لا يُعاد ترحيل ما رُحِّل', () => {
        expect(bridge.bridgeKeysOf({ external_ref: 'ora:BILLS4:7', id: 12 }))
            .toEqual(['ora:BILLS4:7', 'id:12', '12']);
        expect(bridge.bridgeKeysOf({ id: 12 })).toEqual(['id:12', '12']);
    });

    test('يوم التحول الافتراضي 2026-10-01 وقابل للإلغاء بالمتغير', () => {
        expect(bridge.cutoverDate()).toBe('2026-10-01');
        process.env.YARASOFT_GL_CUTOVER = '2026-09-08';
        expect(bridge.cutoverDate()).toBe('2026-09-08');
        delete process.env.YARASOFT_GL_CUTOVER;
        expect(bridge.cutoverDate()).toBe('2026-10-01');
    });

    test('ترحيل صفّ إيراد يفتح بمفتاحه الثابت لا بمعرّف الصفّ', async () => {
        const pool = fakePool([[]]);
        const out = await bridge.bridgeRevenueToGl(pool, {
            revenueId: 1720210000123, externalRef: 'ora:CC:42', source: 'كاشير 4', amount: 120.5, date: '2026-10-07',
        });
        expect(mockPostJournal).toHaveBeenCalledTimes(1);
        const payload = mockPostJournal.mock.calls[0][1];
        expect(payload.source_type).toBe(bridge.SOURCE_TYPE);
        expect(payload.source_id).toBe('ora:CC:42');
        expect(payload.date).toBe('2026-10-07');
        expect(out.entry.source_id).toBe('ora:CC:42');
    });

    test('حارس التجويع: مفتاح مفقود لا يُرحَّل ولا يصير replay', async () => {
        const pool = fakePool([]);
        const out = await bridge.bridgeRevenueToGl(pool, { amount: 15, date: '2026-10-03' });
        expect(out).toEqual({ skipped: 'missing_bridge_key', revenueId: '' });
        expect(mockPostJournal).not.toHaveBeenCalled();
        expect(pool.seen).toHaveLength(0);
    });

    test('مبالغ غير موجبة وتواريخ فاسدة وصفوف ما قبل التحول ترفض الترحيل', async () => {
        const pool = fakePool([]);
        expect(await bridge.bridgeRevenueToGl(pool, { externalRef: 'ora:CC:1', amount: 0, date: '2026-10-05' })).toEqual({ skipped: 'non_positive_amount' });
        expect(await bridge.bridgeRevenueToGl(pool, { externalRef: 'ora:CC:1', amount: 10, date: '' })).toEqual({ skipped: 'invalid_date' });
        expect(await bridge.bridgeRevenueToGl(pool, { externalRef: 'ora:CC:1', amount: 10, date: '2026-09-12' }).then((r) => r.skipped))
            .toBe('before_cutover');
        expect(mockPostJournal).not.toHaveBeenCalled();
    });

    test('إعادة التشغيل على نفس المرجع replay — والقيد الملغي يبقى ملغيًا', async () => {
        const replayPool = fakePool([[postedEntry]]);
        const replay = await bridge.bridgeRevenueToGl(replayPool, { externalRef: 'ora:CC:9', amount: 50, date: '2026-10-08' });
        expect(replay.replay).toBe(true);
        expect(mockPostJournal).not.toHaveBeenCalled();

        const voidPool = fakePool([[{ ...postedEntry, status: 'void' }]]);
        const voided = await bridge.bridgeRevenueToGl(voidPool, { externalRef: 'ora:CC:9', amount: 50, date: '2026-10-08' });
        expect(voided.skipped).toBe('previously_voided');
        expect(mockPostJournal).not.toHaveBeenCalled();
    });

    test('الجسر معطّل بمتغير البيئة: لا قراءة ولا كتابة', async () => {
        process.env.YARASOFT_GL_BRIDGE = 'false';
        const pool = fakePool([]);
        expect(await bridge.bridgeRevenueToGl(pool, { externalRef: 'ora:CC:3', amount: 20, date: '2026-10-05' })).toEqual({ skipped: 'bridge_disabled' });
        expect(await bridge.bridgeUnbridged(pool)).toEqual({ bridged: 0, skipped: 'bridge_disabled' });
        expect(await bridge.bridgePreBooksToGl(pool, { month: '2026-09' })).toEqual({ skipped: 'bridge_disabled' });
        delete process.env.YARASOFT_GL_BRIDGE;
    });

    test('الكاسح يقرأ external_ref ويمرّره، ويتوقف عند التعفف بدل الدوران الأبدي', async () => {
        const rows = [{
            id: 5001, source: 'كاشير 9', amount: 100, date: '2026-10-05', external_ref: 'ora:CC:5001',
        }];
        const pool = fakePool([rows, [], []]);
        const out = await bridge.bridgeUnbridged(pool, { limit: 1, maxPasses: 5 });
        expect(out.bridged).toBe(1);
        expect(out.passes).toBe(2);
        expect(out.remaining).toBe(0);
        expect(pool.seen[0].sql).toContain('r.external_ref');
        expect(mockPostJournal.mock.calls.at(-1)[1].source_id).toBe('ora:CC:5001');
    });

    test('الكاسح يُبقي المتبقي مرئيًا حين ترفض كل صفوف الدورة', async () => {
        // الصف بلا مرجع يُثبَّت على id:<n>؛ إن كان قيده السابق ملغيًا فالجسر
        // يرفض إحياءه، فتبقى الدورة بلا ترحيل ويتوقف الكاسح ويبلغ المتبقي.
        const rows = [{ id: 5002, source: 'كاشير 9', amount: 100, date: '2026-10-05', external_ref: null }];
        const voidedEntry = { id: 9009, entry_no: 'JE-20261005-0009', status: 'void' };
        const pool = fakePool([rows, [voidedEntry]]);
        const out = await bridge.bridgeUnbridged(pool, { limit: 1, maxPasses: 3 });
        expect(out.bridged).toBe(0);
        expect(out.remaining).toBe(1);
        expect(out.passes).toBe(1);
        expect(mockPostJournal).not.toHaveBeenCalled();
    });

    test('الافتتاحي يُرحَّل مجمَّعًا على Cr 3100 في آخر يوم من الشهر', async () => {
        const pool = fakePool([[{ t: '2252293.42', n: 20296 }]]);
        const out = await bridge.bridgePreBooksToGl(pool, { month: '2026-09' });
        expect(out.total).toBe(2252293.42);
        expect(out.count).toBe(20296);
        const payload = mockPostJournal.mock.calls.at(-1)[1];
        expect(payload.source_type).toBe(bridge.PREBOOK_SOURCE_TYPE);
        expect(payload.source_id).toBe('revenue:2026-09');
        expect(payload.date).toBe('2026-09-30');
        expect(payload.lines.map((l) => l.account_code)).toEqual(['1000', '3100']);
    });

    test('شهر التحول أو ما بعده ليس افتتاحيًا، والصيغة الفاسدة ترفض', async () => {
        const pool = fakePool([]);
        expect(await bridge.bridgePreBooksToGl(pool, { month: '2026-10' })).toEqual({ skipped: 'not_pre_book_month', cutover: '2026-10-01' });
        await expect(bridge.bridgePreBooksToGl(pool, { month: 'سبتمبر' })).rejects.toThrow(/شهر غير صالح/);
    });
});
