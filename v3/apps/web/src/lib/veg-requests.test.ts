import { describe, expect, it } from 'vitest';
import {
    fetchVegRequests,
    searchVegRequests,
    vegListPath,
    vegRequestSchema,
    vegRequestsResponseSchema,
    vegRequestToRow,
    vegStatusCounts,
    vegStatusLabel,
} from './veg-requests';

/**
 * عقد طلبات الخضار — مطابق لـ `frontend/app/js/v2/data/veg-repo.js:166-182`
 * وتسميات `v2/status.js:172-175`، ومسارات الخادم :141-190.
 */

function row(raw: Record<string, unknown>) {
    return vegRequestToRow(vegRequestSchema.parse(raw));
}

const urgentPending = row({
    id: 17905,
    request_no: 'VR-20261025-17905',
    created_by: 42,
    created_by_name: 'فاروق عبد احمد',
    priority: 'urgent',
    status: 'pending',
    items_count: 6,
    total: '1250.50',
    notes: 'توريد الصباح',
    created_at: '2026-10-25T09:52:55.890Z',
});

const received = row({
    id: 17907,
    request_no: 'VR-20261105-17907',
    created_by_name: 'مدير النظام',
    priority: 'normal',
    status: 'received',
    items_count: 6,
    total: null,
    received_by_name: 'أمين المخزن',
    created_at: '2026-11-05T21:39:42.035Z',
});

const priced = row({
    id: 17908,
    request_no: 'VR-20261105-17908',
    created_by_name: 'مدير النظام',
    priority: 'normal',
    status: 'priced',
    items_count: 2,
    total: 90,
    priced_by_name: 'أمين المخزن',
    created_at: '2026-11-05T22:00:00.000Z',
});

const cancelled = row({
    id: 17909,
    priority: 'normal',
    status: 'cancelled',
    items_count: 1,
    created_at: '2026-11-06T08:00:00.000Z',
});

describe('عقد طلبات الخضار — الشكل والصفّ', () => {
    it('يحوّل الصفّ كما في veg-repo: الأولوية والتسمية والإجمالي النصي', () => {
        expect(urgentPending).toEqual({
            id: '17905',
            number: 'VR-20261025-17905',
            numberResolved: true,
            itemsCount: 6,
            priority: 'urgent',
            urgent: true,
            status: 'pending',
            statusLabel: 'بانتظار المعالجة',
            total: '1250.50',
            by: 'فاروق عبد احمد',
            created: '2026-10-25',
            receivedBy: '',
            pricedBy: '',
            notes: 'توريد الصباح',
            printCount: 0,
        });
        expect(received.statusLabel).toBe('تم الاستلام');
        expect(received.receivedBy).toBe('أمين المخزن');
        expect(priced.statusLabel).toBe('تم التسعير');
        expect(priced.pricedBy).toBe('أمين المخزن');
        expect(priced.total).toBe('90');
        expect(cancelled.statusLabel).toBe('ملغي');
    });

    it('الطلب بلا رقم يُعرض #id، وبلا منشئ #created_by، وبلا إجمالي null', () => {
        expect(cancelled.number).toBe('#17909');
        expect(cancelled.numberResolved).toBe(false);
        expect(cancelled.by).toBe('—');
        expect(received.total).toBeNull();
        expect(cancelled.created).toBe('2026-11-06');
    });

    it('الحقول الغائبة تصير نصوصًا فارغة لا undefined، والحالة المجهولة تُعرض كما هي', () => {
        const sparse = row({ id: 1 });
        expect(sparse).toMatchObject({
            id: '1',
            number: '#1',
            itemsCount: 0,
            priority: '',
            urgent: false,
            status: '',
            statusLabel: '—',
            total: null,
            by: '—',
            created: '',
            printCount: 0,
        });
        expect(Object.values(sparse).every((value) => value !== undefined)).toBe(true);
        expect(vegStatusLabel('pending')).toBe('بانتظار المعالجة');
        expect(vegStatusLabel('weird')).toBe('weird');
        expect(vegStatusLabel('')).toBe('—');
    });
});

