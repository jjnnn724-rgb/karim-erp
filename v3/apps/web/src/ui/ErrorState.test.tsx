import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from './ErrorState';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('ErrorState', () => {
    it('يُعلن العطل فورًا ويقدّم إعادة المحاولة', () => {
        const onRetry = vi.fn();
        render(<ErrorState message="تعذّر الاتصال بالخادم" onRetry={onRetry} />);

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('تعذّر جلب البيانات')).toBeTruthy();
        expect(screen.getByText('تعذّر الاتصال بالخادم')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('يقبل عنوانًا وتسمية زر مخصّصة', () => {
        render(<ErrorState title="فشل الحفظ" retryLabel="حاول مجددًا" onRetry={vi.fn()} />);
        expect(screen.getByText('فشل الحفظ')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'حاول مجددًا' })).toBeTruthy();
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(<ErrorState message="سبب الفشل" onRetry={vi.fn()} />);
        await expectNoAxeViolations(container);
    });

    it('بدون onRetry لا يُRender زر إعادة المحاولة', () => {
        render(<ErrorState message="فشل" />);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('title مخصص يُRender', () => {
        render(<ErrorState title="عنوان خطأ" message="رسالة" onRetry={vi.fn()} />);
        expect(screen.getByText('عنوان خطأ')).toBeTruthy();
    });

    it('className مخصص يُطبق على الحاوية', () => {
        render(<ErrorState message="فشل" className="border-2" onRetry={vi.fn()} />);
        expect(screen.getByText('تعذّر جلب البيانات').closest('div.border-2')?.className).toContain('border-2');
    });
});
