import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

const options = [
    { value: 'SAR', label: 'ريال سعودي' },
    { value: 'USD', label: 'دولار أمريكي' },
    { value: 'EGP', label: 'جنيه مصري', disabled: true },
];

describe('Select', () => {
    it('يربط التسمية بالقائمة ويعرض القيمة المختارة', () => {
        render(<Select label="العملة" options={options} value="SAR" />);

        const trigger = screen.getByRole('combobox', { name: 'العملة' });
        expect(trigger.textContent).toContain('ريال سعودي');
    });

    it('يعرض placeholder عندما تكون القيمة غير مختارة', () => {
        render(<Select label="العملة" options={options} placeholder="اختر العملة" />);
        expect(screen.getByRole('combobox', { name: 'العملة' }).textContent).toContain('اختر العملة');
    });

    it('يفتح ويختار خيارًا ويُبلّغ بالقيمة', async () => {
        const onValueChange = vi.fn();
        render(<Select label="العملة" options={options} onValueChange={onValueChange} />);

        fireEvent.click(screen.getByRole('combobox', { name: 'العملة' }));
        const option = await screen.findByRole('option', { name: 'دولار أمريكي' });
        fireEvent.click(option);

        expect(onValueChange).toHaveBeenCalledWith('USD');
    });

    it('الخطأ يُعلن بـaria-invalid وaria-describedby', () => {
        render(<Select label="العملة" options={options} error="العملة مطلوبة" />);

        const trigger = screen.getByRole('combobox', { name: /العملة/ });
        expect(trigger.getAttribute('aria-invalid')).toBe('true');
        const describedBy = trigger.getAttribute('aria-describedby');
        expect(document.getElementById(String(describedBy))?.textContent).toContain('العملة مطلوبة');
    });

    it('disabled يمنع الفتح', () => {
        render(<Select label="العملة" options={options} disabled />);
        const trigger = screen.getByRole('combobox', { name: 'العملة' });
        expect(trigger.hasAttribute('disabled')).toBe(true);
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <div className="flex flex-col gap-md">
                <Select label="عملة" options={options} placeholder="اختر" />
                <Select label="عملة بخطأ" options={options} error="مطلوب" />
                <Select label="عملة معطّلة" options={options} disabled />
            </div>,
        );

        await expectNoAxeViolations(container);
    });
});
