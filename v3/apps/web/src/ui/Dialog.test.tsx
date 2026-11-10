import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Dialog', () => {
    it('يعرض حوارًا باسم من عنوانه ومحتواه', () => {
        render(
            <Dialog open onOpenChange={vi.fn()} title="تأكيد الترحيل" description="لا يمكن التراجع بعد الترحيل.">
                <p>سيُقفل القيد نهائيًا.</p>
            </Dialog>,
        );

        const dialog = screen.getByRole('dialog', { name: 'تأكيد الترحيل' });
        expect(dialog.textContent).toContain('سيُقفل القيد نهائيًا.');
        expect(dialog.textContent).toContain('لا يمكن التراجع بعد الترحيل.');
    });

    it('زر الإغلاق وEsc ينادِيان onOpenChange(false)', () => {
        const onOpenChange = vi.fn();
        const { rerender } = render(<Dialog open onOpenChange={onOpenChange} title="حوار" />);

        fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
        expect(onOpenChange).toHaveBeenCalledWith(false);

        rerender(<Dialog open onOpenChange={onOpenChange} title="حوار" />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('trigger يفتح النافذة عبر onOpenChange', () => {
        const onOpenChange = vi.fn();
        render(
            <Dialog
                open={false}
                onOpenChange={onOpenChange}
                title="حوار"
                trigger={<Button>فتح</Button>}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'فتح' }));
        expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it('لا شيء في DOM عندما يكون مغلقًا', () => {
        render(<Dialog open={false} onOpenChange={vi.fn()} title="حوار" />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <Dialog open onOpenChange={vi.fn()} title="حوار" description="وصف">
                محتوى
            </Dialog>,
        );
        await expectNoAxeViolations(container);
    });
});
