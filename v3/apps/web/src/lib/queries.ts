import { v3ChartResponseSchema, v3JournalEntrySchema, v3JournalResponseSchema } from '@karim/shared';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * استعلامات القراءة — المسارات الثلاثة تحت `/api/v3/accounting`.
 *
 * التحقق من العقد في `fetchJson` (مخطط Zod)، فليس في الشاشة: شاشةٌ تقرأ
 * بياناتٍ مخالِفة للعقد تُنتج خطأً صريحًا لا جدولًا كاذبًا.
 */
export function fetchChart(signal?: AbortSignal) {
    return fetchJson(v3ChartResponseSchema, '/api/v3/accounting/chart', getAccessToken(), signal ? { signal } : {});
}

export function fetchJournal(limit: number, signal?: AbortSignal) {
    return fetchJson(
        v3JournalResponseSchema,
        `/api/v3/accounting/journal?limit=${String(limit)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export function fetchJournalEntry(id: string, signal?: AbortSignal) {
    return fetchJson(
        v3JournalEntrySchema,
        `/api/v3/accounting/journal/${encodeURIComponent(id)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}
