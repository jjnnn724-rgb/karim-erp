import { z } from 'zod';

export const whatsappStatusSchema = z.object({
    status: z.string().optional().default('DISCONNECTED'),
    connected: z.boolean().optional().default(false),
    phone: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    qr: z.string().nullable().optional(),
});
export type WhatsappStatus = z.infer<typeof whatsappStatusSchema>;

export const whatsappMessageSchema = z.object({
    id: z.string().or(z.number()).transform(String),
    to: z.string().nullable().optional(),
    from: z.string().nullable().optional(),
    body: z.string().optional().default(''),
    timestamp: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    status: z.string().optional().default('received'),
    direction: z.string().optional().default('inbound'),
});
export type WhatsappMessage = z.infer<typeof whatsappMessageSchema>;

export const whatsappOutboxSchema = z.object({
    id: z.string().or(z.number()).transform(String),
    to: z.string(),
    body: z.string(),
    status: z.string().optional().default('pending'),
    created_at: z.string().nullable().optional(),
    sent_at: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
});
export type WhatsappOutbox = z.infer<typeof whatsappOutboxSchema>;

export const whatsappTemplateSchema = z.object({
    name: z.string(),
    body: z.string(),
    category: z.string().optional().default('عام'),
});
export type WhatsappTemplate = z.infer<typeof whatsappTemplateSchema>;

export const whatsappMessagesResponseSchema = z.object({
    rows: z.array(whatsappMessageSchema).optional().default([]),
});

export const whatsappOutboxResponseSchema = z.object({
    rows: z.array(whatsappOutboxSchema).optional().default([]),
});

export const whatsappTemplatesResponseSchema = z.object({
    rows: z.array(whatsappTemplateSchema).optional().default([]),
});

export function resolveWhatsappStateAr(status: string | undefined, connected: boolean | undefined): { label: string; tone: 'success' | 'warn' | 'danger' | 'muted' } {
    if (connected || status === 'CONNECTED') {
        return { label: 'متصل ومفعّل', tone: 'success' };
    }
    if (status === 'QR_REQUIRED' || status === 'CONNECTING') {
        return { label: 'بانتظار مسح الرمز QR', tone: 'warn' };
    }
    if (status === 'BANNED' || status === 'ERROR') {
        return { label: 'خطأ في الاتصال', tone: 'danger' };
    }
    return { label: 'غير متصل', tone: 'muted' };
}
