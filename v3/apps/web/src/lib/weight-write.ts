import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة قراءات الميزان — عبر كيان CRUD العام:
 *  • إنشاء  POST   /api/weightReadings        (admin|manager|warehouse|kitchen|sous_chef|dept_head = kitchenReturns)
 *  • تعديل  PUT    /api/weightReadings/:id
 *  • حذف     DELETE /api/weightReadings/:id
 *
 * تسجيل القراءة من الميزان الفعلي — نفس حقول V2 (weight/unit/date/time/itemName/notes/recordedBy).
 */

export const WEIGHT_WRITE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'] as const;

export function weightWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, WEIGHT_WRITE_ROLES);
}

export const WEIGHT_TEXT = {
    weightRequired: 'الوزن مطلوب',
    weightInvalid: 'أدخل وزنًا صحيحًا أكبر من صفر',
    unitRequired: 'الوحدة مطلوبة',
    createFailed: 'فشل تسجيل القراءة',
    updateFailed: 'فشل تعديل القراءة',
    deleteFailed: 'فشل حذف القراءة',
    createSuccess: 'تم تسجيل القراءة',
    updateSuccess: 'تم تعديل القراءة',
    deleteSuccess: 'تم حذف القراءة',
    cancel: 'إلغاء',
} as const;

export type WeightCreateInput = {
    weight: number;
    unit: string;
    date: string;
    time?: string | null;
    itemName?: string | null;
    notes?: string | null;
};

const weightResultSchema = z.object({ id: z.union([z.string(), z.number()]).optional() }).passthrough();
export type WeightResult = z.infer<typeof weightResultSchema>;

export async function createWeightReading(input: WeightCreateInput): Promise<WeightResult> {
    return writeJson(weightResultSchema, '/api/weightReadings', 'POST', {
        weight: Number(input.weight),
        unit: input.unit.trim(),
        date: input.date,
        time: input.time?.trim() || null,
        itemName: input.itemName?.trim() || null,
        notes: input.notes?.trim() || null,
        recordedBy: 'مستخدم v3',
    });
}

export async function updateWeightReading(id: string | number, input: Partial<WeightCreateInput>): Promise<WeightResult> {
    const payload: Record<string, unknown> = {};
    if (input.weight !== undefined) payload.weight = Number(input.weight);
    if (input.unit !== undefined) payload.unit = String(input.unit).trim();
    if (input.date !== undefined) payload.date = input.date;
    if (input.itemName !== undefined) payload.itemName = String(input.itemName).trim() || null;
    if (input.notes !== undefined) payload.notes = String(input.notes).trim() || null;
    return writeJson(weightResultSchema, `/api/weightReadings/${encodeURIComponent(String(id))}`, 'PUT', payload);
}

export async function deleteWeightReading(id: string | number): Promise<void> {
    await writeAck(`/api/weightReadings/${encodeURIComponent(String(id))}`, 'DELETE');
}
