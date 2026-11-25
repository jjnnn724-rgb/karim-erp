import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PrintBrand, PrintRunner } from './PrintBrand';

/**
 * مكوّنات هوية الطباعة — نفس بنية `injectBrand`/`injectRunner` في V2:
 * شعار + اسم + سطر إنجليزي، وتذييل من ثلاثة عناصر (شركة · عنوان · ختم).
 * العنصران مخفيان على الشاشة عبر `print.css` وظاهران في `@media print` فقط.
 */

vi.mock('../lib/print', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/print')>();
    return {
        ...original,
        usePrintBrand: () => ({ name: 'مطاعم الشرفة', logoSrc: '/app/assets/al-shurfa-logo.png' }),
    };
});

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
    });

    it('لا يحمل aria-hidden — الإخفاء على الشاشة بـdisplay:none وحده', () => {
        const { container } = render(<PrintBrand />);
        expect(container.querySelector('[data-erp-print-brand]')?.getAttribute('aria-hidden')).toBeNull();
    });
});

describe('PrintRunner — تذييل المستند', () => {
    it('ثلاثة أجزاء: اسم الشركة وعنوان الشاشة وختم الطباعة', () => {
        render(<PrintRunner title="التقارير — مبيعات نقطة البيع" />);
        const runner = screen.getByText('مطاعم الشرفة').closest('[data-erp-print-runner]');
        expect(runner).not.toBeNull();
        const spans = runner?.querySelectorAll('span');
        expect(spans?.length).toBe(3);
        expect(spans?.[1]?.textContent).toBe('التقارير — مبيعات نقطة البيع');
        expect(spans?.[2]?.textContent?.startsWith('طُبع ')).toBe(true);
    });

    it('بلا عنوان: الباقي يبقى ولا يسقط التذييل', () => {
        render(<PrintRunner />);
        const runner = document.querySelector('[data-erp-print-runner]');
        expect(runner?.querySelectorAll('span').length).toBe(3);
    });
});
