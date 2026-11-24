import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createFiscalYear,
    fetchFiscalYears,
    fetchOpeningBalanceReport,
    fetchSystemHealth,
    fiscalSummary,
    fiscalWriteEnabled,
    healthSummary,
    normalizeFiscalYearForm,
    openingTotals,
    validateFiscalYearForm,
} from './warehouse-gov';

afterEach(() => {
    vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('حوكمة المخزن — نماذج البيانات والسياسات', () => {
    it('يقفل الكتابة افتراضيًا ويحترم أولوية الرابط على المخزن', () => {
        expect(fiscalWriteEnabled('', null)).toBe(false);
        expect(fiscalWriteEnabled('', '1')).toBe(true);
        expect(fiscalWriteEnabled('?v2fiscalwrite=0', '1')).toBe(false);
        expect(fiscalWriteEnabled('?v2fiscalwrite=1', null)).toBe(true);
    });

    it('يتحقق من التواريخ ويطابق افتراضات حمولة الإنشاء القديمة', () => {
        expect(validateFiscalYearForm({ startDate: '2026/01/01', endDate: '2026-12-31' })[0]?.field).toBe('startDate');
        expect(validateFiscalYearForm({ startDate: '2026-12-31', endDate: '2026-01-01' })[0]?.field).toBe('endDate');
        expect(validateFiscalYearForm({ startDate: '2026-01-01', endDate: '2026-12-31' })).toEqual([]);
        expect(
            normalizeFiscalYearForm({
                startDate: ' 2026-01-01 ',
                endDate: '2026-12-31',
                yearCode: '',
                name: '',
                notes: ' ',
            }),
        ).toEqual({
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            yearCode: '2026',
            name: 'السنة المالية 2026',
            notes: null,
        });
    });

    it('يحافظ على دقة مبالغ NUMERIC ويحصر ملخص السنة في البيانات المستلمة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse([
                    {
                        id: 2,
                        year_code: '2025',
                        name: '2025',
                        start_date: '2025-01-01',
                        end_date: '2025-12-31',
                        status: 'closed',
                        closing_snapshot: { revenue_total: '99999999999999.99', net_result: '10.25' },
                        opening_balances: { inventory: [{ id: 1 }] },
                    },
                    { id: 3, status: 'open' },
                ]),
            ),
        );
        const rows = await fetchFiscalYears();
        expect(rows[0]).toMatchObject({
            openingCount: 1,
            snapshot: {
                revenueTotal: '99999999999999.99',
                netResult: '10.25',
            },
        });
        expect(fiscalSummary(rows)).toMatchObject({ total: 2, open: 1, closed: 1, current: { id: '3' } });
    });

    it('يعرض تقرير الافتتاح كما أرسله الخادم ولا يستنتج رصيدًا', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse({
                    invoices: [
                        {
                            id: 7,
                            invoiceNumber: 'OPEN-1',
                            date: '2026-01-01T00:00:00Z',
                            totalAmount: '99999999999999.99',
                            items: [
                                {
                                    itemId: 1,
                                    itemName: 'أرز',
                                    qty: '10',
                                    price: '2.50',
                                    currentQty: null,
                                    issuedSince: '6',
                                    itemExists: false,
                                },
                            ],
                        },
                    ],
                }),
            ),
        );
        const invoices = await fetchOpeningBalanceReport();
        expect(invoices[0]?.items[0]).toMatchObject({ qty: 10, price: '2.50', currentQty: null, issuedSince: 6 });
        expect(openingTotals(invoices)).toMatchObject({
            invoices: 1,
            lines: 1,
            totalAmount: '99999999999999.99',
            missing: 1,
        });
    });

    it('يحافظ على إجمالي الملاحظات وعلى ما يعيده endpoint للفحص', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse({
                    ok: false,
                    itemsTotal: '10',
                    consistent: '8',
                    anomaliesCount: '4',
                    zeroStock: 1,
                    lowStock: 2,
                    anomalies: [{ name: 'أرز', issue: 'عدم اتساق' }],
                }),
            ),
        );
        const result = await fetchSystemHealth();
        expect(result).toMatchObject({
            ok: false,
            itemsTotal: 10,
            consistent: 8,
            anomaliesCount: 4,
            anomalies: [{ name: 'أرز', issue: 'عدم اتساق' }],
        });
        expect(healthSummary(result).anomalies).toHaveLength(1);
    });

    it('يرسل فقط الحقول المقبولة إلى مسار إنشاء السنة', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ id: 4 }));
        vi.stubGlobal('fetch', fetchMock);
        await createFiscalYear(
            normalizeFiscalYearForm({
                startDate: '2026-01-01',
                endDate: '2026-12-31',
                yearCode: '',
                name: '',
                notes: '',
            }),
        );
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe('/api/warehouse/fiscal-years');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            yearCode: '2026',
            name: 'السنة المالية 2026',
            notes: null,
        });
    });
});
