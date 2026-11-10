/**
 * المعرّفات كما يُصدرها القديم حرفيًا (ADR-06).
 *
 * `journal_entries.id` و`journal_lines.id` من نوع `bigint`؛ سائق pg يُعيد
 * bigint كـ **نص** فيُصدره JSON كنص («1794001627414356») — لا تحويل إلى Number
 * (يفقد الدقة عند 2^53). `branch_id` من نوع integer فيُصدر رقمًا.
 */

export const NUMERIC_ID_PATTERN = /^\d{1,19}$/;

export function isNumericId(value: unknown): value is string {
    return typeof value === 'string' && NUMERIC_ID_PATTERN.test(value);
}

export function isPositiveIntegerId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
