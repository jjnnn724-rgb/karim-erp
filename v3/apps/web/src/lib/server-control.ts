import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { writeJson } from './write';

/**
 * تحكم الخادم — بروكسي ERP المحروس إلى خدمة التحكم المرافقة:
 *   GET  /api/server-control/status   (admin)
 *   POST /api/server-control/actions  (admin، 4 أوامر/دقيقتين)
 *
 * العبارات الحرفية من الخادم: `stop` تتطلب STOP و`restart` تتطلب RESTART،
 * و`start` بلا عبارة. لا أسرار تمرّ إلى المتصفح — البروكسي يوقّع داخليًا.
 */

export const CONTROL_ACTIONS = ['start', 'stop', 'restart'] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export const CONTROL_CONFIRM: Record<ControlAction, string> = {
    start: '',
    stop: 'STOP',
    restart: 'RESTART',
};

/** نفس تحقق `server-control-routes.js`: العبارة تُقارن بعد trim + UPPERCASE. */
export function controlConfirmError(action: ControlAction, confirm: unknown): string {
    const phrase = CONTROL_CONFIRM[action];
    if (!phrase) {
        return '';
    }
    return String(confirm ?? '')
        .trim()
        .toUpperCase() === phrase
        ? ''
        : `اكتب ${phrase} للتأكيد.`;
}

export function controlActionName(action: ControlAction): string {
    if (action === 'start') {
        return 'تشغيل ERP';
    }
    if (action === 'stop') {
        return 'إيقاف ERP';
    }
    return 'إعادة تشغيل ERP';
}

/** 3725 → «1س 2د» · 45 → «45د» · 90061 → «1ي 1س». */
export function controlUptimeText(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '—';
    }
    const total = Number(value);
    if (!Number.isFinite(total) || total < 0) {
        return '—';
    }
    const seconds = Math.floor(total);
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (days > 0) {
        parts.push(`${String(days)}ي`);
    }
    if (hours > 0) {
        parts.push(`${String(hours)}س`);
    }
    if (minutes > 0 || parts.length === 0) {
        parts.push(`${String(minutes)}د`);
    }
    return parts.join(' ');
}

const SERVICE_STATES: Record<string, string> = {
    RUNNING: 'يعمل',
    STOPPED: 'متوقف',
    START_PENDING: 'قيد التشغيل',
    STOP_PENDING: 'قيد الإيقاف',
    PAUSED: 'موقوف مؤقتًا',
    UNKNOWN: 'غير معروف',
};

export function controlServiceStateName(state: unknown): string {
    const key = String(state ?? '').trim();
    return SERVICE_STATES[key] ?? (key || 'غير معروف');
}

const MAINTENANCE_STATES: Record<string, string> = {
    stopped: 'متوقف يدويًا',
    stopping: 'قيد الإيقاف',
    starting: 'قيد التشغيل',
    restarting: 'قيد إعادة التشغيل',
};

export function controlMaintenanceName(state: unknown): string {
    const key = String(state ?? '').trim();
    return MAINTENANCE_STATES[key] ?? (key || '—');
}

const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();
const boolLike = z.union([z.boolean(), z.string(), z.number()]).nullable().optional();

const operationSchema = z
    .object({
        id: text,
        action: text,
        state: text,
        stage: text,
        actor: text,
        startedAt: text,
        finishedAt: text,
        error: text,
    })
    .passthrough();

const controlStatusSchema = z
    .object({
        available: boolLike,
        reason: text,
        message: text,
        controlUrl: text,
        control: z
            .object({
                version: text,
                pid: numLike,
                host: text,
                publicHost: text,
                port: numLike,
                uptimeSec: numLike,
                actionsEnabled: boolLike,
                dryRun: boolLike,
                serviceName: text,
            })
            .passthrough()
            .optional(),
        service: z
            .object({
                name: text,
                installed: boolLike,
                state: text,
                pid: numLike,
            })
            .passthrough()
            .optional(),
        erp: z
            .object({
                healthy: boolLike,
                status: text,
                latencyMs: numLike,
                checked: boolLike,
            })
            .passthrough()
            .optional(),
        maintenance: z
            .object({
                state: text,
                at: text,
                by: text,
                reason: text,
            })
            .passthrough()
            .nullable()
            .optional(),
        lastOperation: operationSchema.nullable().optional(),
        audit: z.array(z.object({}).passthrough()).optional(),
        serverTime: text,
    })
    .passthrough();

export type ControlStatus = z.infer<typeof controlStatusSchema>;

export async function fetchControlStatus(signal?: AbortSignal): Promise<ControlStatus> {
    return fetchJson(controlStatusSchema, '/api/server-control/status', getAccessToken(), signal ? { signal } : {});
}

const actionResultSchema = z
    .object({
        ok: boolLike,
        message: text,
        error: text,
        available: boolLike,
        reason: text,
    })
    .passthrough();

export type ControlActionResult = z.infer<typeof actionResultSchema>;

export async function runControlAction(action: ControlAction, confirm: string): Promise<ControlActionResult> {
    return writeJson(actionResultSchema, '/api/server-control/actions', 'POST', {
        action,
        confirm: String(confirm ?? '')
            .trim()
            .toUpperCase(),
    });
}
