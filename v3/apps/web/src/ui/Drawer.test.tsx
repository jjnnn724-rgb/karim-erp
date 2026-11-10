import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from './Drawer';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Drawer', () => {
    it('يعرض درجًا على الحافة المنطقية المطلوبة', () => {
        render(
            <Drawer open onOpenChange={vi.fn()} title="مرشّحات المخزون" side="end">
                <p>محتوى المرشّحات</p>
            </Drawer>,
        );

        const drawer = screen.getByRole('dialog', { name: 'مرشّحات المخزون' });
        expect(drawer.getAttribute('data-side')).toBe('end');
        expect(drawer.textContent).toContain('محتوى المرشّحات');
    });

    it('يدعم حافة البداية ويُغلق بزر الإغلاق', () => {
        const onOpenChange = vi.fn();
        render(
            <Drawer open onOpenChange={onOpenChange} title="تفاصيل" side="start" footer={<span>تذييل</span>}>
                محتوى
            </Drawer>,
        );

        const drawer = screen.getByRole('dialog', { name: 'تفاصيل' });
        expect(drawer.getAttribute('data-side')).toBe('start');
        expect(drawer.textContent).toContain('تذييل');

        fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <Drawer open onOpenChange={vi.fn()} title="درج" description="وصف">
                محتوى
            </Drawer>,
        );
        await expectNoAxeViolations(container);
    });
});
