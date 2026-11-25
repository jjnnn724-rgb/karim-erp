import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKitchenReturn, voidKitchenReturn, whReturnVoidVisible } from './wh-returns-write';

interface Call {
    url: string;
    method: string;
    body: Record<string, unknown> | null;
    headers: Record<string, string>;
}

function stubFetch(responseBody: unknown): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
            const rawBody = init?.body;
            calls.push({
                url: String(url),
                method: init?.method ?? 'GET',
                body: typeof rawBody === 'string' ? (JSON.parse(rawBody) as Record<string, unknown>) : null,
                headers: (init?.headers ?? {}) as Record<string, string>,
            });
            return new Response(JSON.stringify(responseBody), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }),
    );
    return calls;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('كتابة مرتجعات المطبخ', () => {
    it('الإنشاء يستخدم مسار العملية ويمرر القسم والسبب والكراتين ومفتاح العملية', async () => {
        const calls = stubFetch({ return: { id: 77 }, stockChanges: [], transactions: [], expenses: [] });
        await expect(
            createKitchenReturn({
                deptCode: 'K01',
                deptName: 'المطبخ',
                reason: 'فائض',
                notes: ' نهاية الوردية ',
                items: [{ name: 'دجاج', qty: 2.5, unit: 'كجم', packagingQty: 1, packagingUom: 'كرتون' }],
            }),
        ).resolves.toEqual({ id: 77 });

        expect(calls[0]?.url).toBe('/api/warehouse/returns');
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.body).toMatchObject({
            deptCode: 'K01',
            deptName: 'المطبخ',
            reason: 'فائض',
            notes: 'نهاية الوردية',
            items: [{ name: 'دجاج', qty: 2.5, packagingQty: 1, packagingUom: 'كرتون' }],
        });
        expect(calls[0]?.headers['X-Idempotency-Key']).toMatch(/^return-create:direct:/);
    });

    it('الإبطال POST بسبب إلزامي ولا يستخدم DELETE', async () => {
        const calls = stubFetch({ ok: true });
        await voidKitchenReturn(77, ' خطأ في القيد ');
        expect(calls[0]?.url).toBe('/api/warehouse/returns/77/void');
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.body).toEqual({ reason: 'خطأ في القيد' });
        expect(calls[0]?.headers['X-Idempotency-Key']).toMatch(/^return-void:77:/);
        await expect(voidKitchenReturn(77, '  ')).rejects.toThrow('سبب الإبطال مطلوب');
        expect(calls).toHaveLength(1);
    });

    it('الإبطال أضيق من الإنشاء ولا يشمل المطبخ', () => {
        expect(whReturnVoidVisible('warehouse')).toBe(true);
        expect(whReturnVoidVisible('manager')).toBe(true);
        expect(whReturnVoidVisible('kitchen')).toBe(false);
        expect(whReturnVoidVisible('sous_chef')).toBe(false);
    });
});
