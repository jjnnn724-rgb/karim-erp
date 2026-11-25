import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusRail } from './StatusRail';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

const DISPATCH_STEPS = [
    { key: 'pending', label: 'بانتظار اعتماد المخزن', tone: 'warning' as const },
    { key: 'chef_approved', label: 'معتمد من الشيف', tone: 'info' as const },
    { key: 'approved', label: 'معتمد — بانتظار الاستلام', tone: 'success' as const },
    { key: 'received', label: 'مستلم ومغلق', tone: 'success' as const },
];

describe('StatusRail', () => {
    it('يعلن المرحلة الحالية في aria-label', () => {
        render(<StatusRail steps={DISPATCH_STEPS} current={1} />);
        const rail = screen.getByRole('img');
        expect(rail.getAttribute('aria-label')).toBe('المرحلة: معتمد من الشيف');
    });

    it('النص الظاهر يعاد من خاصية label عند تمريرها', () => {
        render(<StatusRail steps={DISPATCH_STEPS} current={0} label="بانتظار اعتماد المخزن" />);
        expect(screen.getByText('بانتظار اعتماد المخزن')).toBeTruthy();
    });

    it('المصغّرة تُعلن بلا نصوص مراحل (عقد خلايا الجداول)', () => {
        render(<StatusRail steps={DISPATCH_STEPS} current={2} compact />);
        expect(screen.getByTestId('status-rail-compact')).toBeTruthy();
        expect(screen.queryByText('معتمد — بانتظار الاستلام')).toBeNull();
    });

    it('current=-1 يعني لم تبدأ — بلا مرحلة ظاهرة', () => {
        render(<StatusRail steps={DISPATCH_STEPS} current={-1} />);
        expect(screen.getByRole('img').getAttribute('aria-label')).toBe('لم تبدأ الدورة');
    });

    it('current فوق المدى يُقصّ على آخر مرحلة', () => {
        render(<StatusRail steps={DISPATCH_STEPS} current={99} />);
        expect(screen.getByRole('img').getAttribute('aria-label')).toBe('المرحلة: مستلم ومغلق');
    });

    it('بلا مخالفات axe في الوضعين الكامل والمصغّر', async () => {
        const { container: full } = render(<StatusRail steps={DISPATCH_STEPS} current={1} label="معتمد من الشيف" />);
        await expectNoAxeViolations(full);
        const { container: compact } = render(<StatusRail steps={DISPATCH_STEPS} current={3} compact />);
        await expectNoAxeViolations(compact);
    });
});
