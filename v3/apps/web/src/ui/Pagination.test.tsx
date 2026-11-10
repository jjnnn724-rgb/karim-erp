import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Pagination', () => {
    it('يُعلن الصفحة الحالية ويحسب الملخّص', () => {
        render(<Pagination page={2} pageSize={10} total={57} onPageChange={vi.fn()} />);

        expect(screen.getByRole('navigation', { name: 'ترقيم الصفحات' })).toBeTruthy();
        expect(screen.getByText('11–20 من 57')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'الصفحة 2' }).getAttribute('aria-current')).toBe('page');
    });

    it('ينتقل للأمام والخلف', () => {
        const onPageChange = vi.fn();
        render(<Pagination page={2} pageSize={10} total={57} onPageChange={onPageChange} />);

        fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
        expect(onPageChange).toHaveBeenCalledWith(3);

        fireEvent.click(screen.getByRole('button', { name: 'السابق' }));
        expect(onPageChange).toHaveBeenCalledWith(1);

        fireEvent.click(screen.getByRole('button', { name: 'الصفحة 6' }));
        expect(onPageChange).toHaveBeenCalledWith(6);
    });

    it('يعطّل السابق على الأولى والتالي على الأخيرة', () => {
        const { rerender } = render(<Pagination page={1} pageSize={10} total={57} onPageChange={vi.fn()} />);
        expect((screen.getByRole('button', { name: 'السابق' }) as HTMLButtonElement).disabled).toBe(true);

        rerender(<Pagination page={6} pageSize={10} total={57} onPageChange={vi.fn()} />);
        expect((screen.getByRole('button', { name: 'التالي' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('يختصر الصفحات البعيدة بفاصل', () => {
        render(<Pagination page={10} pageSize={10} total={300} onPageChange={vi.fn()} />);
        expect(screen.getAllByText('…').length).toBeGreaterThan(0);
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(<Pagination page={3} pageSize={10} total={57} onPageChange={vi.fn()} />);
        await expectNoAxeViolations(container);
    });
});
