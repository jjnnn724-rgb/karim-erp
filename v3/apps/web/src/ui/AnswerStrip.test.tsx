import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnswerStrip } from './AnswerStrip';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('AnswerStrip', () => {
    it('يعرض التسميات والقيم النصية كما هي (منسّقة من الشاشة)', () => {
        render(
            <AnswerStrip
                items={[
                    { label: 'الصافي', value: '1,400.00 SAR' },
                    { label: 'الفواتير', value: '22' },
                ]}
            />,
        );
        expect(screen.getByText('الصافي')).toBeTruthy();
        expect(screen.getByText('1,400.00 SAR')).toBeTruthy();
        expect(screen.getByText('الفواتير')).toBeTruthy();
    });

    it('القيمة الرقمية تصل لهدفها بعد الكشف التدريجي', async () => {
        render(<AnswerStrip items={[{ label: 'الإيراد', value: 4550.25 }]} />);
        await waitFor(
            () => {
                expect(screen.getByText('4550.25')).toBeTruthy();
            },
            { timeout: 1500 },
        );
    });

    it('الوحدة والتلميح والاتجاه تمرّ إلى StatCard', () => {
        render(<AnswerStrip items={[{ label: 'الصافي', value: 900, unit: 'SAR', hint: 'ضريبة 45', trend: 'up', delta: '+8%' }]} />);
        expect(screen.getByText('SAR')).toBeTruthy();
        expect(screen.getByText('ضريبة 45')).toBeTruthy();
        expect(screen.getByText('+8%')).toBeTruthy();
    });

    it('يتقلّص لأربعة عناصر كحد أقصى ويحدد الأعمدة', () => {
        render(
            <AnswerStrip
                items={[
                    { label: 'أ', value: 1 },
                    { label: 'ب', value: 2 },
                    { label: 'ج', value: 3 },
                    { label: 'د', value: 4 },
                    { label: 'هـ', value: 5 },
                ]}
            />,
        );
        expect(screen.queryByText('هـ')).toBeNull();
        expect(screen.getByTestId('answer-strip').className).toContain('xl:grid-cols-4');
    });

    it('التوزيع الحالي يظهر عند تحميل بجانب العناصر الجاهزة', () => {
        render(
            <AnswerStrip
                items={[
                    { label: 'جارٍ', value: 0, loading: true },
                    { label: 'جاهز', value: '5' },
                ]}
            />,
        );
        expect(screen.getByText('جاهز')).toBeTruthy();
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <AnswerStrip
                items={[
                    { label: 'الإيراد', value: '2,350.00 SAR' },
                    { label: 'المستهلك', value: 157, tone: 'warning' },
                    { label: 'الصافي', value: '1,100.00 SAR', trend: 'down', delta: '−3%' },
                ]}
            />,
        );
        await expectNoAxeViolations(container);
    });

    it('العدّاد يحترم تقليل الحركة — vi.mock على الهوك المستخرج', async () => {
        vi.doMock('../lib/use-prefers-reduced-motion', () => ({ usePrefersReducedMotion: () => true }));
        const { AnswerStrip: ReducedStrip } = await import('./AnswerStrip');
        render(<ReducedStrip items={[{ label: 'فوري', value: 777.5 }]} />);
        expect(screen.getByText('777.5')).toBeTruthy();
        vi.doUnmock('../lib/use-prefers-reduced-motion');
    });
});
