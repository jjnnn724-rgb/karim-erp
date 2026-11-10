import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatCard } from './StatCard';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('StatCard', () => {
    const defaultProps = {
        label: 'إيراد الشهر',
        english: 'Month revenue',
        value: '120,000.00',
        hint: 'فاتورة كاشير',
    };

    it('يرسم التسمية والقيمة والهint', () => {
        render(<StatCard {...defaultProps} />);
        expect(screen.getByText('إيراد الشهر')).toBeTruthy();
        expect(screen.getByText('120,000.00')).toBeTruthy();
        expect(screen.getByText('فاتورة كاشير')).toBeTruthy();
    });

    it('يرسم العنوان الإنجليزي عند توفره', () => {
        render(<StatCard {...defaultProps} />);
        expect(screen.getByText('Month revenue')).toBeTruthy();
    });

    it('يرسم النغمة واللون', () => {
        render(<StatCard {...defaultProps} tone='danger' />);
        expect(screen.getByText('120,000.00').className).toContain('text-danger-text');
    });

    it('يرسم الاتجاه وال delta', () => {
        render(<StatCard {...defaultProps} trend='up' delta='+12.5%' />);
        expect(screen.getByText(/↑/)).toBeTruthy();
        expect(screen.getByText('+12.5%')).toBeTruthy();
    });

    it('الحالة loading تُظهر هيكلاً عظمياً', () => {
        render(<StatCard {...defaultProps} loading />);
        expect(screen.getByRole('status')).toBeTruthy();
    });

    it('الحالة empty تُظهر نصاً فارغاً', () => {
        render(<StatCard {...defaultProps} empty />);
        expect(screen.getByText('لا بيانات')).toBeTruthy();
    });

    it('الحالة error تُshow رسالة وفرع إعادة المحاولة', () => {
        const onRetry = vi.fn();
        render(<StatCard {...defaultProps} error errorMessage='فشل التحميل' onRetry={onRetry} />);
        expect(screen.getByText('فشل التحميل')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /إعادة المحاولة/i }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('يطبق className مخصص', () => {
        render(<StatCard {...defaultProps} className='border-2' />);
        expect(screen.getByText('إيراد الشهر').closest('li')?.className).toContain('border-2');
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <ul>
                <StatCard {...defaultProps} />
            </ul>,
        );
        await expectNoAxeViolations(container);
    });
});
