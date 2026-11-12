import { z } from 'zod';

/**
 * عقود واتساب كما يعيدها الخادم فعلًا (`backend/whatsapp-engine/routes.js`).
 *
 * لاحظ الفرق عن V3 السابقة: الخادم لا يعيد `status`/`connected` في `/status`،
 * بل `connection.state` (CONNECTED/QR_REQUIRED/…)، وصندوق الوارد يعيد
 * `remote_jid` (لا `from`)، والصادر يعيد `preview` (لا `body`)، والقوالب تأتي
 * تحت `templates` (لا `rows`) بحقول `ar/en/variables`. المخطط يقبل الشكلين
 * حتى لا تنكسر شاشة أو اختبار قديم، والشاشة تعرض الصحيح.
 */

export const whatsappConnectionSchema = z.looseObject({
    state: z.string().optional().default('DISCONNECTED'),
    qrAvailable: z.boolean().optional().default(false),
    reconnects: z.coerce.number().optional().default(0),
    lastOkAt: z.string().nullable().optional(),
    lastError: z.string().nullable().optional(),
});
export type WhatsappConnection = z.infer<typeof whatsappConnectionSchema>;

export const whatsappStatusSchema = z.looseObject({
    status: z.string().optional(),
    connected: z.boolean().optional(),
    phone: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    qr: z.string().nullable().optional(),
    connection: whatsappConnectionSchema.optional(),
    queue: z
        .looseObject({
            inbox_pending: z.coerce.number().nullable().optional(),
            outbox_due: z.coerce.number().nullable().optional(),
        })
        .optional(),
    metrics: z.looseObject({ replied: z.coerce.number().optional() }).optional(),
});
export type WhatsappStatus = z.infer<typeof whatsappStatusSchema>;

/** حالة المحرك الفعلية — `connection.state` أولًا ثم الحقل القديم. */
export function whatsappEngineState(status: WhatsappStatus | undefined): string {
    return status?.connection?.state || status?.status || 'DISCONNECTED';
}

export function whatsappIsConnected(status: WhatsappStatus | undefined): boolean {
    return status?.connected === true || status?.connection?.state === 'CONNECTED';
}

/** نفس `/whatsapp/health` — طابور الصادر والوارد المعلق. */
export const whatsappHealthSchema = z.looseObject({
    ok: z.boolean().optional().default(true),
    state: z.string().optional(),
    queueDue: z.coerce.number().nullable().optional(),
    inboxPending: z.coerce.number().nullable().optional(),
    lastOkAt: z.string().nullable().optional(),
});
export type WhatsappHealth = z.infer<typeof whatsappHealthSchema>;

export const whatsappMessageSchema = z.looseObject({
    id: z.string().or(z.number()).transform(String),
    to: z.string().nullable().optional(),
    from: z.string().nullable().optional(),
    remote_jid: z.string().nullable().optional(),
    body: z.string().optional().default(''),
    timestamp: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    status: z.string().optional().default('received'),
    direction: z.string().optional().default('inbound'),
    chat_status: z.string().nullable().optional(),
    chat_priority: z.string().nullable().optional(),
});
export type WhatsappMessage = z.infer<typeof whatsappMessageSchema>;

/** محادثة الوارد: معرّفها `remote_jid` (V2 يسميه المحادثة). */
export function whatsappMessagePeer(row: WhatsappMessage): string {
    return row.remote_jid || row.from || row.to || '—';
}

export const whatsappOutboxSchema = z.looseObject({
    id: z.string().or(z.number()).transform(String),
    to: z.string().optional().default(''),
    body: z.string().optional().default(''),
    remote_jid: z.string().nullable().optional(),
    preview: z.string().nullable().optional(),
    status: z.string().optional().default('pending'),
    attempts: z.coerce.number().optional().default(0),
    created_at: z.string().nullable().optional(),
    sent_at: z.string().nullable().optional(),
    last_error: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
});
export type WhatsappOutbox = z.infer<typeof whatsappOutboxSchema>;

export function whatsappOutboxPeer(row: WhatsappOutbox): string {
    return row.to || row.remote_jid || '—';
}

export function whatsappOutboxPreview(row: WhatsappOutbox): string {
    return row.body || row.preview || '—';
}

export const whatsappTemplateSchema = z.looseObject({
    name: z.string(),
    body: z.string().optional().default(''),
    ar: z.string().nullable().optional().default(''),
    en: z.string().nullable().optional().default(''),
    category: z.string().optional().default('عام'),
    variables: z.coerce.number().optional().default(0),
});
export type WhatsappTemplate = z.infer<typeof whatsappTemplateSchema>;

/** نص القالب كما يُعرض — الخادم يعيد `ar/en` لا `body`. */
export function whatsappTemplateText(tpl: WhatsappTemplate): string {
    return tpl.body || tpl.ar || tpl.en || '';
}

export const whatsappMessagesResponseSchema = z.looseObject({
    rows: z.array(whatsappMessageSchema).optional().default([]),
    total: z.coerce.number().optional(),
});

export const whatsappOutboxResponseSchema = z.looseObject({
    rows: z.array(whatsappOutboxSchema).optional().default([]),
});

export const whatsappTemplatesResponseSchema = z.looseObject({
    rows: z.array(whatsappTemplateSchema).optional(),
    templates: z.array(whatsappTemplateSchema).optional(),
});

