import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Switch', () => {
    it('يُعلن دوره ويُبلّغ بالتبديل', () => {
        const onCheckedChange = vi.fn();
        render(<Switch label="إشعارات البريد" onCheckedChange={onCheckedChange} />);

        const control = screen.getByRole('switch', { name: 'إشعارات البريد' });
        expect(control.getAttribute('aria-checked')).toBe('false');
        fireEvent.click(control);
        expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('الحالة المختارة تُقرأ من aria-checked', () => {
        render(<Switch label="إشعارات البريد" checked onCheckedChange={vi.fn()} />);
        expect(screen.getByRole('switch', { name: 'إشعارات البريد' }).getAttribute('aria-checked')).toBe('true');
    });

    it('disabled يمنع التبديل', () => {
        const onCheckedChange = vi.fn();
        render(<Switch label="معطّل" disabled onCheckedChange={onCheckedChange} />);

        const control = screen.getByRole('switch', { name: 'معطّل' });
        expect(control.hasAttribute('disabled')).toBe(true);
        fireEvent.click(control);
        expect(onCheckedChange).not.toHaveBeenCalled();
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <div className="flex flex-col gap-md">
                <Switch label="تبديل" onCheckedChange={vi.fn()} />
                <Switch label="تبديل مع وصف" description="شرح" checked onCheckedChange={vi.fn()} />
                <Switch label="معطّل" disabled onCheckedChange={vi.fn()} />
            </div>,
        );

        await expectNoAxeViolations(container);
    });

    it('الوصف يُRender أسفل التبديل', () => {
        render(<Switch label="إشعارات" description="تصل إشعارات البريد" onCheckedChange={vi.fn()} />);
        expect(screen.getByText('تصل إشعارات البريد')).toBeTruthy();
    });

    it('التبديل المتعدد يُحدّث aria-checked', () => {
        const onCheckedChange = vi.fn();
        render(<Switch label="مكرر" onCheckedChange={onCheckedChange} />);
        const control = screen.getByRole('switch', { name: 'مكرر' });
        fireEvent.click(control);
        fireEvent.click(control);
        expect(onCheckedChange).toHaveBeenCalledWith(true);
        expect(onCheckedChange).toHaveBeenCalledWith(false);
    });

    it('className مخصص يُطبق على الحاوية', () => {
        render(<Switch label="مخصص" className="border" onCheckedChange={vi.fn()} />);
        expect(screen.getByLabelText('مخصص').closest('div')?.className).toContain('border');
    });
});
