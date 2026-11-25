import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScreenHero } from './ScreenHero';
import { AnswerStrip } from './AnswerStrip';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('ScreenHero', () => {
    it('يصيّر العنوان h1 بنفس النص الحرفي — عقد حراس الشاشات', () => {
        render(<ScreenHero title="المخزون" />);
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading.textContent).toBe('المخزون');
    });

    it('السطر الإنجليزي eyebrow فوق العنوان بلا اتجاه فيزيائي', () => {
        render(<ScreenHero title="تحليل المبيعات" english="Sales Analyzer" />);
        const eyebrow = screen.getByText('Sales Analyzer');
        expect(eyebrow.getAttribute('dir')).toBe('ltr');
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('تحليل المبيعات');
    });

    it('الوصف يظهر، وغيابه لا يترك عنصرًا فارغًا', () => {
        const { rerender } = render(<ScreenHero title="المخزون" description="سجل الأصناف وأرصدتها" />);
        expect(screen.getByText('سجل الأصناف وأرصدتها')).toBeTruthy();
        rerender(<ScreenHero title="المخزون" />);
        expect(screen.queryByText('سجل الأصناف وأرصدتها')).toBeNull();
    });

    it('فتحة الجواب تُصيَّر تحت العنوان (AnswerStrip)', () => {
        render(
            <ScreenHero
                title="تحليل المبيعات"
                answer={
                    <AnswerStrip
                        items={[
                            { label: 'الصافي', value: 1234.5 },
                            { label: 'الفواتير', value: '22' },
                        ]}
                    />
                }
            />,
        );
        expect(screen.getByTestId('answer-strip')).toBeTruthy();
        expect(screen.getByText('الصافي')).toBeTruthy();
        expect(screen.getByText('الفواتير')).toBeTruthy();
    });

    it('فتحة الإجراءات مخفية من الطباعة', () => {
        render(
            <ScreenHero
                title="المخزون"
                actions={
                    <button type="button" onClick={() => undefined}>
                        تحديث
                    </button>
                }
            />,
        );
        const actionsRow = screen.getByText('تحديث').parentElement;
        expect(actionsRow?.getAttribute('data-erp-print-hide')).not.toBeNull();
    });

    it('بلا مخالفات axe مع جواب وإجراءات', async () => {
        const { container } = render(
            <ScreenHero
                title="أذون الصرف"
                english="Dispatch Orders"
                description="دورة الإذن كاملة بمراحلها"
                answer={<AnswerStrip items={[{ label: 'المعلّق', value: 3, tone: 'warning' }]} />}
                actions={
                    <button type="button" onClick={() => undefined}>
                        طلب صرف جديد
                    </button>
                }
            />,
        );
        await expectNoAxeViolations(container);
    });
});