/** القوالب من أي من الشكلين (`templates` هو شكل الخادم الحالي). */
export function whatsappTemplateRows(data: z.infer<typeof whatsappTemplatesResponseSchema> | undefined): WhatsappTemplate[] {
    if (!data) {
        return [];
    }
    return data.templates ?? data.rows ?? [];
}

export const whatsappRulesResponseSchema = z.looseObject({
    rows: z
        .array(
            z.looseObject({
                id: z.string().or(z.number()).transform(String),
                name: z.string().optional().default(''),
                match_type: z.string().optional().default('exact'),
                pattern: z.string().optional().default(''),
                response: z.string().nullable().optional().default(''),
                enabled: z.boolean().optional().default(true),
                priority: z.coerce.number().optional(),
            }),
        )
        .optional()
        .default([]),
});
export type WhatsappRule = z.infer<typeof whatsappRulesResponseSchema>['rows'][number];

export const whatsappManagersResponseSchema = z.looseObject({
    numbers: z.array(z.string().or(z.number()).transform(String)).optional().default([]),
});

export const whatsappAutomationSettingsSchema = z.looseObject({
    dailyTime: z.string().optional().default('23:30'),
    dailyReport: z.boolean().optional(),
    alertDevice: z.boolean().optional(),
    alertUnmapped: z.boolean().optional(),
    alertFailed: z.boolean().optional(),
    alertDocs: z.boolean().optional(),
    alertShifts: z.boolean().optional(),
});
export type WhatsappAutomationSettings = z.infer<typeof whatsappAutomationSettingsSchema>;

export const whatsappAutomationResponseSchema = z.looseObject({
    settings: whatsappAutomationSettingsSchema.optional().default({ dailyTime: '23:30' }),
});

export const whatsappTestAutomationResponseSchema = z.looseObject({
    ok: z.boolean().optional(),
    queued: z.coerce.number().optional().default(0),
});

export const whatsappCampaignSchema = z.looseObject({
    id: z.string().or(z.number()).transform(String),
    name: z.string().optional().default(''),
    template_name: z.string().optional().default(''),
    status: z.string().optional().default('draft'),
    scheduled_at: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    recipients: z.coerce.number().optional().default(0),
    consented: z.coerce.number().optional().default(0),
    sent: z.coerce.number().optional().default(0),
});
export type WhatsappCampaign = z.infer<typeof whatsappCampaignSchema>;

export const whatsappCampaignsResponseSchema = z.looseObject({
    campaigns: z.array(whatsappCampaignSchema).optional().default([]),
});

export const whatsappLogEntrySchema = z.looseObject({
    id: z.string().or(z.number()).transform(String).optional(),
    created_at: z.string().nullable().optional(),
    kind: z.string().nullable().optional(),
    ref: z.string().nullable().optional(),
    detail: z.string().nullable().optional(),
});
export type WhatsappLogEntry = z.infer<typeof whatsappLogEntrySchema>;

export const whatsappLogsResponseSchema = z.looseObject({
    rows: z.array(whatsappLogEntrySchema).optional().default([]),
});

export const whatsappQueryCategoriesResponseSchema = z.looseObject({
    categories: z
        .array(z.looseObject({ key: z.string().optional(), label: z.string().optional() }))
        .optional()
        .default([]),
});

export const whatsappQueryResponseSchema = z.looseObject({
    ok: z.boolean().optional(),
    result: z.string().optional().default(''),
    question: z.string().optional(),
});

export const whatsappQrResponseSchema = z.looseObject({
    ok: z.boolean().optional(),
    connected: z.boolean().optional(),
    qr: z.string().nullable().optional(),
    at: z.string().nullable().optional(),
    state: z.string().optional(),
});

export const whatsappPairingResponseSchema = z.looseObject({
    ok: z.boolean().optional(),
    code: z.string().optional().default(''),
});

export const whatsappChatMetaSchema = z.looseObject({
    ok: z.boolean().optional(),
    meta: z.unknown().optional(),
});

export function resolveWhatsappStateAr(
    status: string | undefined,
    connected: boolean | undefined,
): { label: string; tone: 'success' | 'warn' | 'danger' | 'muted' } {
    if (connected || status === 'CONNECTED') {
        return { label: 'متصل ومفعّل', tone: 'success' };
    }
    if (status === 'QR_REQUIRED' || status === 'CONNECTING' || status === 'RECONNECTING') {
        return { label: status === 'RECONNECTING' ? 'جارٍ إعادة الاتصال' : 'بانتظار مسح الرمز QR', tone: 'warn' };
    }
    if (status === 'AUTHENTICATING') {
        return { label: 'جارٍ التحقق من الجلسة', tone: 'warn' };
    }
    if (status === 'INITIALIZING') {
        return { label: 'جارٍ التهيئة', tone: 'warn' };
    }
    if (status === 'BANNED') {
        return { label: 'الرقم محظور', tone: 'danger' };
    }
    if (status === 'FAILED' || status === 'ERROR') {
        return { label: 'خطأ في الاتصال', tone: 'danger' };
    }
    if (status === 'LOGGED_OUT') {
        return { label: 'تم تسجيل الخروج', tone: 'danger' };
    }
    if (status === 'STOPPED') {
        return { label: 'المحرك متوقف', tone: 'muted' };
    }
    return { label: 'غير متصل', tone: 'muted' };
}
