/**
 * ai-chat.ts — عميل المحادثة الذكية (V3) — قراءة فقط، admin فقط على الخادم.
 * ─────────────────────────────────────────────
 * الخطافتان الخامام:
 *   · `/api/ai-assistant/ask`   — سؤال → رد (Qwen محلي ثم Gemini ثم قاعدة محلية)
 *   · `/api/ai-assistant/status` — حالة النموذج المحلي + الموديل النشط (قابل للقراءة)
 *
 * لا حاوية ذاكرة على الخادم — التاريخ يُحفظ محليًا (localStorage) في المتصفح فقط.
 */
import { z } from 'zod';
import { fetchJson } from './api';
import { writeJson } from './write';
import { getAccessToken } from './auth';

export const ASK_MODES = ['knowledge', 'diagnose', 'code', 'cfo'] as const;
export type AskMode = (typeof ASK_MODES)[number];

export const askSchema = z
    .object({
        text: z.string().nullable().optional(),
        mode: z.string().nullable().optional(),
        model: z.string().nullable().optional(),
        fallback: z.boolean().nullable().optional(),
        grounded: z.boolean().nullable().optional(),
        canDeep: z.boolean().nullable().optional(),
    })
    .passthrough();

export type AskResult = z.infer<typeof askSchema>;

export async function askAssistant(question: string, opts: { mode?: AskMode; screen?: string } = {}): Promise<AskResult> {
    return writeJson(
        askSchema,
        '/api/ai-assistant/ask',
        'POST',
        { question: question.slice(0, 800), mode: opts.mode ?? 'knowledge', ...(opts.screen ? { screen: opts.screen } : {}) },
    );
}

export const statusSchema = z
    .object({
        enabled: z.boolean().nullable().optional(),
        local: z.boolean().nullable().optional(),
        model: z.string().nullable().optional(),
        modes: z.array(z.string()).nullable().optional(),
        maxQuestion: z.number().nullable().optional(),
    })
    .passthrough();
export type AssistantStatus = z.infer<typeof statusSchema>;

export async function fetchStatus(signal?: AbortSignal): Promise<AssistantStatus> {
    return fetchJson(statusSchema, '/api/ai-assistant/status', getAccessToken(), signal ? { signal } : {});
}
