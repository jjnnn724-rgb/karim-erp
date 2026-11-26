import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VIEWS_KEY_PREFIX } from '../lib/saved-views';
import { RegisterShell } from './RegisterShell';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() {
            return map.size;
        },
        clear: () => map.clear(),
        getItem: (key: string) => map.get(key) ?? null,
        key: (index: number) => [...map.keys()][index] ?? null,
        removeItem: (key: string) => map.delete(key),
        setItem: (key: string, value: string) => map.set(key, value),
    } as Storage;
}

const twin = vi.fn(() => ({
    title: 'كشف تجريبي',
    columns: [
        { key: 'name', header: 'الصنف' },
        { key: 'qty', header: 'الكمية', align: 'end' as const },
    ],
    rows: [{ name: 'طماطم', qty: 12 }],
}));

describe('RegisterShell', () => {
    let storage: Storage;
    beforeEach(() => {
        storage = memoryStorage();
        twin.mockClear();
    });

    it('الأطفال والفلاتر والملخص تُصيَّر في مكانها', () => {
        render(
            <RegisterShell viewKey="test-1" storage={storage} filters={<span>فلاتر</span>} summary={<span role="status">5 صفوف</span>}>
                <table aria-label="الجدول" />
            </RegisterShell>,
        );
        expect(screen.getByText('فلاتر')).toBeTruthy();
        expect(screen.getByText('5 صفوف')).toBeTruthy();
        expect(screen.getByRole('table', { name: 'الجدول' })).toBeTruthy();
    });

    it('حفظ عرضة: اسم + مرشّحات حالية ⇒ زر باسمها يطبّقها عبر onApplyView', () => {
        const onApplyView = vi.fn();
        render(
            <RegisterShell
                viewKey="test-2"
                storage={storage}
                currentFilters={{ status: 'pending', dept: 'kitchen' }}
                onApplyView={onApplyView}
            >
                <span>المحتوى</span>
            </RegisterShell>,
        );
        fireEvent.click(screen.getByRole('button', { name: /حفظ عرضة/ }));
        fireEvent.change(screen.getByLabelText('اسم العرضة المحفوظة'), { target: { value: 'معلّق المطبخ' } });
        fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));

        const savedButton = screen.getByRole('button', { name: 'معلّق المطبخ' });
        fireEvent.click(savedButton);
        expect(onApplyView).toHaveBeenCalledWith({ status: 'pending', dept: 'kitchen' });
        // تخزين فعلي بالمفتاح المتعاقد عليه
        expect(JSON.parse(storage.getItem(`${VIEWS_KEY_PREFIX}test-2`) ?? '[]').length).toBe(1);
    });

    it('حذف عرضة يزيلها من الواجهة والتخزين', () => {
        render(
            <RegisterShell viewKey="test-3" storage={storage} currentFilters={{ status: 'pending' }}>
                <span>المحتوى</span>
            </RegisterShell>,
        );
        fireEvent.click(screen.getByRole('button', { name: /حفظ عرضة/ }));
        fireEvent.change(screen.getByLabelText('اسم العرضة المحفوظة'), { target: { value: 'عرضة مؤقتة' } });
        fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
        expect(screen.getByRole('button', { name: 'عرضة مؤقتة' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'حذف العرضة عرضة مؤقتة' }));
        expect(screen.queryByRole('button', { name: 'عرضة مؤقتة' })).toBeNull();
        expect(storage.getItem(`${VIEWS_KEY_PREFIX}test-3`)).toBe('[]');
    });

    it('المرشّحات الفارغة تعطّل زر الحفظ', () => {
        render(
            <RegisterShell viewKey="test-4" storage={storage}>
                <span>المحتوى</span>
            </RegisterShell>,
        );
        expect((screen.getByRole('button', { name: /حفظ عرضة/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('التوأم الورقي: وجود المواصفة يُظهر الزر ويستدعي الطباعة ببيانات السجل', () => {
        render(
            <RegisterShell viewKey="test-5" storage={storage} twin={twin}>
                <span>المحتوى</span>
            </RegisterShell>,
        );
        const button = screen.getByRole('button', { name: /الورقة الرسمية/ });
        fireEvent.click(button);
        expect(twin).toHaveBeenCalledTimes(1);
    });

    it('غياب المواصفة يخفي زر التوأم', () => {
        render(
            <RegisterShell viewKey="test-6" storage={storage}>
                <span>المحتوى</span>
            </RegisterShell>,
        );
        expect(screen.queryByRole('button', { name: /الورقة الرسمية/ })).toBeNull();
    });

    it('عرضات محفوظة مسبقًا في التخزين تُقرأ عند الإقلاع', () => {
        storage.setItem(`${VIEWS_KEY_PREFIX}test-7`, JSON.stringify([{ name: 'شهر مطبخ', filters: { dept: 'kitchen' } }]));
        const onApplyView = vi.fn();
        render(
            <RegisterShell viewKey="test-7" storage={storage} onApplyView={onApplyView}>
                <span>المحتوى</span>
            </RegisterShell>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'شهر مطبخ' }));
        expect(onApplyView).toHaveBeenCalledWith({ dept: 'kitchen' });
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <RegisterShell
                viewKey="test-axe"
                storage={storage}
                currentFilters={{ q: 'طماطم' }}
                twin={twin}
                filters={<span>فلاتر</span>}
                summary={<span role="status">3</span>}
            >
                <span>المحتوى</span>
            </RegisterShell>,
        );
        await expectNoAxeViolations(container);
    });
});
