import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('EmptyState', () => {
    it('يعرض العنوان والتلميح والخطوة التالية', () => {
        const onAction = vi.fn();
        render(
            <EmptyState
                title="لا توجد قيود"
                description="أنشئ قيدًا جديدًا أو غيّر الفترة."
                action={
                    <button type="button" onClick={onAction}>
                        قيد جديد
                    </button>
                }
            />,
        );

        expect(screen.getByText('لا توجد قيود')).toBeTruthy();
        expect(screen.getByText('أنشئ قيدًا جديدًا أو غيّر الفترة.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'قيد جديد' }));
        expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('الأيقونة الافتراضية زخرفية لا تُعلن', () => {
        const { container } = render(<EmptyState title="فراغ" />);
        expect(container.querySelector('span[aria-hidden="true"] svg')).toBeTruthy();
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(<EmptyState title="لا نتائج" description="جرّب مرشّحًا آخر." />);
        await expectNoAxeViolations(container);
    });

    it('بدون إجراء لا يُRender زر', () => {
        render(<EmptyState title="فراغ" description="لا شيء." />);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('className مخصص يُطبق على الحاوية', () => {
        render(<EmptyState title="مخصص" className="border-2" />);
        expect(screen.getByText('مخصص').closest('div.border-2')?.className).toContain('border-2');
    });

    it('يحتوي على عنوان وتلموح', () => {
        render(<EmptyState title="عنوان فراغ" description="تلموح توضيحي" />);
        expect(screen.getByText('عنوان فراغ')).toBeTruthy();
        expect(screen.getByText('تلموح توضيحي')).toBeTruthy();
    });
});
