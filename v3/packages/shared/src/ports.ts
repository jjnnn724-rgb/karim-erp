/**
 * عقد القراءة المحاسبي — **منافذ** لا تنفيذ.
 *
 * موقعه في `@karim/shared` لأن طرفيه (`apps/api` و`packages/db`) لا يجوز أن
 * يعتمد أحدهما على الآخر: الـAPI لا يعرف Drizzle، والمستودع لا يعرف HTTP.
 * أسماء الحقول هي أسماء JSON القديمة (`name_ar` لا `nameAr`): العقد الذي
 * يُقارَن في shadow diff هو عقد HTTP القديم، وأي إعادة تسمية تُنشئ طبقة ترجمة
 * إضافية — وهي مصدر الانحراف الذي تمنعه بوابة G4.
 *
 * انحرافان معلنان عن القديم (قرار G3 لا سهو):
 *  1. `DATE` نصًّا `YYYY-MM-DD` (ADR-05) — القديم `T21:00:00.000Z`.
 *  2. `NUMERIC` نصًّا (ADR-04) — القديم رقم JSON في `/journal`.
 * التحويل إلى شكل القديم مسؤولية طبقة HTTP (`apps/api`)، لا المستودع.
 */

import type { MoneyString } from './money.js';

/** صف `/chart` — سبعة أعمدة بأسمائها القديمة، بلا `id` ولا `created_at`. */
export interface ChartAccountRow {
    code: string;
    name_ar: string;
    name_en: string | null;
    type: string;
    parent_code: string | null;
    is_postable: boolean;
    is_active: boolean;
}

/** سطر قيد كما يعرضه `/journal` القديم — أربعة حقول من `json_build_object`. */
export interface JournalLineRow {
    account_code: string;
    debit: string;
    credit: string;
    memo: string | null;
}

/** صف `/journal` — `e.*` القديم + `created_by_name` + السطور. */
export interface JournalEntryRow {
    id: string;
    entry_no: string;
    /** `YYYY-MM-DD` — انحراف ADR-05 المعلن. */
    date: string;
    memo: string | null;
    source_type: string;
    source_id: string | null;
    status: string;
    created_by: string | null;
    created_at: string;
    approved_by: string | null;
    approved_at: string | null;
    branch_id: number | null;
    created_by_name: string | null;
    lines: JournalLineRow[];
}

/** ما تحتاجه طبقة القراءة — لا Drizzle ولا HTTP في هذا العقد. */
export interface AccountingReadPort {
    listChartAccounts(): Promise<ChartAccountRow[]>;
    listChildAccounts(parentCode: string): Promise<ChartAccountRow[]>;
    listJournalEntries(limit: unknown): Promise<JournalEntryRow[]>;
    /** قيد واحد بنفس شكل صفوف `/journal`؛ `null` إن لم يوجد. */
    getJournalEntry(id: string): Promise<JournalEntryRow | null>;
}

/**
 * صف الإقرار الضريبي — **نصوص NUMERIC** في المنفذ (ADR-04)، بينما عقد HTTP
 * القديم أرقام JSON (`vatReturnResponseSchema`). التحويل في طبقة HTTP وحدها.
 */
export interface VatReturnRow {
    from: string;
    to: string;
    output_vat: MoneyString;
    input_vat: MoneyString;
    net_payable: MoneyString;
    carry_forward_credit: MoneyString;
    payable_balance: MoneyString;
    recoverable_balance: MoneyString;
    purchases_crosscheck: {
        count: number;
        net: MoneyString;
        vat: MoneyString;
    };
}

export interface VatReadPort {
    /** حركة الفترة + الأرصدة حتى `to` — يُطابق `/vat-return` القديم. */
    vatReturn(from: string, to: string): Promise<VatReturnRow>;
}

/**
 * أدوار قراءة المحاسبة — **مطابقة لـ`READ_ROLES` في
 * `backend/accounting-routes.js:26`**. تكرارها هنا مقصود للتحقق الدفاعي في
 * Hono؛ وأي انحراف بينهما يكشفه اختبار مصفوفة 401/403 في G4 (القديم يسمح،
 * والجديد يرفض أو العكس).
 */
export const ACCOUNTING_READ_ROLES = ['admin', 'accountant', 'manager', 'auditor'] as const;

export type AccountingReadRole = (typeof ACCOUNTING_READ_ROLES)[number];

/** سياق المستخدم كما يبنيه `jwtAuth` القديم في `req.user` حرفيًا. */
export interface V3User {
    id: number;
    role: string;
    name: string;
    dept_code: string | null;
    branch_id: number | null;
    session_id: string | null;
    sid: string | null;
    must_change_password: boolean;
}
