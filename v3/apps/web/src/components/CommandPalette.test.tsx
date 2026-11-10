import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CommandPalette,
    foldArabic,
    fuzzyScore,
    PALETTE_RECENT_KEY,
    rankCommandItems,
} from './CommandPalette';

const items = [
    { to: '/warehouse', label: 'المخزون', hint: 'Inventory' },
    { to: '/cfo', label: 'المدير المالي', hint: 'CFO' },
] as const;

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    window.localStorage.clear();
});

describe('لوحة الأوامر', () => {
    it('تعرض النتائج وتفلترها بالبحث', () => {
        render(<CommandPalette open items={items} onClose={vi.fn()} onSelect={vi.fn()} />);

        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(screen.getByText('المخزون')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('بحث الشاشات'), { target: { value: 'مالي' } });

        expect(screen.queryByText('المخزون')).toBeNull();
        expect(screen.getByText('المدير المالي')).toBeTruthy();
    });

    it('Enter يفتح الشاشة المختارة وEsc يغلق', () => {
        const onSelect = vi.fn();
        const onClose = vi.fn();
        render(<CommandPalette open items={items} onClose={onClose} onSelect={onSelect} />);

        const input = screen.getByLabelText('بحث الشاشات');
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onSelect).toHaveBeenCalledWith('/cfo');
        expect(onClose).toHaveBeenCalled();

        fireEvent.keyDown(input, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('مغلق = لا شيء في DOM', () => {
        render(<CommandPalette open={false} items={items} onClose={vi.fn()} onSelect={vi.fn()} />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('يحفظ آخر العناصر ويعرضها عند إعادة الفتح', () => {
        const { rerender } = render(
            <CommandPalette open items={items} onClose={vi.fn()} onSelect={vi.fn()} />,
        );

        const input = screen.getByLabelText('بحث الشاشات');
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(JSON.parse(window.localStorage.getItem(PALETTE_RECENT_KEY) ?? '[]')).toEqual(['/cfo']);

        rerender(<CommandPalette open={false} items={items} onClose={vi.fn()} onSelect={vi.fn()} />);
        rerender(<CommandPalette open items={items} onClose={vi.fn()} onSelect={vi.fn()} />);

        expect(screen.getByText('آخر العناصر')).toBeTruthy();
    });

    it('الترتيب بلا بحث: عناصر التنقّل قبل الإجراءات', () => {
        render(<CommandPalette open items={items} onClose={vi.fn()} onSelect={vi.fn()} />);

        // بلا بحث: عناصر التنقّل تسبق الإجراءات، فـArrowDown الأول يقع على «المدير المالي».
        const options = screen.getAllByRole('option');
        expect(options[0]?.textContent).toContain('المخزون');
        expect(options[1]?.textContent).toContain('المدير المالي');
    });

    it('الإجراءات (تبديل الوضع/فتح v2/خروج) متاحة بالبحث وتُنفَّذ', () => {
        const onClose = vi.fn();
        const run = vi.fn();
        render(
            <CommandPalette
                open
                items={items}
                actions={[{ id: 'theme', label: 'تبديل الوضع', hint: 'فاتح / داكن', run }]}
                onClose={onClose}
                onSelect={vi.fn()}
            />,
        );

        const input = screen.getByLabelText('بحث الشاشات');
        fireEvent.change(input, { target: { value: 'الوضع' } });

        const themeOption = screen.getByRole('option', { name: /تبديل الوضع/ });
        fireEvent.mouseDown(themeOption);

        expect(onClose).toHaveBeenCalled();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('يستعيد التركيز إلى العنصر السابق عند الإغلاق', () => {
        const closed = <CommandPalette open={false} items={items} onClose={vi.fn()} onSelect={vi.fn()} />;
        const opened = <CommandPalette open items={items} onClose={vi.fn()} onSelect={vi.fn()} />;

        const { rerender } = render(
            <>
                <button type="button">فتح</button>
                {closed}
            </>,
        );
        const trigger = screen.getByRole('button', { name: 'فتح' });
        trigger.focus();

        rerender(
            <>
                <button type="button">فتح</button>
                {opened}
            </>,
        );
        expect(document.activeElement).toBe(screen.getByLabelText('بحث الشاشات'));

        rerender(
            <>
                <button type="button">فتح</button>
                {closed}
            </>,
        );
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'فتح' }));
    });

    it('يطابق وميض الحروف العربية بعد التطبيع', () => {
        expect(foldArabic('الإيرادات')).toBe(foldArabic('الايرادات'));
        expect(fuzzyScore('شجرة الحسابات', 'شجر')).toBeGreaterThan(0);
        expect(fuzzyScore('الإيرادات', 'يرا')).toBeGreaterThan(0);
        expect(fuzzyScore('المخزون', 'مالي')).toBe(-1);
        expect(rankCommandItems(items, 'مالي').map((item) => item.to)).toEqual(['/cfo']);
    });
});
