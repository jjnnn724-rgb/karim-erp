import { writeAck } from './write';

/**
 * كتابة سجلّي الإيرادات والمصروفات — نظير `data/finance-write-repo.js` في V2.
 *
 * العقد المنقول حرفيًّا:
 *   POST   /api/revenues · PUT    /api/revenues/:id · DELETE /api/revenues/:id
 *   POST   /api/expenses  · PUT    /api/expenses/:id  · DELETE /api/expenses/:id
 * والحارس في الخادم `OPEN_ENTITY_WRITE_ROLES.revenues/expenses` =
 * `admin|manager|accountant`، وهو نفس قائمة V2 (بوابة زرّية هنا، وأمنية هناك).
 *
 * الإنشاء كان في V2 من شاشة تفاصيل القسم؛ هنا نماذج إضافة من السجل نفسه
 * بنفس الحقول والتحقق والمسارات (أولويات التطوير التالية).
 */

/** مرآة OPEN_ENTITY_WRITE_ROLES على revenues و expenses. */
export const FINANCE_WRITE_ROLES = ['admin', 'manager', 'accountant'] as const;

/** فئات المصروفات الأربع في V2 (expenses.js:251). */
export const EXPENSE_CATEGORIES = ['مواد خام', 'رواتب', 'تشغيل', 'أخرى'] as const;

export type FinanceEntity = 'revenues' | 'expenses';

export interface RevenueForm {
    source: string;
    deptId: string;
    amount: string;
    date: string;
    notes: string;
}

export interface ExpenseForm {
    desc: string;
    deptId: string;
    category: string;
    amount: string;
    date: string;
    notes: string;
}

export type FinanceForm = RevenueForm | ExpenseForm;

export type FinanceField = 'deptId' | 'amount' | 'date' | 'source' | 'desc' | 'category' | 'notes';

export interface FinanceFormError {
    field: FinanceField | '';
    message: string;
}

export const FINANCE_TEXT = {
    editRevenueTitle: 'تعديل إيراد',
    editExpenseTitle: 'تعديل مصروف',
    addRevenueTitle: 'إضافة إيراد',
    addExpenseTitle: 'إضافة مصروف',
    save: 'حفظ',
    cancel: 'إلغاء',
    revenueHint: 'التعديل يمسّ سجلًا ماليًا حقيقيًا؛ حقول خارج قائمة الكتابة لا تُرسل أصلًا، ورفض الخادم يظهر حرفيًا هنا.',
    saveFailed: 'فشل الحفظ',
} as const;

const trim = (value: unknown): string => String(value ?? '').trim();
const amountOf = (value: unknown): number => Number.parseFloat(String(value ?? ''));

/** شروط بوابة الإضافة في legacy finance.js:127 + نصوص الخادم — حرفيًّا. */
export function validateRevenueForm(form: Partial<RevenueForm>): FinanceFormError[] {
    const errors: FinanceFormError[] = [];
    const deptId = trim(form.deptId);
    const source = trim(form.source);
    const date = trim(form.date);
    const amount = amountOf(form.amount);

    if (!deptId) {
        errors.push({ field: 'deptId', message: 'القسم مطلوب' });
    } else if (deptId.length > 50) {
        errors.push({ field: 'deptId', message: 'الحقل "deptId" أطول من المسموح (الحد الأقصى 50 حرفًا)' });
    }
    if (!Number.isFinite(amount)) {
        errors.push({ field: 'amount', message: 'الحقل "amount" يجب أن يكون رقمًا' });
    } else if (amount <= 0) {
        errors.push({ field: 'amount', message: 'المبلغ يجب أن يكون أكبر من صفر' });
    }
    if (!date) {
        errors.push({ field: 'date', message: 'الحقل "date" يجب أن يكون تاريخًا صحيحًا' });
    }
    if (!source) {
        errors.push({ field: 'source', message: 'المصدر مطلوب' });
    } else if (source.length > 255) {
        errors.push({ field: 'source', message: 'الحقل "source" أطول من المسموح (الحد الأقصى 255 حرفًا)' });
    }
    return errors;
}

/** شروط بوابة الإضافة legacy finance.js:208 + نفس نصوص الخادم (desc 255 · category 100). */
export function validateExpenseForm(form: Partial<ExpenseForm>): FinanceFormError[] {
    const errors: FinanceFormError[] = [];
    const deptId = trim(form.deptId);
    const desc = trim(form.desc);
    const date = trim(form.date);
    const category = trim(form.category);
    const amount = amountOf(form.amount);

    if (!deptId) {
        errors.push({ field: 'deptId', message: 'القسم مطلوب' });
    } else if (deptId.length > 50) {
        errors.push({ field: 'deptId', message: 'الحقل "deptId" أطول من المسموح (الحد الأقصى 50 حرفًا)' });
    }
    if (!Number.isFinite(amount)) {
        errors.push({ field: 'amount', message: 'الحقل "amount" يجب أن يكون رقمًا' });
    } else if (amount <= 0) {
        errors.push({ field: 'amount', message: 'المبلغ يجب أن يكون أكبر من صفر' });
    }
    if (!date) {
        errors.push({ field: 'date', message: 'الحقل "date" يجب أن يكون تاريخًا صحيحًا' });
    }
    if (!desc) {
        errors.push({ field: 'desc', message: 'البيان مطلوب' });
    } else if (desc.length > 255) {
        errors.push({ field: 'desc', message: 'الحقل "desc" أطول من المسموح (الحد الأقصى 255 حرفًا)' });
    }
    if (category && category.length > 100) {
        errors.push({ field: 'category', message: 'الحقل "category" أطول من المسموح (الحد الأقصى 100 حرفًا)' });
    }
    return errors;
}

