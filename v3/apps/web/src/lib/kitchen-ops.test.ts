import { describe, expect, it } from 'vitest';
import {
    canReadKitchenOps,
    canReviewKitchenExceptions,
    canWriteKitchenOps,
    formatKitchenMoney,
    formatKitchenQty,
    KITCHEN_CHANNELS,
    kitchenAuditStatusTone,
    kitchenPeriodStart,
    kitchenSignatureError,
    kitchenToday,
    validateKitchenProduction,
} from './kitchen-ops';

describe('kitchen-ops roles', () => {
    it('يفتح القراءة لأدوار الخادم السبعة فقط', () => {
        for (const role of ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'auditor', 'cashier']) {
            expect(canReadKitchenOps(role)).toBe(true);
        }
        expect(canReadKitchenOps('accountant')).toBe(false);
        expect(canReadKitchenOps(null)).toBe(false);
    });

    it('الكتابة للمخزن/المطبخ/المدير — المحاسب لا يكتب', () => {
        for (const role of ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef']) {
            expect(canWriteKitchenOps(role)).toBe(true);
        }
        for (const role of ['auditor', 'cashier', 'accountant', 'employee']) {
            expect(canWriteKitchenOps(role)).toBe(false);
        }
    });

    it('مراجعة الاستثناءات للمدير والمراجع فقط', () => {
        expect(canReviewKitchenExceptions('admin')).toBe(true);
        expect(canReviewKitchenExceptions('manager')).toBe(true);
        expect(canReviewKitchenExceptions('auditor')).toBe(true);
        expect(canReviewKitchenExceptions('kitchen')).toBe(false);
        expect(canReviewKitchenExceptions('warehouse')).toBe(false);
    });
});

describe('validateKitchenProduction', () => {
    const base = {
        productName: 'كيك شوكولاتة',
        producedQty: 10,
        materials: [{ inventoryId: 1, quantity: 2, wastePercent: 5 }],
        distributions: [{ kind: 'channel' as const, code: 'external_sales', quantity: 10 }],
    };

    it('يقبل أمرًا مكتملًا ومتوازن التوزيع', () => {
        expect(validateKitchenProduction(base)).toEqual({ ok: true, errors: [] });
    });

    it('يرفض منتجًا بلا اسم', () => {
        const result = validateKitchenProduction({ ...base, productName: '   ' });
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain('اسم المنتج');
    });

    it('يرفض كمية إنتاج صفرية أو سالبة', () => {
        expect(validateKitchenProduction({ ...base, producedQty: 0 }).ok).toBe(false);
        expect(validateKitchenProduction({ ...base, producedQty: -3 }).ok).toBe(false);
    });

    it('يرفض غياب المكونات أو جهات التوزيع', () => {
        expect(validateKitchenProduction({ ...base, materials: [] }).ok).toBe(false);
        expect(validateKitchenProduction({ ...base, distributions: [] }).ok).toBe(false);
    });

    it('يرفض اختلاف إجمالي التوزيع عن الإنتاج', () => {
        const result = validateKitchenProduction({
            ...base,
            distributions: [
                { kind: 'channel', code: 'external_sales', quantity: 6 },
                { kind: 'department', code: 'kitchen', quantity: 3 },
            ],
        });
        expect(result.ok).toBe(false);
        expect(result.errors.join(' ')).toContain('لا يساوي');
    });

    it('يرفض نسبة هالك خارج 0–100', () => {
        const result = validateKitchenProduction({
            ...base,
            materials: [{ inventoryId: 1, quantity: 1, wastePercent: 150 }],
        });
        expect(result.ok).toBe(false);
    });
});

describe('kitchenSignatureError', () => {
    it('يرفض قرارًا بلا توقيع', () => {
        expect(kitchenSignatureError(null, 'مستخدم تجريبي')).toContain('التوقيع');
    });

    it('يرفض اسم موقّع فارغًا', () => {
        expect(kitchenSignatureError('data:image/png;base64,AAA', '   ')).toContain('اسم صاحب الحساب');
    });

    it('يقبل توقيعًا مع اسم', () => {
        expect(kitchenSignatureError('data:image/png;base64,AAA', 'مستخدم تجريبي')).toBeNull();
    });
});

describe('kitchenPeriodStart', () => {
    it('اليومي يبدأ اليوم', () => {
        expect(kitchenPeriodStart('daily', '2026-11-10')).toBe('2026-11-10');
    });

    it('الشهري يبدأ أول الشهر', () => {
        expect(kitchenPeriodStart('monthly', '2026-11-10')).toBe('2026-11-01');
    });

    it('السنوي يبدأ أول يناير', () => {
        expect(kitchenPeriodStart('annual', '2026-11-10')).toBe('2026-01-01');
    });

    it('الأسبوعي يبدأ السبت', () => {
        // 2026-11-10 ثلاثاء ⇒ السبت 2026-11-07
        expect(kitchenPeriodStart('weekly', '2026-11-10')).toBe('2026-11-07');
        // السبت نفسه لا يُرجَع للخلف
        expect(kitchenPeriodStart('weekly', '2026-11-07')).toBe('2026-11-07');
        // الأحد 2026-11-08 ⇒ السبت 2026-11-07
        expect(kitchenPeriodStart('weekly', '2026-11-08')).toBe('2026-11-07');
    });

    it('الفترة المخصصة تبدأ اليوم', () => {
        expect(kitchenPeriodStart('custom', '2026-11-10')).toBe('2026-11-10');
    });

    it('kitchenToday بصيغة YYYY-MM-DD', () => {
        expect(kitchenToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe('عرض القيم', () => {
    it('يقرّب الكميات إلى ثلاثة أرقام عشرية', () => {
        expect(formatKitchenQty(12.3456)).toBe('12.346');
        expect(formatKitchenQty(Number.NaN)).toBe('0');
    });

    it('يعرض المال برقمين عشريين', () => {
        expect(formatKitchenMoney(1234.5)).toBe('1,234.50');
    });

    it('نغمات الحالة مطابقة لمراحل الجرد', () => {
        expect(kitchenAuditStatusTone('approved')).toBe('success');
        expect(kitchenAuditStatusTone('submitted')).toBe('warning');
        expect(kitchenAuditStatusTone('rejected')).toBe('danger');
        expect(kitchenAuditStatusTone('draft')).toBe('info');
    });

    it('قنوات التوزيع الثلاث مطابقة لخريطة الخادم', () => {
        expect(KITCHEN_CHANNELS.map((row) => row.code)).toEqual(['external_sales', 'open_buffet', 'staff_meals']);
    });
});
