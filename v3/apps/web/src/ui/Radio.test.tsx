import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Radio, RadioGroup } from './Radio';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

const options = [
    { value: 'cash', label: 'نقدًا' },
    { value: 'card', label: 'بطاقة' },
    { value: 'credit', label: 'آجل', disabled: true },
];

describe('RadioGroup', () => {
    it('يعرض المجموعة بتسمية legend ويربط كل خيار', () => {
        render(<RadioGroup label="طريقة الدفع" options={options} value="cash" onValueChange={vi.fn()} />);

        expect(screen.getByRole('group', { name: 'طريقة الدفع' })).toBeTruthy();
        expect((screen.getByLabelText('نقدًا') as HTMLInputElement).checked).toBe(true);
    });

    it('ينادي onValueChange عند اختيار خيار متاح', () => {
        const onValueChange = vi.fn();
        render(<RadioGroup label="طريقة الدفع" options={options} onValueChange={onValueChange} />);

        fireEvent.click(screen.getByLabelText('بطاقة'));
        expect(onValueChange).toHaveBeenCalledWith('card');
    });

    it('الخيار المعطّل يُعطَّل أصلًا', () => {
        render(<RadioGroup label="طريقة الدفع" options={options} onValueChange={vi.fn()} />);

        const disabled = screen.getByLabelText('آجل') as HTMLInputElement;
        expect(disabled.disabled).toBe(true);
    });

    it('الخطأ يُعلن داخل المجموعة', () => {
        render(<RadioGroup label="طريقة الدفع" options={options} error="اختر طريقة دفع" />);
        expect(screen.getByRole('alert').textContent).toContain('اختر طريقة دفع');
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <div className="flex flex-col gap-md">
                <RadioGroup label="طريقة الدفع" options={options} value="cash" onValueChange={vi.fn()} />
                <RadioGroup label="طريقة معطّلة" options={options} disabled onValueChange={vi.fn()} />
            </div>,
        );

        await expectNoAxeViolations(container);
    });
});

describe('Radio', () => {
    it('يعمل منخفض المستوى بتسمية صريحة', () => {
        const onChange = vi.fn();
        render(<Radio label="خيار مستقل" value="x" name="standalone" onChange={onChange} />);

        fireEvent.click(screen.getByLabelText('خيار مستقل'));
        expect(onChange).toHaveBeenCalledWith('x');
    });
});
