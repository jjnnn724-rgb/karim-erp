import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PrintBrand, PrintRunner } from './PrintBrand';

/**
 * مكوّنات هوية الطباعة — نفس بنية `injectBrand`/`injectRunner` في V2:
 * شعار + اسم + سطر إنجليزي، وتذييل للشركة والعنوان والمستخدم وختم الطباعة.
 * العنصران مخفيان على الشاشة عبر `print.css` وظاهران في `@media print` فقط.
 */

vi.mock('../lib/print', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/print')>();
    return {
        ...original,
        usePrintBrand: () => ({
            name: 'مطاعم الشرفة',
            logoSrc: '/app/assets/al-shurfa-logo.png',
            branchName: 'الفرع الرئيسي',
        }),
    };
});

vi.mock('../lib/auth', () => ({
    useAuthState: () => ({ user: { name: 'أحمد' } }),
}));

describe('PrintBrand — ترويسة المستند', () => {
    it('تحمل الشعار والاسم والسطر الإنجليزي داخل عنصر معلَّم للطباعة', () => {
        const { container } = render(<PrintBrand />);
        const header = container.querySelector('[data-erp-print-brand]');
        expect(header).not.toBeNull();
        expect(header?.classList.contains('erp-print-brand')).toBe(true);
        const image = container.querySelector('.erp-print-brand__logo') as HTMLImageElement;
        expect(image.getAttribute('src')).toBe('/app/assets/al-shurfa-logo.png');
        expect(container.querySelector('.erp-print-brand__name')?.textContent).toBe('مطاعم الشرفة');
        expect(container.querySelector('.erp-print-brand__en')?.textContent).toBe('AL SHURFA AL ALAMI RESTAURANTS');
        expect(container.querySelector('.erp-print-brand__meta')?.textContent).toContain('التقرير: —');
        expect(container.querySelector('.erp-print-brand__meta')?.textContent).toContain('الفرع: الفرع الرئيسي');
    });

    it('لا يحمل aria-hidden — الإخفاء على الشاشة بـdisplay:none وحده', () => {
        const { container } = render(<PrintBrand />);
        expect(container.querySelector('[data-erp-print-brand]')?.getAttribute('aria-hidden')).toBeNull();
    });
});

describe('PrintRunner — تذييل المستند', () => {
    it('أربعة أجزاء: اسم الشركة وعنوان الشاشة والمستخدم وختم الطباعة', () => {
        render(<PrintRunner title="التقارير — مبيعات نقطة البيع" />);
        const runner = screen.getByText('مطاعم الشرفة').closest('[data-erp-print-runner]');
        expect(runner).not.toBeNull();
        const spans = runner?.querySelectorAll('span');
        expect(spans?.length).toBe(4);
        expect(spans?.[1]?.textContent).toBe('التقارير — مبيعات نقطة البيع');
        expect(spans?.[2]?.textContent).toBe('المستخدم: أحمد');
        expect(spans?.[3]?.textContent?.startsWith('طُبع ')).toBe(true);
    });

    it('بلا عنوان: الباقي يبقى ولا يسقط التذييل', () => {
        render(<PrintRunner />);
        const runner = document.querySelector('[data-erp-print-runner]');
        expect(runner?.querySelectorAll('span').length).toBe(4);
    });
});
