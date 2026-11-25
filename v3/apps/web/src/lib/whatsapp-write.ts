import { fetchJson } from './api';
import { getAccessToken } from './auth';
import {
    type WhatsappAutomationSettings,
    whatsappAutomationResponseSchema,
    whatsappCampaignsResponseSchema,
    whatsappChatMetaSchema,
    whatsappHealthSchema,
    whatsappLogsResponseSchema,
    whatsappManagersResponseSchema,
    whatsappMessagesResponseSchema,
    whatsappOutboxResponseSchema,
    whatsappPairingResponseSchema,
    whatsappQrResponseSchema,
    whatsappQueryCategoriesResponseSchema,
    whatsappQueryResponseSchema,
    whatsappRulesResponseSchema,
    whatsappStatusSchema,
    whatsappTemplatesResponseSchema,
    whatsappTestAutomationResponseSchema,
} from './whatsapp';
import { isWriteRole, writeAckSchema as whatsappAckSchema, writeJson } from './write';

/**
 * كتابة واتساب — نقل حرفي لعقود `frontend/app/js/v2/data/whatsapp-repo.js`.
 *
 * الأدوار كما في V2 والشاشة القديمة: `admin|manager` يكتبان، و`admin` وحده
 * يدير الجلسة (logout)، والقوالب/الحملات/أرقام الإدارة/التنبيهات.
 * الخادم يفرض نفس الشيء (`backend/whatsapp-engine/routes.js`) — هذا حجب
 * للأزرار فقط، لا بديل عن البوابة.
 */

export const WA_WRITE_ROLES = Object.freeze(['admin', 'manager']);

export function canManageWhatsapp(role: string | null | undefined): boolean {
    return isWriteRole(role, WA_WRITE_ROLES);
}

export function isWhatsappAdmin(role: string | null | undefined): boolean {
    return String(role ?? '').trim() === 'admin';
}

export const WA_TEXT = Object.freeze({
    started: 'تم طلب بدء المحرك',
    stopped: 'تم إيقاف المحرك',
    loggedOut: 'تم تسجيل الخروج؛ يلزم ربط QR جديد',
    qrRefreshed: 'تم إنشاء رمز QR جديد',
    pairRequested: 'تم إنشاء رمز الربط',
    sent: 'أُضيفت الرسالة إلى الطابور',
    templateSaved: 'تم حفظ القالب',
    templateSent: 'أُضيف القالب إلى طابور الصادر',
    ruleSaved: 'تم حفظ قاعدة الرد',
    ruleDeleted: 'تم تعطيل قاعدة الرد',
    managerAdded: 'تمت إضافة رقم الإدارة',
    managerDeleted: 'تم حذف الرقم من الإدارة',
    automationSaved: 'تم حفظ إعدادات التنبيهات',
    campaignCreated: 'أُنشئت المسودة؛ لم يُرسل شيء قبل الاعتماد',
    campaignUpdated: 'تم تحديث الحملة',
    chatSaved: 'تم تحديث حالة المحادثة',
    saveFailed: 'تعذّر حفظ التغييرات',
    qrUnavailable: 'تعذّر تحميل مولّد QR المحلي؛ لم يُعرض نص الرمز لحماية بيانات الربط.',
});

/* ─── قراءات ────────────────────────────────────────────────────────────── */

export function fetchWhatsappStatus(signal?: AbortSignal) {
    return fetchJson(whatsappStatusSchema, '/api/whatsapp/status', getAccessToken(), signal ? { signal } : {});
}

export function fetchWhatsappHealth(signal?: AbortSignal) {
    return fetchJson(whatsappHealthSchema, '/api/whatsapp/health', getAccessToken(), signal ? { signal } : {});
}

export function fetchWhatsappQr(signal?: AbortSignal) {
    return fetchJson(whatsappQrResponseSchema, '/api/whatsapp/qr', getAccessToken(), signal ? { signal } : {});
}

