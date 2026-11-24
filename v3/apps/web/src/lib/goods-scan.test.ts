import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    assignDecision,
    assignItemBarcode,
    bumpLine,
    checkExpiryOnLines,
    codeFamily,
    coverage,
    dropLine,
    lookupByCode,
    normalizeCode,
    receiptPayload,
    resolveScan,
    type ScanItem,
    sessionTotals,
    setLineExpiry,
    setLinePrice,
    setLineQty,
    validateGtin,
} from './goods-scan';

afterEach(() => {
    vi.unstubAllGlobals();
});

const item = (id: number, name: string, extra: Partial<ScanItem> = {}): ScanItem => ({
    id,
    name,
    category: 'عام',
    unit: 'قطعة',
    qty: 10,
    avgCost: 5,
    minQty: 2,
    weight: null,
    barcode: '',
    shelfId: null,
    mainQty: 10,
    ...extra,
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('عقد مسح الباركود', () => {
    it('ينظف محارف التحكم دون تغيير حالة الأحرف أو المسافات الداخلية', () => {
        expect(normalizeCode('\0A1\r\n B2\t')).toBe('A1 B2');
        expect(normalizeCode(null)).toBe('');
        expect(codeFamily('4006381333931')).toBe('ean13');
        expect(codeFamily('ABC-123')).toBe('alphanumeric');
    });

    it('يفحص GTIN ويحذر من رقم التحقق الخاطئ دون رفض الكود الداخلي', () => {
        expect(validateGtin('4006381333931')).toMatchObject({ ok: true, checked: true, expected: 1 });
        expect(validateGtin('4006381333932')).toMatchObject({ ok: false, checked: true, expected: 1 });
        expect(validateGtin('ABC-123')).toMatchObject({ ok: true, checked: false });
    });

    it('يطابق الباركود كاملًا ويكشف التكرار بدل اختيار نتيجة تقريبية', () => {
        const rows = [
            item(1, 'أرز', { barcode: '4006381333931' }),
            item(2, 'أرز مكرر', { barcode: '4006381333931' }),
            item(3, 'سكر', { barcode: '40063813339310' }),
        ];
        expect(resolveScan(rows, '4006381333931').state).toBe('ambiguous');
        expect(resolveScan(rows, '4006381').state).toBe('none');
        expect(resolveScan(rows, '').state).toBe('empty');
    });

    it('يرفض ربط كود مأخوذ، ويطلب تأكيدًا عند خطأ GS1 أو استبدال كود الصنف', () => {
        const rows = [
            item(1, 'أرز', { barcode: '4006381333931' }),
            item(2, 'سكر', { barcode: '96385074' }),
            item(3, 'ملح'),
        ];
        expect(assignDecision(rows, '4006381333931', 3).state).toBe('taken');
        expect(assignDecision(rows, '4006381333932', 3).state).toBe('suspect');
        expect(assignDecision(rows, '042100005264', 2).state).toBe('duplicate');
        expect(assignDecision(rows, '4006381333932', 2)).toMatchObject({
            state: 'duplicate',
            message: expect.stringContaining('آخر خانة لا تطابق'),
        });
        expect(assignDecision(rows, '042100005264', 3).state).toBe('ready');
    });

    it('يحسب التغطية والتكرارات والتحقق ويحد قائمة العمل', () => {
        const rows = [
            item(1, 'أ', { barcode: '4006381333931' }),
            item(2, 'ب', { barcode: '4006381333931' }),
            item(3, 'ج', { barcode: '4006381333932' }),
            item(4, 'د'),
        ];
        expect(coverage(rows)).toMatchObject({
            total: 4,
            assigned: 3,
            unassigned: 1,
            pct: 75,
            distinct: 2,
            duplicates: [{ code: '4006381333931', count: 2 }],
            suspect: 1,
        });
    });

    it('يدمج المسح المتكرر ويحفظ الكمية والسعر والصلاحية ويمنع الكمية السالبة', () => {
        let lines = bumpLine([], '7');
        lines = bumpLine(lines, '7');
        lines = setLineQty(lines, '7', '2.5');
        lines = setLinePrice(lines, '7', '12.50');
        lines = setLineExpiry(lines, '7', '2027-02-28');
        expect(lines[0]).toMatchObject({ count: 2, qty: 2.5, price: 12.5, expiryDate: '2027-02-28' });
        expect(setLineQty(lines, '7', '-1')[0]?.qty).toBe(2.5);
        expect(sessionTotals(lines)).toEqual({ lines: 1, scans: 2, qty: 2.5 });
        expect(dropLine(lines, '7')).toEqual([]);
    });

    it('يتحقق من تاريخ الصلاحية ويرجع السعر الفارغ إلى متوسط التكلفة', () => {
        const row = item(1, 'أرز', { avgCost: 8 });
        const lines = setLineExpiry(setLinePrice(bumpLine([], '1'), '1', ''), '1', '2027-02-29');
        expect(checkExpiryOnLines(lines, [row]).ok).toBe(false);
        const line = lines[0];
        if (!line) {
            throw new Error('إضافة الصنف لم تنشئ سطرًا');
        }
        expect(receiptPayload(row, { ...line, expiryDate: null })).toEqual({
            qty: 1,
            price: 8,
            unit: 'قطعة',
            expiryDate: null,
        });
    });

    it('يبحث من مسار المخزون ثم يطابق الكود حرفيًا', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
            jsonResponse({
                data: [
                    {
                        id: 8,
                        name: 'أرز',
                        barcode: '4006381333931',
                        qty: '5',
                        avgCost: '4.00',
                        mainQty: '5',
                        unit: 'كيس',
                    },
                ],
                pagination: { page: 1, limit: 200, total: 1, pages: 1 },
                categories: ['عام'],
                fuzzy: false,
            }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const result = await lookupByCode(' 4006381333931 ');
        expect(result.matches.map((row) => row.id)).toEqual([8]);
        expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/warehouse/inventory/search?');
    });

    it('يرسل ربط الباركود بعمود واحد وبحد 100 حرف', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        const barcode = `K-${'A'.repeat(120)}`;
        await assignItemBarcode('7/1', barcode);
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe('/api/inventory/7%2F1');
        expect(init?.method).toBe('PUT');
        expect(JSON.parse(String(init?.body))).toEqual({ barcode: barcode.slice(0, 100) });
    });
});
