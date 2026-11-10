import { describe, expect, it, vi } from 'vitest';
import {
    fetchWeightReadings,
    localToday,
    readingsSummary,
    readingToRow,
    searchWeightReadings,
    toKg,
    type WeightReading,
    weightReadingSchema,
} from './weight';

/**
 * عقد الميزان — مطابق لـ `frontend/app/js/v2/data/weight-repo.js`:
 * التحويل للكيلوجرام (g/1000، lb×0.453592)، والوحدة المجهولة لا تُحوَّل
 * ولا تُجمع، والمجاميع تُقاس بالكيلوجرام بعد التحويل.
 */

function reading(raw: Record<string, unknown>): WeightReading {
    return weightReadingSchema.parse(raw);
}

const kgRow = reading({
    id: 3,
    weight: '1.5',
    unit: 'kg',
    date: '2026-11-07',
    time: '09:15:00',
    itemName: 'لحم',
    notes: 'شحنة أولى',
    recordedBy: 'أحمد',
});
const gramRow = reading({
    id: 2,
    weight: '500',
    unit: 'g',
    date: '2026-11-07',
    time: '10:00:00',
    itemId: 5,
});
const poundRow = reading({
    id: 1,
    weight: '2',
    unit: 'lb',
    date: '2026-11-01',
    time: '08:00:00',
    itemName: 'دقيق',
});
const oddRow = reading({
    id: 9,
    weight: '3',
    unit: 'ton',
    date: '2026-11-01',
    notes: 'وحدة غير معروفة',
});

describe('عقد الميزان — التحويل والصفّ', () => {
    it('يحوّل الجرام والرطل ويُبقي الكيلوجرام، ويقبل id نصًا أو رقمًا', () => {
        expect(readingToRow(kgRow)).toEqual({
            id: '3',
            date: '2026-11-07',
            time: '09:15:00',
            weight: 1.5,
            unit: 'kg',
            unitAr: 'كجم',
            kg: 1.5,
            itemId: null,
            itemName: 'لحم',
            notes: 'شحنة أولى',
            recordedBy: 'أحمد',
        });
        expect(readingToRow(gramRow).kg).toBe(0.5);
        expect(readingToRow(gramRow).itemName).toBe('#5');
        expect(readingToRow(poundRow).kg).toBe(0.907);
        expect(readingToRow(reading({ id: '7', weight: 2 })).unit).toBe('kg');
    });

    it('الوحدة المجهولة تبقى نصًّا وkg تبقى null — لا تخمين', () => {
        const row = readingToRow(oddRow);
        expect(row.unit).toBe('ton');
        expect(row.unitAr).toBe('ton');
        expect(row.kg).toBeNull();
        // الدالة نفسها كما في القديم: لا تحويل لوحدة لا تعرفها.
        expect(toKg(3, 'ton')).toBe(3);
    });

    it('الحقول الغائبة تصير نصوصًا فارغة لا undefined', () => {
        const sparse = readingToRow(reading({ id: 9 }));
        expect(sparse.date).toBe('');
        expect(sparse.time).toBe('');
        expect(sparse.itemName).toBe('');
        expect(sparse.notes).toBe('');
        expect(sparse.recordedBy).toBe('');
        expect(Object.values(sparse).every((value) => value !== undefined)).toBe(true);
    });
});

describe('عقد الميزان — المجاميع', () => {
    it('يجمع الكيلوجرام بعد التحويل ويعدّ اليوم والمجهول', () => {
        const summary = readingsSummary([kgRow, gramRow, poundRow, oddRow], '2026-11-07');
        expect(summary.count).toBe(4);
        expect(summary.todayCount).toBe(2);
        expect(summary.totalKg).toBe(2.907);
        expect(summary.unconverted).toBe(1);
        expect(summary.last?.id).toBe('3');
    });

    it('سجل فارغ ⇒ أصفار وآخر قراءة null', () => {
        expect(readingsSummary([], '2026-11-07')).toEqual({
            count: 0,
            todayCount: 0,
            totalKg: 0,
            unconverted: 0,
            last: null,
        });
    });

    it('اليوم المحلي بالتنسيق YYYY-MM-DD وبلا انزياح منطقة زمنية', () => {
        expect(localToday(new Date(2026, 10, 7, 23, 30))).toBe('2026-11-07');
        expect(localToday(new Date(2026, 0, 2, 0, 1))).toBe('2026-01-02');
        expect(localToday(new Date('not a date'))).toBe('');
    });
});

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('عقد الميزان — الجلب', () => {
    it('يمشي الصفحات حتى آخرها ويطلب limit=1000 بترتيب id تنازليًا', async () => {
        const urls: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                urls.push(String(url));
                if (String(url).includes('page=1')) {
                    return json({
                        data: Array.from({ length: 1000 }, (_, index) => ({ id: index + 1, weight: '1' })),
                        pagination: { totalPages: 2 },
                    });
                }
                return json({ data: [{ id: 1001, weight: '2' }], pagination: { totalPages: 2 } });
            }),
        );
        try {
            const rows = await fetchWeightReadings();
            expect(rows).toHaveLength(1001);
            expect(urls[0]).toContain('page=1&limit=1000&sort=id&order=desc');
            expect(urls[1]).toContain('page=2&limit=1000&sort=id&order=desc');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('يقبل مصفوفة خامًا كما يقبل {data,pagination}', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                json([
                    { id: 1, weight: '4' },
                    { id: 2, weight: '5' },
                ]),
            ),
        );
        try {
            const rows = await fetchWeightReadings();
            expect(rows.map((row) => row.id)).toEqual(['1', '2']);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('عقد الميزان — البحث', () => {
    const rows = [kgRow, gramRow, poundRow, oddRow].map(readingToRow);

    it('يبحث في الصنف والملاحظات ومن سجّل والوحدة والتاريخ', () => {
        expect(searchWeightReadings(rows, 'لحم').rows.map((row) => row.id)).toEqual(['3']);
        expect(searchWeightReadings(rows, 'شحنة').rows.map((row) => row.id)).toEqual(['3']);
        expect(searchWeightReadings(rows, '2026-11-01').rows.map((row) => row.id)).toEqual(['1', '9']);
        expect(searchWeightReadings(rows, 'رطل').rows.map((row) => row.id)).toEqual(['1']);
    });

    it('يطبّع الحروف العربية ويعلن التطبيع', () => {
        const hit = searchWeightReadings(rows, 'احمد');
        expect(hit.rows.map((row) => row.id)).toEqual(['3']);
        expect(hit.folded).toBe(true);
    });

    it('كل كلمة يجب أن تلاقي موضعًا، والبحث بلا كلمة يعيد الكل', () => {
        expect(searchWeightReadings(rows, 'لحم شحنة').rows.map((row) => row.id)).toEqual(['3']);
        expect(searchWeightReadings(rows, 'لحم دقيق').rows).toEqual([]);
        const all = searchWeightReadings(rows, '   ');
        expect(all.rows).toHaveLength(4);
        expect(all.matched).toBe(false);
    });
});