export function fetchWhatsappMessages(limit = 50, signal?: AbortSignal) {
    const safeLimit = Math.max(5, Math.min(100, Math.floor(Number(limit) || 50)));
    return fetchJson(
        whatsappMessagesResponseSchema,
        `/api/whatsapp/messages?limit=${safeLimit}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export function fetchWhatsappOutbox(signal?: AbortSignal) {
    return fetchJson(whatsappOutboxResponseSchema, '/api/whatsapp/outbox', getAccessToken(), signal ? { signal } : {});
}

export function fetchWhatsappTemplates(signal?: AbortSignal) {
    return fetchJson(whatsappTemplatesResponseSchema, '/api/whatsapp/templates', getAccessToken(), signal ? { signal } : {});
}

export function fetchWhatsappRules(signal?: AbortSignal) {
    return fetchJson(whatsappRulesResponseSchema, '/api/whatsapp/rules', getAccessToken(), signal ? { signal } : {});
}

export function fetchWhatsappManagers(signal?: AbortSignal) {
    return fetchJson(whatsappManagersResponseSchema, '/api/whatsapp/managers', getAccessToken(), signal ? { signal } : {});
}

export function fetchWhatsappAutomation(signal?: AbortSignal) {
    return fetchJson(whatsappAutomationResponseSchema, '/api/whatsapp/automation', getAccessToken(), signal ? { signal } : {});
}

export function fetchWhatsappCampaigns(signal?: AbortSignal) {
    return fetchJson(whatsappCampaignsResponseSchema, '/api/whatsapp/campaigns', getAccessToken(), signal ? { signal } : {});
}

export function fetchWhatsappLogs(signal?: AbortSignal) {
    return fetchJson(whatsappLogsResponseSchema, '/api/whatsapp/logs', getAccessToken(), signal ? { signal } : {});
}

export function fetchWhatsappQueryCategories(signal?: AbortSignal) {
    return fetchJson(whatsappQueryCategoriesResponseSchema, '/api/whatsapp/query/categories', getAccessToken(), signal ? { signal } : {});
}

/* ─── محرك الاتصال ─────────────────────────────────────────────────────── */

export function startWhatsapp() {
    return writeJson(whatsappAckSchema, '/api/whatsapp/start', 'POST');
}

export function stopWhatsapp() {
    return writeJson(whatsappAckSchema, '/api/whatsapp/stop', 'POST');
}

/** `admin` فقط — التأكيد كلمة LOGOUT كما يفرضه الخادم. */
export function logoutWhatsapp() {
    return writeJson(whatsappAckSchema, '/api/whatsapp/logout', 'POST', { confirm: 'LOGOUT' });
}

export function refreshWhatsappQr() {
    return writeJson(whatsappAckSchema, '/api/whatsapp/qr/refresh', 'POST');
}

export function requestWhatsappPairing(phone: string) {
    const error = pairingPhoneError(phone);
    if (error) {
        throw new Error(error);
    }
    return writeJson(whatsappPairingResponseSchema, '/api/whatsapp/pairing', 'POST', {
        phone: String(phone).replace(/\D/g, ''),
    });
}

export function pairingPhoneError(phone: string): string {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits) {
        return 'أدخل رقم الهاتف بالصيغة الدولية دون +';
    }
    if (!/^\d{7,16}$/.test(digits)) {
        return 'رقم غير صالح — من 7 إلى 16 رقمًا دون رموز';
    }
    return '';
}

/* ─── الرسائل والقوالب ─────────────────────────────────────────────────── */

export function sendWhatsappMessage(to: string, body: string) {
    const error = messageFormError(to, body);
    if (error) {
        throw new Error(error);
    }
    return writeJson(whatsappAckSchema, '/api/whatsapp/send', 'POST', {
        to: String(to).trim(),
        body: String(body).trim().slice(0, 4000),
    });
}

export function messageFormError(to: string, body: string): string {
    if (!String(to ?? '').trim()) {
        return 'أدخل المستلم بصيغة 9665XXXXXXXX@s.whatsapp.net';
    }
    if (!String(body ?? '').trim()) {
        return 'اكتب نص الرسالة';
    }
    return '';
}

export interface WhatsappTemplateForm {
    name: string;
    category: string;
    ar: string;
    en: string;
    variables: number;
}

export function templateFormError(form: WhatsappTemplateForm): string {
    const variables = Number(form.variables);
    if (!String(form.name ?? '').trim()) {
        return 'أدخل اسم القالب';
    }
    if (!String(form.ar ?? '').trim() && !String(form.en ?? '').trim()) {
        return 'أدخل نصًا عربيًا أو إنجليزيًا على الأقل';
    }
    if (!Number.isInteger(variables) || variables < 0 || variables > 20) {
        return 'عدد المتغيرات من 0 إلى 20';
    }
    return '';
}

/** `admin` فقط — البوابة في الخادم. */
export function saveWhatsappTemplate(form: WhatsappTemplateForm) {
    const error = templateFormError(form);
    if (error) {
        throw new Error(error);
    }
    return writeJson(whatsappAckSchema, '/api/whatsapp/templates', 'POST', {
        name: String(form.name).trim(),
        category: String(form.category ?? '').trim() || 'general',
        ar: String(form.ar ?? '').trim(),
        en: String(form.en ?? '').trim(),
        variables: Number(form.variables),
    });
}

export function sendWhatsappTemplate(input: { to: string; name: string; lang?: 'ar' | 'en'; vars?: readonly string[] }) {
    const to = String(input.to ?? '').trim();
    const name = String(input.name ?? '').trim();
    if (!to) {
        throw new Error('أدخل المستلم بصيغة 9665XXXXXXXX@s.whatsapp.net');
    }
    if (!name) {
        throw new Error('اختر قالبًا');
    }
    return writeJson(whatsappAckSchema, '/api/whatsapp/templates/send', 'POST', {
        to,
        name,
        lang: input.lang === 'en' ? 'en' : 'ar',
        vars: Array.isArray(input.vars) ? input.vars.map((value) => String(value).slice(0, 200)) : [],
    });
}

/* ─── قواعد الرد ───────────────────────────────────────────────────────── */

export interface WhatsappRuleForm {
    id?: string;
    name: string;
    match_type: string;
    pattern: string;
    response: string;
    enabled: boolean;
}

export function ruleFormError(form: WhatsappRuleForm): string {
    if (!String(form.name ?? '').trim()) {
        return 'أدخل اسم القاعدة';
    }
    if (!['exact', 'contains', 'command'].includes(String(form.match_type))) {
        return 'اختر نوع مطابقة صحيحًا';
    }
    if (!String(form.pattern ?? '').trim()) {
        return 'أدخل نمط المطابقة';
    }
    return '';
}

export function saveWhatsappRule(form: WhatsappRuleForm) {
    const error = ruleFormError(form);
    if (error) {
        throw new Error(error);
    }
    const payload: Record<string, unknown> = {
        name: String(form.name).trim(),
        match_type: String(form.match_type),
        pattern: String(form.pattern).trim(),
        response: String(form.response ?? ''),
        enabled: form.enabled === true,
    };
    if (form.id) {
        payload.id = Number(form.id);
    }
    return writeJson(whatsappAckSchema, '/api/whatsapp/rules', 'POST', payload);
}

export function deleteWhatsappRule(id: string) {
    return writeJson(whatsappAckSchema, `/api/whatsapp/rules/${encodeURIComponent(String(id ?? '').trim())}`, 'DELETE');
}

/* ─── أرقام الإدارة (admin) ───────────────────────────────────────────── */

export function managerNumberError(number: string): string {
    const digits = String(number ?? '').replace(/\D/g, '');
    if (!/^\d{7,16}$/.test(digits)) {
        return 'أدخل رقمًا دوليًا صحيحًا من 7 إلى 16 رقمًا دون رموز';
    }
    return '';
}

export function addWhatsappManager(number: string) {
    const error = managerNumberError(number);
    if (error) {
        throw new Error(error);
    }
    return writeJson(whatsappAckSchema, '/api/whatsapp/managers', 'POST', {
        number: String(number).replace(/\D/g, ''),
    });
}

export function deleteWhatsappManager(number: string) {
    return writeJson(whatsappAckSchema, `/api/whatsapp/managers/${encodeURIComponent(String(number ?? '').replace(/\D/g, ''))}`, 'DELETE');
}

/* ─── التنبيهات المجدولة (admin) ──────────────────────────────────────── */

export const AUTOMATION_TOGGLES = Object.freeze([
    { key: 'dailyReport', label: 'إرسال التقرير اليومي' },
    { key: 'alertDevice', label: 'تنبيه انقطاع أجهزة البصمة' },
    { key: 'alertUnmapped', label: 'تنبيه الأقسام غير المعتمدة' },
    { key: 'alertFailed', label: 'تنبيه الفواتير الفاشلة' },
    { key: 'alertDocs', label: 'تنبيه الوثائق المنتهية أو القريبة' },
    { key: 'alertShifts', label: 'تنبيه الورديات المفتوحة من أمس' },
] as const);

export function automationFormError(settings: { dailyTime: string }): string {
    if (!/^\d{2}:\d{2}$/.test(String(settings.dailyTime ?? ''))) {
        return 'وقت التقرير غير صالح';
    }
    return '';
}

export function saveWhatsappAutomation(settings: WhatsappAutomationSettings) {
    const error = automationFormError({ dailyTime: String(settings.dailyTime ?? '') });
    if (error) {
        throw new Error(error);
    }
    return writeJson(whatsappAckSchema, '/api/whatsapp/automation', 'POST', settings);
}

export function testWhatsappAutomation() {
    return writeJson(whatsappTestAutomationResponseSchema, '/api/whatsapp/automation/test', 'POST');
}

/* ─── الحملات (admin) ─────────────────────────────────────────────────── */

export interface CampaignRecipient {
    remote_jid: string;
    consent: boolean;
    vars: string[];
}

/**
 * سطور «رقم|موافقة|متغيرات,متغيرات» — نسخة حرفية من
 * `consentedCampaignRecipients` في V2 (`whatsapp.js:93-110`): الموافقة
 * الصريحة شرط دخول، والحد الأقصى 1000 مستلم و20 متغيرًا.
 */
export function consentedCampaignRecipients(raw: string): CampaignRecipient[] {
    return String(raw ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [remoteJid = '', consent = '', rawVars = ''] = line.split('|');
            const approved = ['yes', 'true', '1', 'نعم'].includes(consent.trim().toLowerCase());
            return {
                remote_jid: remoteJid.trim(),
                consent: approved,
                vars: rawVars
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean)
                    .slice(0, 20),
            };
        })
        .filter((recipient) => recipient.consent && recipient.remote_jid)
        .slice(0, 1000);
}

export function campaignFormError(input: {
    name: string;
    templateName: string;
    recipients: readonly CampaignRecipient[];
    scheduledAt?: string;
}): string {
    if (!String(input.name ?? '').trim()) {
        return 'أدخل اسم الحملة';
    }
    if (!String(input.templateName ?? '').trim()) {
        return 'أدخل اسم القالب';
    }
    if (!input.recipients.length) {
        return 'أدخل مستلمًا واحدًا على الأقل بموافقة صريحة';
    }
    if (input.scheduledAt && Number.isNaN(new Date(input.scheduledAt).getTime())) {
        return 'موعد الجدولة غير صالح';
    }
    return '';
}

export function createWhatsappCampaign(input: {
    name: string;
    templateName: string;
    recipients: readonly CampaignRecipient[];
    scheduledAt?: string;
}) {
    const error = campaignFormError(input);
    if (error) {
        throw new Error(error);
    }
    return writeJson(whatsappAckSchema, '/api/whatsapp/campaigns', 'POST', {
        name: String(input.name).trim(),
        template_name: String(input.templateName).trim(),
        recipients: input.recipients,
        ...(input.scheduledAt ? { scheduled_at: new Date(input.scheduledAt).toISOString() } : {}),
    });
}

export type CampaignAction = 'approve' | 'pause' | 'cancel';

export function actOnWhatsappCampaign(id: string, action: CampaignAction) {
    const campaignId = String(id ?? '').trim();
    if (!campaignId || !['approve', 'pause', 'cancel'].includes(action)) {
        throw new Error('إجراء الحملة غير صالح');
    }
    return writeJson(whatsappAckSchema, `/api/whatsapp/campaigns/${encodeURIComponent(campaignId)}/${action}`, 'POST');
}

export const CAMPAIGN_STATUS_AR: Readonly<Record<string, string>> = Object.freeze({
    draft: 'مسودة',
    approved: 'معتمدة',
    running: 'جارٍ الإرسال',
    paused: 'موقوفة',
    completed: 'مكتملة',
    cancelled: 'ملغاة',
});

/* ─── المحادثات ────────────────────────────────────────────────────────── */

export const CHAT_STATUS_OPTIONS = Object.freeze([
    { value: 'open', label: 'مفتوحة' },
    { value: 'pending', label: 'معلقة' },
    { value: 'resolved', label: 'محلولة' },
    { value: 'snoozed', label: 'مؤجلة' },
] as const);

export const CHAT_PRIORITY_OPTIONS = Object.freeze([
    { value: 'low', label: 'منخفضة' },
    { value: 'normal', label: 'عادية' },
    { value: 'high', label: 'عالية' },
    { value: 'urgent', label: 'عاجلة' },
] as const);

export const RULE_MATCH_OPTIONS = Object.freeze([
    { value: 'exact', label: 'مطابقة تامة' },
    { value: 'contains', label: 'يحتوي' },
    { value: 'command', label: 'أمر' },
] as const);

export function updateWhatsappChatMeta(jid: string, meta: { status: string; priority: string }) {
    const target = String(jid ?? '').trim();
    if (!target) {
        throw new Error('محادثة غير معروفة');
    }
    const statuses = CHAT_STATUS_OPTIONS.map((option) => option.value);
    const priorities = CHAT_PRIORITY_OPTIONS.map((option) => option.value);
    if (
        !statuses.includes(meta.status as (typeof statuses)[number]) ||
        !priorities.includes(meta.priority as (typeof priorities)[number])
    ) {
        throw new Error('بيانات المحادثة غير صالحة');
    }
    return writeJson(whatsappChatMetaSchema, `/api/whatsapp/chats/${encodeURIComponent(target)}/meta`, 'POST', {
        status: meta.status,
        priority: meta.priority,
    });
}

/* ─── اسأل النظام ──────────────────────────────────────────────────────── */

export function askWhatsappQuery(question: string) {
    const text = String(question ?? '').trim();
    if (!text) {
        throw new Error('اكتب السؤال أولًا');
    }
    return writeJson(whatsappQueryResponseSchema, '/api/whatsapp/query', 'POST', { question: text });
}

/**
 * الخادم يعيد HTML جاهزًا للعرض (`system-query.js`)، وV3 لا تحقن HTML من
 * الخادم. نحوّله إلى نص عادي: فواصل الأسطر عند `</div>`، وحذف الوسوم وفك
 * أشهر الكيانات — قراءة صادقة بلا `dangerouslySetInnerHTML`.
 */
export function waAnswerText(html: string): string {
    return String(html ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(div|p|tr|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/* ─── QR: نفس ملف V2 المخزَّن والمخبَّأ ────────────────────────────────── */

interface QrGlobal {
    toDataURL?: (text: string, options?: { width?: number; margin?: number; errorCorrectionLevel?: string }) => Promise<string>;
}

let qrPromise: Promise<boolean> | null = null;

function loadQrVendor(): Promise<boolean> {
    if (typeof window === 'undefined') {
        return Promise.resolve(false);
    }
    const existing = (window as unknown as { QRCode?: QrGlobal }).QRCode;
    if (existing && typeof existing.toDataURL === 'function') {
        return Promise.resolve(true);
    }
    if (qrPromise) {
        return qrPromise;
    }
    qrPromise = new Promise<boolean>((resolve) => {
        const tag = document.createElement('script');
        tag.src = '/app/js/vendor/qrcode.min.js?v=4.9.311';
        tag.async = true;
        tag.onload = () => resolve(typeof (window as unknown as { QRCode?: QrGlobal }).QRCode !== 'undefined');
        tag.onerror = () => {
            qrPromise = null;
            resolve(false);
        };
        document.head.appendChild(tag);
    });
    return qrPromise;
}

/** صورة QR كـdata URL، أو `null` حين يتعذّر المولّد — الشاشة تخبر المستخدم. */
export async function whatsappQrDataUrl(payload: string): Promise<string | null> {
    if (!payload) {
        return null;
    }
    const ok = await loadQrVendor();
    const qr = (window as unknown as { QRCode?: QrGlobal }).QRCode;
    if (!ok || !qr || typeof qr.toDataURL !== 'function') {
        return null;
    }
    try {
        return await qr.toDataURL(payload, { width: 240, margin: 1, errorCorrectionLevel: 'M' });
    } catch {
        return null;
    }
}
