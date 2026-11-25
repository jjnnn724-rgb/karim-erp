import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Combobox } from './Combobox';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

const options = [
    { value: 'CAI', label: 'القاهرة', hint: 'فرع رئيسي' },
    { value: 'RUH', label: 'الرياض' },
    { value: 'JED', label: 'جدة', disabled: true },
];

describe('Combobox', () => {
    it('يعرض القيمة المختارة ويفتح القائمة بالتركيز', () => {
        render(<Combobox label="الفرع" options={options} value="RUH" />);

        const input = screen.getByRole('combobox', { name: 'الفرع' });
        expect((input as HTMLInputElement).value).toBe('الرياض');

        fireEvent.focus(input);
        expect(input.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('listbox', { name: 'الفرع' })).toBeTruthy();
    });

    it('يبحث بتطبيع العربية ويختار بالأسهم وEnter', () => {
        const onValueChange = vi.fn();
        render(<Combobox label="الفرع" options={options} onValueChange={onValueChange} />);

        const input = screen.getByRole('combobox', { name: 'الفرع' });
        fireEvent.change(input, { target: { value: 'القاهره' } });
        expect(screen.getByRole('option', { name: /القاهرة/ })).toBeTruthy();

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onValueChange).toHaveBeenCalledWith('CAI');
    });

    it('يعرض رسالة الفراغ عندما لا يوجد تطابق', () => {
        render(<Combobox label="الفرع" options={options} emptyMessage="لا فروع" />);

        fireEvent.change(screen.getByRole('combobox', { name: 'الفرع' }), { target: { value: 'غير موجود' } });
        expect(screen.getByText('لا فروع')).toBeTruthy();
    });

    it('Escape يغلق القائمة ويُبلّغ aria-expanded', () => {
        render(<Combobox label="الفرع" options={options} />);
        const input = screen.getByRole('combobox', { name: 'الفرع' });

        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('الخطأ والتلميح مرتبطان بالحقل', () => {
        render(<Combobox label="الفرع" options={options} error="الفرع مطلوب" />);
        const input = screen.getByRole('combobox', { name: 'الفرع' });
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(document.getElementById(String(input.getAttribute('aria-describedby')))?.textContent).toContain('الفرع مطلوب');
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(<Combobox label="الفرع" options={options} value="RUH" />);
        await expectNoAxeViolations(container);
    });
});
