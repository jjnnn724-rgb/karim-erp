import { z } from 'zod';

export const sessionRowSchema = z.object({
    id: z.string(),
    current: z.boolean().optional().default(false),
    device: z.string().default('جهاز غير معروف'),
    ip: z.string().nullable().optional(),
    started_at: z.string().nullable().optional(),
    last_seen_at: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
});
export type SessionRow = z.infer<typeof sessionRowSchema>;

export const sessionsResponseSchema = z.object({
    ok: z.boolean().optional().default(true),
    current_session_id: z.string().nullable().optional(),
    sessions: z.array(sessionRowSchema).default([]),
});
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>;

export function formatSessionMoment(iso: string | null | undefined): string {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function computeSessionsSummary(sessions: SessionRow[], currentId: string | null | undefined) {
    const total = sessions.length;
    const current = sessions.find((s) => s.current || (currentId && s.id === currentId));
    const others = sessions.filter((s) => !(s.current || (currentId && s.id === currentId))).length;
    return {
        total,
        currentDevice: current?.device || 'هذا الجهاز',
        currentIp: current?.ip || 'محلي',
        otherSessionsCount: others,
    };
}
