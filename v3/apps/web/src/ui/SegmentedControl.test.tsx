import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

const options = [
    { value: 'day', label: 'اليوم' },
    { value: 'week', label: 'الأسبوع' },
    { value: 'month', label: 'الشهر' },
];

describe('SegmentedControl', () => {
    it('يعرض مجموعة راديو بتسمية مخفية ويعلن المختار', () => {
        render(<SegmentedControl label="المدى الزمني" options={options} value="week" onValueChange={vi.fn()} />);

        expect(screen.getByRole('group', { name: 'المدى الزمني' })).toBeTruthy();
        expect((screen.getByRole('radio', { name: 'الأسبوع' }) as HTMLInputElement).checked).toBe(true);
    });

    it('ينادي onValueChange عند اختيار بديل', () => {
        const onValueChange = vi.fn();
        render(<SegmentedControl label="المدى الزمني" options={options} value="day" onValueChange={onValueChange} />);

        fireEvent.click(screen.getByLabelText('الشهر'));
        expect(onValueChange).toHaveBeenCalledWith('month');
    });

    it('يعطّل البديل المعطّل والمجموعة كلها عند disabled', () => {
        const { rerender } = render(
            <SegmentedControl
                label="المدى"
                options={[...options.slice(0, 2), { value: 'year', label: 'سنة', disabled: true }]}
                value="day"
                onValueChange={vi.fn()}
            />,
        );
        expect((screen.getByLabelText('سنة') as HTMLInputElement).disabled).toBe(true);

        rerender(<SegmentedControl label="المدى" options={options} value="day" disabled onValueChange={vi.fn()} />);
        expect((screen.getByLabelText('اليوم') as HTMLInputElement).disabled).toBe(true);
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(<SegmentedControl label="المدى الزمني" options={options} value="week" onValueChange={vi.fn()} />);
        await expectNoAxeViolations(container);
    });

    it('القيمة المُمررة تُRender مختارة', () => {
        render(<SegmentedControl label="المدى" options={options} value="day" onValueChange={vi.fn()} />);
        expect((screen.getByLabelText('اليوم') as HTMLInputElement).checked).toBe(true);
    });

    it('كل راديو يحمل تسمية واضحة', () => {
        render(<SegmentedControl label="المدى" options={options} value="day" onValueChange={vi.fn()} />);
        expect(screen.getByRole('radio', { name: 'الأسبوع' })).toBeTruthy();
    });

    it('className مخصص يُطبق على الحقلبة الخارجية', () => {
        render(<SegmentedControl label="المدى" options={options} value="day" className="border" onValueChange={vi.fn()} />);
        expect(document.querySelector('.border')).toBeTruthy();
    });
});