describe('عقد طلبات الخضار — الاستجابة والمسار', () => {
    it('يقبل {requests,summary} ويؤمّن الغائب بقائمة فارغة وملخص أصفار', () => {
        const body = vegRequestsResponseSchema.parse({
            ok: true,
            requests: [{ id: '5', status: 'pending' }],
            summary: { pending: '3', pending_today: 1, today: 2 },
        });
        expect(body.requests).toHaveLength(1);
        expect(body.summary).toEqual({ pending: 3, pendingToday: 1, today: 2 });

        const empty = vegRequestsResponseSchema.parse({ ok: true });
        expect(empty.requests).toEqual([]);
        expect(empty.summary).toEqual({ pending: 0, pendingToday: 0, today: 0 });
    });

    it('يبني المسار كالخادم: status للثلاثة المقبولة فقط، والسقف 200', () => {
        expect(vegListPath('all')).toBe('/api/veg-requests?limit=200');
        expect(vegListPath('pending')).toBe('/api/veg-requests?status=pending&limit=200');
        expect(vegListPath('cancelled', 500)).toBe('/api/veg-requests?status=cancelled&limit=200');
        expect(vegListPath('received', 0)).toBe('/api/veg-requests?status=received&limit=60');
    });

    it('يقرأ عبر fetch ويُرجع الطلبات والملخص', async () => {
        const original = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(
                JSON.stringify({
                    ok: true,
                    requests: [{ id: 1, status: 'pending', items_count: 2 }],
                    summary: { pending: 1, pending_today: 0, today: 0 },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            )) as typeof fetch;
        try {
            const result = await fetchVegRequests('pending');
            expect(result.requests).toHaveLength(1);
            expect(result.summary.pending).toBe(1);
        } finally {
            globalThis.fetch = original;
        }
    });
});

describe('عقد طلبات الخضار — البحث والعدّ', () => {
    const rows = [urgentPending, received, priced, cancelled];

    it('يطابق رقم الطلب تامًّا، ويطابق المنشئ والحالة نصًّا', () => {
        const exact = searchVegRequests(rows, 'vr-20261025-17905');
        expect(exact.rows.map((item) => item.id)).toEqual(['17905']);
        expect(exact.exact).toBe(1);
        expect(exact.folded).toBe(false);
        expect(searchVegRequests(rows, 'مدير النظام').rows.map((item) => item.id)).toEqual(['17907', '17908']);
    });

    it('يطبّع الحروف العربية ويعلن التطبيع', () => {
        const hit = searchVegRequests(rows, 'فاروق');
        expect(hit.rows.map((item) => item.id)).toEqual(['17905']);
        const folded = searchVegRequests(rows, 'أحمد');
        expect(folded.rows.map((item) => item.id)).toEqual(['17905']);
        expect(folded.folded).toBe(true);
    });

    it('كل كلمة يجب أن تلاقي موضعًا، والبحث بلا كلمة يعيد الكل', () => {
        expect(searchVegRequests(rows, 'عاجل بانتظار').rows.map((item) => item.id)).toEqual(['17905']);
        expect(searchVegRequests(rows, 'فاروق 17907').rows).toEqual([]);
        const all = searchVegRequests(rows, '   ');
        expect(all.rows).toHaveLength(4);
        expect(all.matched).toBe(false);
    });

    it('يعدّ الحالات في النافذة المحمّلة', () => {
        expect(vegStatusCounts(rows)).toEqual({
            total: 4,
            pending: 1,
            received: 1,
            priced: 1,
            cancelled: 1,
            urgent: 1,
        });
        expect(vegStatusCounts([])).toEqual({
            total: 0,
            pending: 0,
            received: 0,
            priced: 0,
            cancelled: 0,
            urgent: 0,
        });
    });
});
