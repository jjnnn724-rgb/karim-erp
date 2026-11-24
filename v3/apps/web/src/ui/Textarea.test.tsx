import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Textarea } from './Textarea';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Textarea', () => {
    it('يربط التسمية ويقبل الكتابة', () => {
        const onChange = vi.fn();
        render(<Textarea label="ملاحظات" onChange={onChange} />);

        const textarea = screen.getByLabelText('ملاحظات');
        expect(textarea.tagName).toBe('TEXTAREA');
        fireEvent.change(textarea, { target: { value: 'ملاحظة' } });

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('الخطأ يُعلن بـaria-invalid وaria-describedby', () => {
        render(<Textarea label="ملاحظات" error="النص طويل جدًا" />);

        const textarea = screen.getByLabelText('ملاحظات');
        expect(textarea.getAttribute('aria-invalid')).toBe('true');
        const describedBy = textarea.getAttribute('aria-describedby');
        expect(document.getElementById(String(describedBy))?.textContent).toContain('النص طويل جدًا');
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <div className="flex flex-col gap-md">
                <Textarea label="ملاحظات" />
                <Textarea label="ملاحظات بخطأ" error="مطلوب" />
            </div>,
        );

        await expectNoAxeViolations(container);
    });
});
