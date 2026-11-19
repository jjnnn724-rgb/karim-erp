import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * مصدر البيانات القديم — Yarasoft/Oracle للقراءة فقط، وPostgreSQL هو المصدر.
 *
 * `mode = standalone` يعني: v3 يعمل على PostgreSQL وحده، ومزامنة Yarasoft
 * والربط المباشر بـOracle موقوفان (وقت التشغيل وعند الإقلاع) — والبيانات
 * المستوردة سابقًا تبقى متاحة للقراءة.
 */

const engineSchema = z.object({
    running: z.boolean(),
    enabled: z.boolean(),
    lastRunAt: z.string().nullable().optional(),
    importedToday: z.number().nullable().optional(),
});

const oracleSchema = z.object({
    configured: z.boolean(),
    host: z.string().nullable().optional(),
    service: z.string().nullable().optional(),
});

export const legacySourceSchema = z.object({
    mode: z.enum(['connected', 'standalone']),
    standalone: z.boolean(),
    yarasoft: engineSchema,
    oracle: oracleSchema,
});

export type LegacySourceStatus = z.infer<typeof legacySourceSchema>;
export type LegacySourceMode = LegacySourceStatus['mode'];

const ENDPOINT = '/api/integrations/legacy';

export function fetchLegacySource(signal?: AbortSignal): Promise<LegacySourceStatus> {
    return fetchJson(legacySourceSchema, ENDPOINT, getAccessToken(), signal ? { signal } : {});
}

export function setLegacySourceMode(mode: LegacySourceMode): Promise<LegacySourceStatus> {
    return fetchJson(legacySourceSchema, ENDPOINT, getAccessToken(), { method: 'PATCH', body: { mode } });
}
