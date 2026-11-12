import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiTile } from './KpiTile';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

/**
 * الشارة تُقرأ من محتواها (نصّ مخفي بصريًا للاتجاه + الرقم)، لا من `aria-label`
 * على عنصر `span` — لأن ARIA لا يسمح بتسمية عنصر محايد بلا دور.
 */
function badgeOf(deltaText: string): HTMLElement {
    const badge = screen.getByText(deltaText).closest('[data-slot="kpi-badge"]');
    if (!(badge instanceof HTMLElement)) {
        throw new Error(`لم تُوجد شارة التغيّر للنص ${deltaText}`);
    }
    return badge;
}

describe('KpiTile', () => {
    it('يعرض التسمية والقيمة والوحدة والاتجاه', () => {
        render(<KpiTile label="إجمالي الإيراد" value="120,000.00" unit="SAR" delta="+12.5%" trend="up" />);

        expect(screen.getByText('إجمالي الإيراد')).toBeTruthy();
        expect(screen.getByText('120,000.00')).toBeTruthy();
        expect(screen.getByText('SAR')).toBeTruthy();
        expect(badgeOf('+12.5%').textContent).toContain('ارتفاع');
    });

    it('tone يفصل الدلالة عن الاتجاه (انخفاض المصروف جيد)', () => {
        render(<KpiTile label="المصروف" value="40,000.00" delta="-8.0%" trend="down" tone="success" />);
        const badge = badgeOf('-8.0%');
        expect(badge.textContent).toContain('انخفاض');
        expect(badge.className).toContain('success');
    });

    it('loading يعرض هيكلًا عظميًا معلنًا', () => {
        render(<KpiTile label="قيد التحميل" value="0" loading />);
        expect(screen.getByRole('status').textContent).toContain('قيد التحميل');
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <div className="grid gap-md md:grid-cols-2">
                <KpiTile label="إيراد" value="120,000.00" unit="SAR" delta="+12.5%" trend="up" />
                <KpiTile label="مصروف" value="80,000.00" unit="SAR" delta="-3.0%" trend="down" tone="success" />
                <KpiTile label="تحميل" value="0" loading />
            </div>,
        );

        await expectNoAxeViolations(container);
    });

    it('اتجاه flat يُRender سهم ثبات ونبرة محايدة', () => {
        render(<KpiTile label="ثابت" value="50,000.00" unit="SAR" delta="0.0%" trend="flat" />);
        expect(badgeOf('0.0%').textContent).toContain('ثبات');
    });

    it('بدون delta لا يُRender شارة', () => {
        render(<KpiTile label="بلا Delta" value="10,000.00" unit="SAR" />);
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('tone danger مع delta يُRender دلالة خطر', () => {
        render(<KpiTile label="خطر" value="5,000.00" delta="-2.0%" trend="down" tone="danger" />);
        const badge = badgeOf('-2.0%');
        expect(badge.className).toContain('border-danger');
    });

    it('className مخصص يُطبق على البطاقة', () => {
        render(<KpiTile label="مخصص" value="1" className="border-2" />);
        const card = screen.getByText('مخصص').closest('[data-slot="kpi-tile"]');
        expect(card?.className).toContain('border-2');
    });
});
