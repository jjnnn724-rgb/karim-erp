import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './Alert';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Alert', () => {
    it('يعرض العنوان والجسم ويحمل نبرته', () => {
        render(
            <Alert variant="danger" title="فشل الحفظ">
                تحقّق من الاتصال ثم أعد المحاولة.
            </Alert>,
        );

        expect(screen.getByText('فشل الحفظ')).toBeTruthy();
        expect(screen.getByText('تحقّق من الاتصال ثم أعد المحاولة.')).toBeTruthy();
        expect(screen.getByRole('alert').getAttribute('data-variant')).toBe('danger');
    });

    it('الخطأ والتحذير بإعلان فوري، والمعلومة والنجاح بأدب', () => {
        const { rerender } = render(<Alert variant="warning">تحذير</Alert>);
        expect(screen.getByRole('alert')).toBeTruthy();

        rerender(<Alert variant="danger">خطأ</Alert>);
        expect(screen.getByRole('alert')).toBeTruthy();

        rerender(<Alert variant="success">نجاح</Alert>);
        expect(screen.getByRole('status')).toBeTruthy();

        rerender(<Alert variant="info">معلومة</Alert>);
        expect(screen.getByRole('status')).toBeTruthy();
    });

    it('النبرة الافتراضية معلومة', () => {
        render(<Alert>ملاحظة</Alert>);
        expect(screen.getByRole('status').getAttribute('data-variant')).toBe('info');
    });

    it('الأيقونة زخرفية فلا تُضاعف النص', () => {
        const { container } = render(<Alert title="عنوان">جسم</Alert>);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('aria-hidden')).toBe('true');
    });

    it('يقبل إجراءً وclassName مخصصًا بلا كسر الشكل', () => {
        render(
            <Alert variant="danger" title="تعذّر التحميل" action={<button type="button">إعادة المحاولة</button>} className="mt-md">
                أعد المحاولة بعد لحظات.
            </Alert>,
        );

        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
        expect(screen.getByRole('alert').className).toContain('mt-md');
    });

    it('بلا عنوان يعرض الجسم فقط', () => {
        const { container } = render(<Alert>جسم وحده</Alert>);
        expect(container.querySelector('p')).toBeNull();
    });

    it('بلا مخالفات axe في كل النبرات', async () => {
        const { container } = render(
            <div className="flex flex-col gap-sm">
                <Alert variant="info" title="معلومة">
                    نص معلوماتي.
                </Alert>
                <Alert variant="success" title="نجاح">
                    تمّت العملية.
                </Alert>
                <Alert variant="warning" title="تحذير">
                    راجع الإعداد.
                </Alert>
                <Alert variant="danger" title="خطأ" action={<button type="button">إعادة المحاولة</button>}>
                    لم تكتمل العملية.
                </Alert>
            </div>,
        );

        await expectNoAxeViolations(container);
    });
});
