import { z } from 'zod';
import { writeJson } from './write';

/**
 * كتابة الإجازات — منقولة من V2 عبر مسار الاعتماد المخصص
 * (backend/leave-workflow-routes.js):
 *  • إنشاء   POST /api/hr/leave-requests           (الموظف لنفسه عبر مسار الطلب)
 *  • قرار    POST /api/hr/leave-workflow/:id/action (سلسلة الاعتماد)
 */

export const LEAVE_TEXT = {
    employeeRequired: 'اختر الموظف صاحب الطلب',
    typeRequired: 'اختر نوع الإجازة',
    datesRequired: 'حدّد تاريخي البداية والنهاية',
    datesInvalid: 'تاريخ النهاية قبل البداية',
    actionRequired: 'اختر إجراءً',
    createFailed: 'فشل إنشاء طلب الإجازة',
    actionFailed: 'فشل تنفيذ الإجراء',
    createSuccess: 'تم إنشاء طلب الإجازة',
    actionSuccess: 'تم تنفيذ الإجراء',
    cancel: 'إلغاء',
} as const;

/* ── مخططات التحقق ────────────────────────────────────────────────────── */

export type LeaveCreateInput = {
    employeeId: string;
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    reason?: string | null;
};

export type LeaveActionKind = 'approve' | 'reject' | 'return';

const leaveResultSchema = z.object({ id: z.union([z.string(), z.number()]).optional() }).passthrough();
export type LeaveResult = z.infer<typeof leaveResultSchema>;

/* ── العمليات ─────────────────────────────────────────────────────────── */

export async function createLeaveRequest(input: LeaveCreateInput): Promise<LeaveResult> {
    return writeJson(leaveResultSchema, '/api/hr/leave-requests', 'POST', {
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason?.trim() || null,
    });
}

export async function decideLeaveRequest(workflowId: string | number, action: LeaveActionKind, note?: string): Promise<LeaveResult> {
    return writeJson(leaveResultSchema, `/api/hr/leave-workflow/${encodeURIComponent(String(workflowId))}/action`, 'POST', {
        action,
        note: note?.trim() || null,
    });
}
