import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابات المدير المالي — الأبواب الخمسة التي كانت في V2 وحده:
 *
 *   قيد جديد            POST /api/accounting/journal                    (accounting-routes.js:833)
 *   اعتماد مسودة        POST /api/accounting/journal/:id/approve        (accounting-periods.js:165)
 *   إلغاء قيد           POST /api/accounting/journal/:id/void           (accounting-routes.js:856)
 *   إقفال فترة          POST /api/accounting/periods/:period/close      (accounting-periods.js:108)
 *   إعادة فتح فترة      POST /api/accounting/periods/:period/open       (accounting-periods.js:135)
 *
 * الأدوار حرفيًّا: الكتابة `admin|accountant`، وإعادة فتح الفترة `admin` وحده.
 * كل المبالغ تُرسل أرقامًا بسنتين بعد تحقق محلي على مستوى السنت — لا مقارنة
 * عائمة، والخادم يبقى الحكم النهائي (توازن، فترة مقفلة، مرجع مكرر).
 */

export const CFO_WRITE_ROLES = ['admin', 'accountant'] as const;
export const CFO_REOPEN_ROLES = ['admin'] as const;

export function canWriteCfo(role: string | null | undefined): boolean {
    return isWriteRole(role, CFO_WRITE_ROLES);
}

export function canReopenCfo(role: string | null | undefined): boolean {
    return isWriteRole(role, CFO_REOPEN_ROLES);
}

const text = z.string().nullable().optional();
const flag = z.boolean().nullable().optional();
const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

export const chartAccountSchema = z
    .object({
        code: z.union([z.string(), z.number()]).transform((value) => String(value)),
        name_ar: text,
        name_en: text,
        type: text,
        is_postable: flag,
        is_active: flag,
    })
    .passthrough();

export type ChartAccount = z.infer<typeof chartAccountSchema>;
export const chartSchema = z.array(chartAccountSchema);

export const draftEntrySchema = z
    .object({
        id: idValue,
        entry_no: text,
        date: text,
        memo: text,
        total: z.union([z.string(), z.number()]).nullable().optional(),
        created_by_name: text,
        status: text,
    })
    .passthrough();

export type DraftEntry = z.infer<typeof draftEntrySchema>;

export const draftsSchema = z
    .object({
        ok: z.boolean().optional(),
        count: z.union([z.string(), z.number()]).optional(),
        drafts: z.array(draftEntrySchema),
    })
    .passthrough();

const entrySchema = z.object({ id: idValue }).passthrough();
const createSchema = z.object({ entry: entrySchema, lines: z.array(z.object({}).passthrough()).optional() }).passthrough();
const actionSchema = z
    .object({ ok: z.boolean().optional(), entry: entrySchema.optional(), period: z.string().optional(), closed: z.boolean().optional() })
    .passthrough();

export interface JournalLineInput {
    accountCode: string;
    debit: string;
    credit: string;
}

export interface JournalLinePayload {
    account_code: string;
    debit: number;
    credit: number;
}

