/**
 * coa-phase3-yarasoft.test.js — جسر يارسوفت يقرأ حساباته من account_mapping
 * ─────────────────────────────────────────────────────────────────────────────
 * عقد Phase 3: `yarasoft.gl_bridge` (1000/4000) و`yarasoft.prebooks` (1000/3100)
 * مع fallback كامل للثوابت. الاختبار يوجّه الاستعلامات بالـSQL لا بالترتيب،
 * فإضافة قراءة الخريطة لا تُغيّر أي مسار سابق (replay لا يقرأ الخريطة أصلًا).
 */

const postedEntry = { id: 9001, entry_no: 'JE-20261005-0001', status: 'posted' };
const mockPostJournal = jest.fn(async (db, payload) => ({ entry: { id: 9100, entry_no: 'JE-NEW', ...payload } }));

jest.mock('../backend/accounting-routes', () => ({ postJournal: mockPostJournal }));

const bridge = require('../backend/yarasoft/gl-bridge');

function routedPool({ mappingRows = [], mappingError = null, bridged = [], prebooks = null } = {}) {
    const seen = [];
    return {
        seen,
        async query(sql, params) {
            seen.push({ sql: String(sql), params });
            const s = String(sql);
            if (/FROM account_mapping/.test(s)) {
                if (mappingError) {throw mappingError;}
                return { rows: mappingRows };
            }
            // ترتيب الفحص مقصود: استعلام الإيرادات يحوي NOT EXISTS على journal_entries.
            if (/FROM revenues/.test(s)) {return { rows: prebooks ? [prebooks] : [] };}
            if (/FROM journal_entries/.test(s)) {return { rows: bridged };}
            return { rows: [] };
        },
    };
}
const mapCalls = (pool) => pool.seen.filter((q) => /FROM account_mapping/.test(q.sql));

describe('gl_bridge — Dr نقدية / Cr إيراد', () => {
    beforeEach(() => {mockPostJournal.mockClear();});

    test('الخريطة تغيّر الحسابين فعليًا', async () => {
        const pool = routedPool({ mappingRows: [
            { role: 'cash_account', account_code: '1030' },
            { role: 'revenue_account', account_code: '4030' },
        ] });
        await bridge.bridgeRevenueToGl(pool, {
            revenueId: 1, externalRef: 'ora:CC:1', source: 'كاشير', amount: 120.5, date: '2026-10-07',
        });
        const payload = mockPostJournal.mock.calls[0][1];
        expect(payload.lines.map((l) => l.account_code)).toEqual(['1030', '4030']);
        const mc = mapCalls(pool);
        expect(mc).toHaveLength(1);
        expect(mc[0].params[0]).toBe('yarasoft');
        expect(mc[0].params[1]).toBe('gl_bridge');
    });

    test('134 غير مطبقة (42P01) ⇒ 1000/4000 نفس القديم', async () => {
        const pool = routedPool({ mappingError: Object.assign(new Error('no table'), { code: '42P01' }) });
        await bridge.bridgeRevenueToGl(pool, {
            revenueId: 2, externalRef: 'ora:CC:2', amount: 10, date: '2026-10-07',
        });
        expect(mockPostJournal.mock.calls[0][1].lines.map((l) => l.account_code)).toEqual(['1000', '4000']);
    });

    test('replay لا يقرأ الخريطة أصلًا (مسار سابق بلا استعلام إضافي)', async () => {
        const pool = routedPool({ bridged: [postedEntry] });
        const out = await bridge.bridgeRevenueToGl(pool, { externalRef: 'ora:CC:9', amount: 50, date: '2026-10-08' });
        expect(out.replay).toBe(true);
        expect(mapCalls(pool)).toHaveLength(0);
        expect(mockPostJournal).not.toHaveBeenCalled();
    });
});

describe('prebooks — Dr نقدية / Cr أرباح محتجزة', () => {
    beforeEach(() => {mockPostJournal.mockClear();});

    test('الخريطة تغيّر الحسابين فعليًا', async () => {
        const pool = routedPool({
            prebooks: { t: '1200.00', n: 3 },
            mappingRows: [
                { role: 'cash_account', account_code: '1030' },
                { role: 'equity_account', account_code: '3010' },
            ],
        });
        const out = await bridge.bridgePreBooksToGl(pool, { month: '2026-09' });
        expect(out.total).toBe(1200);
        const payload = mockPostJournal.mock.calls.at(-1)[1];
        expect(payload.lines.map((l) => l.account_code)).toEqual(['1030', '3010']);
        expect(mapCalls(pool)[0].params[1]).toBe('prebooks');
    });

    test('fallback: 1000/3100 كما هو موثق', async () => {
        const pool = routedPool({
            prebooks: { t: '500.00', n: 1 },
            mappingError: Object.assign(new Error('missing'), { code: '42P01' }),
        });
        await bridge.bridgePreBooksToGl(pool, { month: '2026-09' });
        expect(mockPostJournal.mock.calls.at(-1)[1].lines.map((l) => l.account_code)).toEqual(['1000', '3100']);
    });
});

describe('ربط المصدر والهجرة', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

    test('gl-bridge يستخدم resolveAccounts بالعملية الصحيحة', () => {
        const src = read('backend/yarasoft/gl-bridge.js');
        expect(src).toMatch(/resolveAccounts\(pool, 'yarasoft', 'gl_bridge'/);
        expect(src).toMatch(/resolveAccounts\(pool, 'yarasoft', 'prebooks'/);
        expect(src).not.toMatch(/account_code: '4000'/);
        expect(src).not.toMatch(/account_code: '3100'/);
    });

    test('هجرة 140 تبذر نقدية الافتتاحي فقط', () => {
        const up = read('database/migrations/140_coa_mapping_yarasoft.sql');
        expect(up).toMatch(/'yarasoft','prebooks','cash_account','1000'/);
        expect(up).toMatch(/ON CONFLICT \(module, operation, role\) DO NOTHING/);
        const down = read('database/migrations/140_coa_mapping_yarasoft_down.sql');
        expect(down).toMatch(/account_code = '1000'/);
    });
});
