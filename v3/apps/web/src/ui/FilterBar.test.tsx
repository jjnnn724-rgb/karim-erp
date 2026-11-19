import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from './FilterBar';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('FilterBar', () => {
    const defaultProps = {
        from: '2026-11-01',
        to: '2026-11-07',
        onFrom: vi.fn(),
        onTo: vi.fn(),
        onApply: vi.fn(),
        searchValue: '',
        onSearchChange: vi.fn(),
    };

    it('يرسم نطاق التاريخ والبحث', () => {
        render(<FilterBar {...defaultProps} />);
        expect(screen.getByLabelText(/من/)).toBeTruthy();
        expect(screen.getByLabelText(/إلى/)).toBeTruthy();
        expect(screen.getByLabelText(/بحث/)).toBeTruthy();
    });

    it('يدعو onApply عند النقر على تطبيق', () => {
        render(<FilterBar {...defaultProps} />);
        const applyBtn = screen.getByTestId('range-apply');
        fireEvent.click(applyBtn);
        expect(defaultProps.onApply).toHaveBeenCalledTimes(1);
    });

    it('يدعو onSearchChange عند تغيير البحث', () => {
        render(<FilterBar {...defaultProps} />);
        const search = screen.getByLabelText(/بحث/);
        fireEvent.input(search, { target: { value: 'الكاشير' } });
        expect(defaultProps.onSearchChange).toHaveBeenCalledWith('الكاشير');
    });

    it('يعرض رسالة الخطأ عند وجودها', () => {
        render(<FilterBar {...defaultProps} error="نطاق غير صالح" />);
        expect(screen.getByRole('alert')).toHaveTextContent('نطاق غير صالح');
    });

    it('يوقف التطبيق أثناء التحميل', () => {
        render(<FilterBar {...defaultProps} pending />);
        const applyBtn = screen.getByTestId('range-apply');
        expect(applyBtn).toBeDisabled();
    });

    it('يدعم مرشّحات إضافية وإجراء مسح اختياريًا', () => {
        const onReset = vi.fn();
        render(
            <FilterBar
                {...defaultProps}
                advancedFilters={
                    <label htmlFor="status-filter">
                        الحالة
                        <select id="status-filter">
                            <option>الكل</option>
                        </select>
                    </label>
                }
                onReset={onReset}
            />,
        );

        expect(screen.getByText('الحالة')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('يطبق data-testid على صندوق البحث', () => {
        render(<FilterBar {...defaultProps} data-testid="filter-search-bar" />);
        expect(screen.getByTestId('filter-search-bar')).toBeTruthy();
    });

    it('يطبق المعرف المخصص على صندوق البحث', () => {
        render(<FilterBar {...defaultProps} id="my-filter" />);
        expect(screen.getByLabelText(/بحث/).id).toBe('my-filter');
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(<FilterBar {...defaultProps} />);
        await expectNoAxeViolations(container);
    });
});
