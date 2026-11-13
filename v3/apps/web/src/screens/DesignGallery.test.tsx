import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTheme, expectNoAxeViolations, installDomPolyfills, mockMatchMedia } from '../ui/test-utils';
import { DesignGallery } from './DesignGallery';

/** التنفيذ الثقيل يُستبدل هنا؛ غلاف Chart له اختباره في src/ui/Chart.test.tsx. */
vi.mock('../ui/chart-impl', () => ({
    default: () => <div data-testid="chart-impl" />,
}));

installDomPolyfills();

beforeEach(() => {
    clearTheme();
    mockMatchMedia(false);
});

afterEach(() => {
    clearTheme();
});

describe('DesignGallery', () => {
    it('يعرض عنوان المعرض وأقسامه الرئيسية', () => {
        render(<DesignGallery />);

        expect(screen.getByRole('heading', { level: 1, name: 'معرض نظام التصميم' })).toBeTruthy();
        expect(screen.getByRole('navigation', { name: 'أقسام المعرض' })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: 'الرموز' })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: 'الأزرار' })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: 'الرسوم' })).toBeTruthy();
    });

    it('يعرض كل الأقسام المعلنة في شريط التنقل', () => {
        render(<DesignGallery />);
        const nav = screen.getByRole('navigation', { name: 'أقسام المعرض' });
        const links = within(nav).getAllByRole('link');
        expect(links.length).toBeGreaterThanOrEqual(12);
    });

    it('يعرض عيّنة 500 صف بتمرير افتراضي وعدّ كامل', () => {
        render(<DesignGallery />);

        const scrollers = screen.getAllByTestId('datatable');
        const virtual = scrollers.find((element) => element.getAttribute('data-row-count') === '500');
        expect(virtual).toBeTruthy();
        expect(virtual?.getAttribute('data-virtualized')).toBe('true');
        expect(screen.getByRole('heading', { level: 2, name: 'جدول 500 صف — تمرير افتراضي' })).toBeTruthy();
    });

    it('الوضع الداكن مفروض في لوحة المعاينة ولا يعتمد على الوضع العام', () => {
        render(<DesignGallery />);

        const darkPanel = document.querySelector('[data-mode="dark"]');
        expect(darkPanel?.classList.contains('dark')).toBe(true);
        expect(document.querySelector('[data-mode="light"]')?.classList.contains('dark')).toBe(false);
    });

    it('مبدّل المظهر يعمل من داخل المعرض', () => {
        render(<DesignGallery />);

        fireEvent.click(screen.getByRole('button', { name: 'داكن' }));
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(window.localStorage.getItem('karim_theme_v1')).toBe('dark');
    });

    it('يعرض تفاعلات النوافذ والتنبيهات', () => {
        render(<DesignGallery />);

        // كل عرض تفاعلي يُرسم مرتين (لوحة فاتحة + داكنة) — نأخذ الأول.
        fireEvent.click(screen.getAllByRole('button', { name: 'فتح الحوار' })[0] as HTMLElement);
        expect(screen.getByRole('dialog', { name: 'ترحيل القيد' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));

        fireEvent.click(screen.getAllByRole('button', { name: 'نجاح' })[0] as HTMLElement);
        expect(screen.getAllByRole('status').some((element) => element.textContent?.includes('تم الحفظ'))).toBe(true);
    }, 20_000);

    it('بلا مخالفات axe على المعرض كاملًا', async () => {
        const { container } = render(<DesignGallery />);
        await expectNoAxeViolations(container);
    }, 60_000);
});
