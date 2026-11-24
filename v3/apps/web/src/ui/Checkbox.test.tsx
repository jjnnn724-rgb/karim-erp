import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Checkbox', () => {
    it('يربط التسمية والوصف ويُبلّغ بالتغيير', () => {
        const onCheckedChange = vi.fn();
        render(
            <Checkbox
                label="تذكّرني"
                description="يبقى الدخول فعّالًا على هذا الجهاز"
                onCheckedChange={onCheckedChange}
            />,
        );

        const checkbox = screen.getByRole('checkbox', { name: 'تذكّرني' });
        expect(checkbox.getAttribute('data-state')).toBe('unchecked');
        fireEvent.click(checkbox);
        expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('يعرض الحالة المختارة وaria-checked صحيح', () => {
        render(<Checkbox label="مفعّل" checked onCheckedChange={vi.fn()} />);
        const checkbox = screen.getByRole('checkbox', { name: 'مفعّل' });
        expect(checkbox.getAttribute('aria-checked')).toBe('true');
        expect(checkbox.getAttribute('data-state')).toBe('checked');
    });

    it('يدعم الحالة الثالثة mixed', () => {
        render(<Checkbox label="بعض العناصر" checked="indeterminate" onCheckedChange={vi.fn()} />);
        expect(screen.getByRole('checkbox', { name: 'بعض العناصر' }).getAttribute('aria-checked')).toBe('mixed');
    });

    it('disabled يمنع التغيير', () => {
        const onCheckedChange = vi.fn();
        render(<Checkbox label="معطّل" disabled onCheckedChange={onCheckedChange} />);

        const checkbox = screen.getByRole('checkbox', { name: 'معطّل' });
        expect(checkbox.hasAttribute('disabled')).toBe(true);
        fireEvent.click(checkbox);
        expect(onCheckedChange).not.toHaveBeenCalled();
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <div className="flex flex-col gap-md">
                <Checkbox label="خيار" onCheckedChange={vi.fn()} />
                <Checkbox label="خيار مع وصف" description="شرح" checked onCheckedChange={vi.fn()} />
                <Checkbox label="معطّل" disabled onCheckedChange={vi.fn()} />
            </div>,
        );

        await expectNoAxeViolations(container);
    });
});
