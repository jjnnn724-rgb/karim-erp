import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Chart } from './Chart';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

/**
 * التنفيذ الحقيقي (Recharts) يُستبدل هنا: وحدة Chart تُختبر كغلاف كسول
 * (Suspense + جدول بديل + a11y)، وفحص الاستيراد الثابت يحرس قاعدة الحزمة.
 */
vi.mock('./chart-impl', () => ({
    default: () => <div data-testid="chart-impl" />,
}));

installDomPolyfills();

const data = [
    { month: 'يناير', revenue: 120000, expense: 80000 },
    { month: 'فبراير', revenue: 140000, expense: 90000 },
];

const series = [
    { key: 'revenue', label: 'الإيراد' },
    { key: 'expense', label: 'المصروف' },
];

const SRC = dirname(fileURLToPath(import.meta.url));

describe('Chart', () => {
    it('يعرض العنوان والوصف ويُحمّل الإدراك الكسول', async () => {
        render(<Chart kind="line" title="الإيراد الشهري" description="آخر شهرين" data={data} xKey="month" series={series} />);

        expect(screen.getByRole('figure', { name: /الإيراد الشهري/ })).toBeTruthy();
        expect(screen.getByText('آخر شهرين')).toBeTruthy();
        expect(await screen.findByTestId('chart-impl')).toBeTruthy();
    });

    it('يقدّم بديلًا جدوليًا كاملًا لقارئ الشاشة', async () => {
        render(<Chart kind="bar" title="الإيراد الشهري" data={data} xKey="month" series={series} />);
        await screen.findByTestId('chart-impl');

        const table = screen.getByRole('table', { name: 'الإيراد الشهري — جدول البيانات' });
        expect(table.textContent).toContain('يناير');
        expect(table.textContent).toContain('120000');
        expect(table.textContent).toContain('الإيراد');
    });

    it('يدعم الأنواع الأربعة', async () => {
        const { rerender } = render(<Chart kind="area" title="مساحة" data={data} xKey="month" series={series} />);
        expect(await screen.findByTestId('chart-impl')).toBeTruthy();

        rerender(<Chart kind="pie" title="توزيع" data={data} xKey="month" series={series} />);
        expect(await screen.findByTestId('chart-impl')).toBeTruthy();
    });

    it('لا يستورد recharts في الغلاف ولا في فهرس الواجهة (حزمة أولية)', () => {
        const chartSource = readFileSync(join(SRC, 'Chart.tsx'), 'utf8');
        const indexSource = readFileSync(join(SRC, 'index.ts'), 'utf8');

        expect(chartSource).not.toMatch(/from ['"]recharts['"]/);
        expect(indexSource).not.toMatch(/recharts/);
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(<Chart kind="line" title="الإيراد" data={data} xKey="month" series={series} />);
        await expectNoAxeViolations(container);
    });
});
