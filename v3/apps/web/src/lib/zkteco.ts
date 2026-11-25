import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * أجهزة البصمة — `GET /api/zkteco/status` (قراءة: admin|hr|manager|accountant).
 *
 * العقد منسوخ من الخادم (`zkteco/routes.js`): `{running, devices[], totals}`
 * حيث `totals` يحمل `logs/unmapped/today/employees/linkedEmployees/
 * unlinkedEmployees`، وكل جهاز صفُّ `attendance_devices` + `live`.
 *
 * `commKey` مفتاح اتصال بجهاز — لا يُعرض ولا يُحوَّل ولا يُذكر في عنوان.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();
const boolLike = z.union([z.boolean(), z.string(), z.number()]).nullable().optional();

const liveSchema = z
    .object({
        syncing: boolLike,
        consecutiveFailures: numLike,
        lastError: text,
    })
    .passthrough();

export const zkDeviceSchema = z
    .object({
        id: idValue,
        name: text,
        ipAddress: text,
        port: numLike,
        status: text,
        enabled: boolLike,
        lastSyncAt: text,
        lastError: text,
        totalSynced: numLike,
        live: liveSchema.nullable().optional(),
    })
    .passthrough();

export type ZkDevice = z.infer<typeof zkDeviceSchema>;

export const zkStatusSchema = z
    .object({
        running: boolLike,
        devices: z.array(zkDeviceSchema).optional(),
        totals: z
            .object({
                logs: numLike,
                unmapped: numLike,
                today: numLike,
                employees: numLike,
                linkedEmployees: numLike,
                unlinkedEmployees: numLike,
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export type ZkStatus = z.infer<typeof zkStatusSchema>;

export async function fetchZkStatus(signal?: AbortSignal): Promise<ZkStatus> {
    return fetchJson(zkStatusSchema, '/api/zkteco/status', getAccessToken(), signal ? { signal } : {});
}

/** `false`/`'false'`/`0` = معطّل، وما عداها مفعّل — نفس قراءة القديم. */
export function isEnabled(value: unknown): boolean {
    return !(value === false || value === 'false' || value === 0);
}

export interface ZkDeviceRow {
    id: string;
    name: string;
    ip: string;
    port: string;
    status: string;
    enabled: boolean;
    lastSyncAt: string;
    lastError: string;
    totalSynced: number;
    syncing: boolean;
    failures: number;
}

/** صفّ الجهاز للعرض — بلا مفتاح الاتصال (غير موجود في هذا النوع أصلًا). */
export function deviceToRow(device: ZkDevice): ZkDeviceRow {
    const live = device.live ?? {};
    const status = String(device.status ?? '');
    const names: Record<string, string> = { online: 'متصل', offline: 'غير متصل' };
    return {
        id: device.id,
        name: String(device.name ?? '') || `#${device.id}`,
        ip: String(device.ipAddress ?? ''),
        port: device.port === null || device.port === undefined ? '' : String(device.port),
        status: names[status] ?? (status || '—'),
        enabled: isEnabled(device.enabled),
        lastSyncAt: String(device.lastSyncAt ?? '')
            .slice(0, 19)
            .replace('T', ' '),
        lastError: String(device.lastError ?? live.lastError ?? ''),
        totalSynced: Math.round(Number(device.totalSynced ?? 0)),
        syncing: live.syncing === true,
        failures: Math.round(Number(live.consecutiveFailures ?? 0)),
    };
}

export function summarizeDevices(rows: readonly ZkDeviceRow[]): {
    total: number;
    online: number;
    enabled: number;
    syncing: number;
} {
    return {
        total: rows.length,
        online: rows.filter((row) => row.status === 'متصل').length,
        enabled: rows.filter((row) => row.enabled).length,
        syncing: rows.filter((row) => row.syncing).length,
    };
}
