import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Input } from './Input';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Input', () => {
    it('يربط التسمية بالحقل ويقبل الكتابة', () => {
        const onChange = vi.fn();
        render(<Input label="اسم الفرع" onChange={onChange} />);

        const input = screen.getByLabelText('اسم الفرع');
        fireEvent.change(input, { target: { value: 'الفرع الرئيسي' } });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect((input as HTMLInputElement).value).toBe('الفرع الرئيسي');
    });

    it('الخطأ يُعلن بـaria-invalid وaria-describedby', () => {
        render(<Input label="البريد" error="صيغة البريد غير صحيحة" />);

        const input = screen.getByLabelText('البريد');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        const describedBy = input.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(String(describedBy))?.textContent).toContain('صيغة البريد غير صحيحة');
    });

    it('التلميح يُربط بـaria-describedby أيضًا', () => {
        render(<Input label="الكود" hint="أحرف لاتينية كبيرة" />);

        const input = screen.getByLabelText('الكود');
        const describedBy = input.getAttribute('aria-describedby');
        expect(document.getElementById(String(describedBy))?.textContent).toContain('أحرف لاتينية كبيرة');
    });

    it('disabled يُمرَّر للحقل الأصلي', () => {
        render(<Input label="الكود" disabled />);
        expect((screen.getByLabelText('الكود') as HTMLInputElement).disabled).toBe(true);
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <div className="flex flex-col gap-md">
                <Input label="حقل" placeholder="اكتب" />
                <Input label="حقل بخطأ" error="قيمة غير صالحة" />
                <Input label="حقل معطّل" disabled />
            </div>,
        );

        await expectNoAxeViolations(container);
    });

    it('الحجم sm يُRender أصغر والـ lg أكبر', () => {
        render(
            <div>
                <Input label="صغير" size="sm" />
                <input data-testid="md" />
                <Input label="كبير" size="lg" />
            </div>,
        );
        const small = screen.getByLabelText('صغير');
        const large = screen.getByLabelText('كبير');
        expect(small.className).toContain('h-7.5');
        expect(large.className).toContain('h-11');
    });

    it('requiredMark يُRender نجمة حمراء beside التسمية', () => {
        render(<Input label="إجباري" requiredMark />);
        const label = screen.getByText('إجباري').closest('label');
        expect(label).toBeTruthy();
        expect(label?.textContent).toContain('*');
    });

    it('id المخصص يُطبَّق على الحقل', () => {
        render(<Input label="معرّف" id="custom-input-id" />);
        expect(screen.getByLabelText('معرّف').id).toBe('custom-input-id');
    });
});
