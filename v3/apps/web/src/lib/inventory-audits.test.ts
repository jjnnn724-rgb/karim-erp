import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    auditPeriodLabel,
    auditProgressLabel,
    auditSignatureError,
    auditStatusLabel,
    auditStatusTone,
    auditToday,
    canReadAudit,
    canWriteAudit,
    formatAuditQty,
    isAuditDraft,
    isAuditOpen,
    varianceLabel,
} from './inventory-audits';

/**
 * حارس الجرد الفعلي — العقد المنقول من خادم `stocktaking-routes.js`:
 * حالة/فترة/تقدم/فرق/توقيع. أي انحراف هنا يعني جلسة لا تُغلق أو توقيعًا
 * يُرفض بـ`SIGNATURE_REQUIRED` بلا سبب ظاهر للمستخدم.
 */

afterEach(() => {
    vi.restoreAllMocks();
});

function audit(overrides: Record<string, unknown> = {}) {
    return {
        id: '9',
        audit_number: 'AUD-20261110120000-0009',
        status: 'draft',
        total_items: 12,
        counted_items: 5,
        period_start: '2026-11-01',
        period_end: '2026-11-10',
        ...overrides,
    } as Parameters<typeof auditPeriodLabel>[0];
}

describe('الجرد — الأدوار مطابقة للخادم', () => {
    it('الكتابة: admin/manager/warehouse فقط', () => {
        expect(canWriteAudit('admin')).toBe(true);
        expect(canWriteAudit('manager')).toBe(true);
        expect(canWriteAudit('warehouse')).toBe(true);
        expect(canWriteAudit('accountant')).toBe(false);
        expect(canWriteAudit('')).toBe(false);
    });

    it('القراءة تشمل المحاسب', () => {
        expect(canReadAudit('accountant')).toBe(true);
        expect(canReadAudit('cashier')).toBe(false);
    });
});

describe('الجرد — عرض الحالة', () => {
    it('تسميات عربية لكل حالة خادم', () => {
        expect(auditStatusLabel('draft')).toContain('مسودة');
        expect(auditStatusLabel('submitted')).toContain('مراجعة');
        expect(auditStatusLabel('approved')).toContain('معتمد');
        expect(auditStatusLabel('cancelled')).toContain('ملغى');
    });

    it('نغمات الحالة: المعتمد نجاح، الملغى خطر', () => {
        expect(auditStatusTone('approved')).toBe('success');
        expect(auditStatusTone('submitted')).toBe('warning');
        expect(auditStatusTone('cancelled')).toBe('danger');
        expect(auditStatusTone('draft')).toBe('info');
    });

    it('المسودة قابلة للعدّ، والمُرسلة مفتوحة للتوقيع لا للعدّ', () => {
        expect(isAuditDraft('draft')).toBe(true);
        expect(isAuditDraft('submitted')).toBe(false);
        expect(isAuditOpen('draft')).toBe(true);
        expect(isAuditOpen('submitted')).toBe(true);
        expect(isAuditOpen('approved')).toBe(false);
        expect(isAuditOpen('cancelled')).toBe(false);
    });
});

describe('الجرد — الفترة والتقدم', () => {
    it('فترة من يوم واحد تُطبع مرة واحدة', () => {
        expect(auditPeriodLabel(audit({ period_start: '2026-11-10', period_end: '2026-11-10' }))).toBe('2026-11-10');
    });

    it('فترة ممتدة تُطبع بالاتجاهين', () => {
        expect(auditPeriodLabel(audit())).toBe('2026-11-01 ← 2026-11-10');
    });

    it('التقدم يعرض المعدود من الإجمالي', () => {
        expect(auditProgressLabel(audit())).toBe('5 / 12');
        expect(auditProgressLabel(audit({ total_items: 0, counted_items: 0 }))).toBe('—');
    });

    it('الفرق يوضح الاتجاه لا الإشارة فقط', () => {
        expect(varianceLabel(0)).toBe('مطابق');
        expect(varianceLabel(-2.5)).toBe('عجز 2.5');
        expect(varianceLabel(3)).toBe('زيادة 3');
        expect(formatAuditQty(1.2345)).toBe('1.235');
    });
});

describe('الجرد — التوقيع لا يُرسل ناقصًا', () => {
    it('بدون توقيع: رسالة صريحة', () => {
        expect(auditSignatureError(null, 'أحمد')).toContain('التوقيع');
    });

    it('بلا اسم حساب: لا توقيع', () => {
        expect(auditSignatureError('data:image/png;base64,AAAA', '   ')).toContain('اسم صاحب الحساب');
    });

    it('توقيع + اسم: يمرّ', () => {
        expect(auditSignatureError('data:image/png;base64,AAAA', 'أحمد')).toBeNull();
    });
});

describe('الجرد — تاريخ اليوم بتوقيت الرياض', () => {
    it('يعيد صيغة YYYY-MM-DD صالحة', () => {
        expect(auditToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
