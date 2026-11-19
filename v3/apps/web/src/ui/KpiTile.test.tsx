import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiTile } from './KpiTile';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('KpiTile', () => {
    it('يعرض التسمية والقيمة والوحدة والاتجاه', () => {
        render(<KpiTile label="إجمالي الإيراد" value="120,000.00" unit="SAR" delta="+12.5%" trend="up" />);

        expect(screen.getByText('إجمالي الإيراد')).toBeTruthy();
        expect(screen.getByText('120,000.00')).toBeTruthy();
        expect(screen.getByText('SAR')).toBeTruthy();
        expect(screen.getByLabelText('ارتفاع: +12.5%')).toBeTruthy();
    });

    it('tone يفصل الدلالة عن الاتجاه (انخفاض المصروف جيد)', () => {
        render(<KpiTile label="المصروف" value="40,000.00" delta="-8.0%" trend="down" tone="success" />);
        expect(screen.getByLabelText('انخفاض: -8.0%')).toBeTruthy();
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
        expect(screen.getByLabelText('ثبات: 0.0%')).toBeTruthy();
    });

    it('بدون delta لا يُRender شارة', () => {
        render(<KpiTile label="بلا Delta" value="10,000.00" unit="SAR" />);
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('tone danger مع delta يُRender دلالة خطر', () => {
        render(<KpiTile label="خطر" value="5,000.00" delta="-2.0%" trend="down" tone="danger" />);
        const badge = screen.getByLabelText('انخفاض: -2.0%');
        expect(badge.className).toContain('border-danger');
    });

    it('className مخصص يُطبق على البطاقة', () => {
        render(<KpiTile label="مخصص" value="1" className="border-2" />);
        const card = screen.getByText('مخصص').closest('div.flex-col');
        expect(card?.className).toContain('border-2');
    });
});