/** صندوق الإرسال = مفاتيح persistUpdate('revenues') في legacy finance.js:150. */
export function normalizeRevenueForm(form: Partial<RevenueForm>): {
    deptId: string;
    source: string;
    amount: number;
    date: string;
    notes: string;
} {
    return {
        deptId: trim(form.deptId),
        source: trim(form.source),
        amount: Number(form.amount),
        date: trim(form.date),
        notes: trim(form.notes),
    };
}

/** صندوق الإرسال = مفاتيح persistUpdate('expenses') في legacy finance.js:231. */
export function normalizeExpenseForm(form: Partial<ExpenseForm>): {
    deptId: string;
    desc: string;
    amount: number;
    date: string;
    category: string;
    notes: string;
} {
    return {
        deptId: trim(form.deptId),
        desc: trim(form.desc),
        amount: Number(form.amount),
        date: trim(form.date),
        category: trim(form.category),
        notes: trim(form.notes),
    };
}

/** صف الإيراد → نموذج قابل للتعديل (القيم كما هي، بلا اختراع). */
export function revenueFormOf(row: Record<string, unknown>): RevenueForm {
    return {
        source: trim(row.source),
        deptId: trim(row.deptId),
        amount: trim(row.amount),
        date: trim(row.date).slice(0, 10),
        notes: trim(row.notes),
    };
}

export function expenseFormOf(row: Record<string, unknown>): ExpenseForm {
    return {
        desc: trim(row.desc),
        deptId: trim(row.deptId),
        category: trim(row.category),
        amount: trim(row.amount),
        date: trim(row.date).slice(0, 10),
        notes: trim(row.notes),
    };
}

/** صفٌّ آليّ (autoGenerated) مقفول عن التعديل في V2 — لا زر تعديل له. */
export function isLockedExpense(row: Record<string, unknown>): boolean {
    return row.autoGenerated === true || row.autoGenerated === 1 || row.autoGenerated === '1';
}

/** نصوص V2 الحرفية للتأكيد/النجاح. */
export function revenueNameOf(row: Record<string, unknown>): string {
    return trim(row.source);
}

export function expenseNameOf(row: Record<string, unknown>): string {
    return trim(row.desc);
}

export function updateRevenueSuccess(source: string): string {
    return `تم تعديل إيراد «${trim(source)}»`;
}

export function addRevenueSuccess(source: string): string {
    return `تم إضافة إيراد «${trim(source)}»`;
}

export function deleteRevenueConfirm(name: string, id: string): string {
    return `حذف إيراد «${trim(name) || `#${id}`}»؟ لا رجعة بعد الحذف.`;
}

export function deleteRevenueSuccess(name: string, id: string): string {
    return `تم حذف إيراد «${trim(name) || `#${id}`}»`;
}

export function updateExpenseSuccess(desc: string): string {
    return `تم تعديل مصروف «${trim(desc)}»`;
}

export function addExpenseSuccess(desc: string): string {
    return `تم إضافة مصروف «${trim(desc)}»`;
}

export function deleteExpenseConfirm(name: string, id: string): string {
    return `حذف مصروف «${trim(name) || `#${id}`}»؟ لا رجعة بعد الحذف.`;
}

export function deleteExpenseSuccess(name: string, id: string): string {
    return `تم حذف مصروف «${trim(name) || `#${id}`}»`;
}

/** خطأ العمليات في V2: «فشلت العملية: <رسالة الخادم>». */
export function financeFailureText(message: string): string {
    return `فشلت العملية: ${message}`;
}

/** البوابات — نفس المسارات والطرق. */
export async function createRevenue(form: Partial<RevenueForm>): Promise<void> {
    await writeAck('/api/revenues', 'POST', normalizeRevenueForm(form));
}

export async function updateRevenue(id: string, form: Partial<RevenueForm>): Promise<void> {
    await writeAck(`/api/revenues/${encodeURIComponent(id)}`, 'PUT', normalizeRevenueForm(form));
}

export async function deleteRevenue(id: string): Promise<void> {
    await writeAck(`/api/revenues/${encodeURIComponent(id)}`, 'DELETE');
}

export async function createExpense(form: Partial<ExpenseForm>): Promise<void> {
    await writeAck('/api/expenses', 'POST', normalizeExpenseForm(form));
}

export async function updateExpense(id: string, form: Partial<ExpenseForm>): Promise<void> {
    await writeAck(`/api/expenses/${encodeURIComponent(id)}`, 'PUT', normalizeExpenseForm(form));
}

export async function deleteExpense(id: string): Promise<void> {
    await writeAck(`/api/expenses/${encodeURIComponent(id)}`, 'DELETE');
}

/** بوابة موحّدة حسب النوع — تستخدمها الشاشة المشتركة. */
export async function createRegisterRow(entity: FinanceEntity, form: FinanceForm): Promise<void> {
    if (entity === 'revenues') {
        await createRevenue(form as RevenueForm);
        return;
    }
    await createExpense(form as ExpenseForm);
}

export async function updateRegisterRow(entity: FinanceEntity, id: string, form: FinanceForm): Promise<void> {
    if (entity === 'revenues') {
        await updateRevenue(id, form as RevenueForm);
        return;
    }
    await updateExpense(id, form as ExpenseForm);
}

export async function deleteRegisterRow(entity: FinanceEntity, id: string): Promise<void> {
    if (entity === 'revenues') {
        await deleteRevenue(id);
        return;
    }
    await deleteExpense(id);
}

export function validateRegisterForm(entity: FinanceEntity, form: FinanceForm): FinanceFormError[] {
    return entity === 'revenues' ? validateRevenueForm(form as RevenueForm) : validateExpenseForm(form as ExpenseForm);
}