export interface JournalEntryPayload {
    date: string;
    memo: string;
    lines: JournalLinePayload[];
    status: 'draft' | 'posted';
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** مبلغ نصي → سنتات صحيحة؛ يقبل فاصلة واحدة وكسرًا حتى منزلتين. */
export function parseAmountCents(value: unknown): number | null {
    const raw = String(value ?? '')
        .trim()
        .replace(/,/g, '');
    if (!raw) {
        return 0;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
        return null;
    }
    const [whole, fraction = ''] = raw.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(cents) ? cents : null;
}

/** سطر إدخال → حمولة، أو null إذا كان بلا حساب أو بلا مبلغ. */
export function journalLinePayload(line: JournalLineInput): JournalLinePayload | null {
    const accountCode = String(line.accountCode ?? '').trim();
    const debit = parseAmountCents(line.debit);
    const credit = parseAmountCents(line.credit);
    if (!accountCode || debit === null || credit === null) {
        return null;
    }
    if (debit <= 0 && credit <= 0) {
        return null;
    }
    return { account_code: accountCode, debit: debit / 100, credit: credit / 100 };
}

export interface JournalTotals {
    debit: number;
    credit: number;
    balanced: boolean;
}

/** مجاميع الإدخال بالسنت — للعرض وللتحقق قبل الإرسال. */
export function journalTotals(lines: readonly JournalLineInput[]): JournalTotals {
    let debit = 0;
    let credit = 0;
    for (const line of lines) {
        debit += parseAmountCents(line.debit) ?? 0;
        credit += parseAmountCents(line.credit) ?? 0;
    }
    return { debit, credit, balanced: debit === credit };
}

export type JournalValidation = { ok: true; payload: JournalEntryPayload } | { ok: false; error: string };

export function validateJournalEntry(date: string, lines: readonly JournalLineInput[], status: 'draft' | 'posted'): JournalValidation {
    const day = String(date ?? '').trim();
    if (!DATE_PATTERN.test(day)) {
        return { ok: false, error: 'التاريخ بصيغة YYYY-MM-DD' };
    }
    const payloadLines: JournalLinePayload[] = [];
    for (const line of lines) {
        const raw = String(line.accountCode ?? '').trim();
        if (!raw && !String(line.debit ?? '').trim() && !String(line.credit ?? '').trim()) {
            continue;
        }
        if (parseAmountCents(line.debit) === null || parseAmountCents(line.credit) === null) {
            return { ok: false, error: 'مبلغ غير صالح — أرقام بحد أقصى منزلتين عشريتين' };
        }
        const debit = parseAmountCents(line.debit) ?? 0;
        const credit = parseAmountCents(line.credit) ?? 0;
        if (!raw) {
            return { ok: false, error: 'كل سطر بمبلغ يحتاج حسابًا' };
        }
        if (debit > 0 && credit > 0) {
            return { ok: false, error: 'السطر الواحد إما مدين أو دائن — لا الاثنان' };
        }
        const built = journalLinePayload(line);
        if (built) {
            payloadLines.push(built);
        }
    }
    if (payloadLines.length < 2) {
        return { ok: false, error: 'القيد يحتاج سطرين على الأقل بمبالغ موجبة' };
    }
    const totals = journalTotals(lines);
    if (totals.debit !== totals.credit) {
        return {
            ok: false,
            error: `مجموع المدين لا يساوي الدائن (${(totals.debit / 100).toFixed(2)} / ${(totals.credit / 100).toFixed(2)})`,
        };
    }
    if (totals.debit === 0) {
        return { ok: false, error: 'القيد بلا مبلغ' };
    }
    return { ok: true, payload: { date: day, memo: '', lines: payloadLines, status } };
}

/** تاريخ اليوم بتوقيت الرياض — `YYYY-MM-DD` بلا انزياح مناطق. */
export function todayIso(now: Date = new Date()): string {
    return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}

export function chartUrl(): string {
    return '/api/accounting/chart';
}

export async function fetchChartAccounts(signal?: AbortSignal): Promise<ChartAccount[]> {
    return fetchJson(chartSchema, chartUrl(), getAccessToken(), signal ? { signal } : {});
}

export async function fetchDrafts(signal?: AbortSignal): Promise<DraftEntry[]> {
    const body = await fetchJson(draftsSchema, '/api/accounting/drafts', getAccessToken(), signal ? { signal } : {});
    return body.drafts;
}

export async function createJournalEntry(payload: JournalEntryPayload): Promise<void> {
    await writeJson(createSchema, '/api/accounting/journal', 'POST', payload);
}

export async function approveJournalEntry(id: string): Promise<void> {
    await writeJson(actionSchema, `/api/accounting/journal/${encodeURIComponent(id)}/approve`, 'POST', {});
}

export async function voidJournalEntry(id: string, reason: string): Promise<void> {
    await writeJson(actionSchema, `/api/accounting/journal/${encodeURIComponent(id)}/void`, 'POST', {
        reason: String(reason ?? '')
            .trim()
            .slice(0, 500),
    });
}

export function periodPath(period: string, action: 'close' | 'open'): string {
    return `/api/accounting/periods/${encodeURIComponent(period)}/${action}`;
}

export async function closePeriod(period: string, note: string): Promise<void> {
    await writeJson(actionSchema, periodPath(period, 'close'), 'POST', { note: String(note ?? '').slice(0, 255) });
}

export async function openPeriod(period: string, note: string): Promise<void> {
    await writeAck(periodPath(period, 'open'), 'POST', { note: String(note ?? '').slice(0, 200) });
}

export const CFO_WRITE_TEXT = {
    newEntry: 'قيد جديد',
    drafts: 'المسودات',
    periods: 'الفترات',
    entryTitle: 'قيد يومية جديد',
    entryHint: 'المدين والدائن يجب أن يتساويا. «حفظ كمسودة» لا يؤثر على الميزان حتى يُعتمد.',
    date: 'التاريخ',
    memo: 'البيان',
    memoPlaceholder: 'مثال: تسوية مصروفات نقدية',
    account: 'الحساب',
    debit: 'مدين',
    credit: 'دائن',
    addLine: 'إضافة سطر',
    removeLine: 'حذف',
    saveDraft: 'حفظ كمسودة',
    post: 'ترحيل القيد',
    close: 'إغلاق',
    total: 'الإجمالي',
    balanced: 'متوازن',
    unbalanced: 'غير متوازن',
    draftsTitle: 'مسودات القيود',
    draftsHint: 'الاعتماد يرقّي المسودة إلى الأستاذ؛ الإلغاء يبقي أثرها للمراجعة.',
    noDrafts: 'لا مسودات معلّقة.',
    approve: 'اعتماد',
    void: 'إلغاء',
    voidConfirm: (entry: string) => `إلغاء القيد ${entry}؟ يبقى الأثر للمراجعة ويُستبعد من الميزان.`,
    voided: 'أُلغي القيد',
    approved: 'اعتُمد القيد',
    posted: 'رُحّل القيد',
    savedDraft: 'حُفظ القيد كمسودة',
    createFailed: 'تعذر حفظ القيد',
    approveFailed: 'تعذر اعتماد القيد',
    voidFailed: 'تعذر إلغاء القيد',
    periodsTitle: 'إقفال الفترات',
    periodsHint: 'الإقفال يمنع أي قيد أو اعتماد داخل الفترة. إعادة الفتح للإدارة فقط.',
    closePeriod: 'إقفال',
    openPeriod: 'إعادة فتح',
    closeConfirm: (period: string) => `إقفال الفترة ${period}؟ لن تُقبل قيود جديدة فيها.`,
    openConfirm: (period: string) => `إعادة فتح الفترة ${period}؟ سيُسجَّل الإجراء باسمك.`,
    periodClosed: 'أُقفلت الفترة',
    periodOpened: 'أُعيد فتح الفترة',
    periodFailed: 'تعذر تغيير حالة الفترة',
    loadFailed: 'تعذر تحميل الحسابات أو المسودات',
} as const;
