import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

function renderTabs() {
    return render(
        <Tabs defaultValue="summary" dir="rtl">
            <TabsList aria-label="أقسام التقرير">
                <TabsTrigger value="summary">الملخص</TabsTrigger>
                <TabsTrigger value="details">التفاصيل</TabsTrigger>
                <TabsTrigger value="notes" disabled>
                    ملاحظات
                </TabsTrigger>
            </TabsList>
            <TabsContent value="summary">محتوى الملخص</TabsContent>
            <TabsContent value="details">محتوى التفاصيل</TabsContent>
            <TabsContent value="notes">محتوى الملاحظات</TabsContent>
        </Tabs>,
    );
}

describe('Tabs', () => {
    it('يرسم tablist وtabs وtabpanel بأسماء مفهومة', () => {
        renderTabs();

        expect(screen.getByRole('tablist', { name: 'أقسام التقرير' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'الملخص' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tabpanel').textContent).toContain('محتوى الملخص');
    });

    it('يبدّل اللوحة عند اختيار تبويب آخر', () => {
        renderTabs();

        fireEvent.mouseDown(screen.getByRole('tab', { name: 'التفاصيل' }));
        expect(screen.getByRole('tab', { name: 'التفاصيل' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tabpanel').textContent).toContain('محتوى التفاصيل');
    });

    it('يدعم التبويب المعطّل', () => {
        renderTabs();
        expect((screen.getByRole('tab', { name: 'ملاحظات' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('بلا مخالفات axe', async () => {
        const { container } = renderTabs();
        await expectNoAxeViolations(container);
    });

    it('يُبلّغ عن التغيير في الوضع المُتحكَّم', () => {
        const onValueChange = vi.fn();
        render(
            <Tabs value="summary" onValueChange={onValueChange} dir="rtl">
                <TabsList aria-label="أقسام">
                    <TabsTrigger value="summary">الملخص</TabsTrigger>
                    <TabsTrigger value="details">التفاصيل</TabsTrigger>
                </TabsList>
                <TabsContent value="summary">الملخص</TabsContent>
            </Tabs>,
        );

        fireEvent.mouseDown(screen.getByRole('tab', { name: 'التفاصيل' }));
        expect(onValueChange).toHaveBeenCalledWith('details');
    });
});
