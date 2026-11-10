import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from './DataTable';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

/**
 * jsdom بلا تخطيط: `clientHeight` دائمًا 0، فـ`observeElementRect` في
 * react-virtual يقيس صفرًا ولا يرسم أي VirtualItem. نحاكي ارتفاع حاوية
 * التمرير للعنصر المعني فقط (520px) كي يُختبر مسار التمرير الافتراضي فعلًا،
 * دون المساس ببقية العناصر.
 */
Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
        return this.getAttribute('data-testid') === 'datatable' ? 520 : 0;
    },
});

interface Invoice {
    id: string;
    customer: string;
    total: string;
}

const rows: Invoice[] = [
    { id: 'INV-1', customer: 'شركة النخيل', total: '1,200.00' },
    { id: 'INV-2', customer: 'مطعم البحر', total: '980.50' },
];

const columns: DataTableColumn<Invoice>[] = [
    { key: 'id', header: 'الفاتورة', cell: (row) => row.id, numeric: true },
    { key: 'customer', header: 'العميل', cell: (row) => row.customer },
    { key: 'total', header: 'الإجمالي', cell: (row) => row.total, numeric: true },
];

function rowKey(row: Invoice): string {
    return row.id;
}

const BASE = { columns, rowKey, caption: 'فواتير المبيعات' };

describe('DataTable', () => {
    it('يعرض الرؤوس والصفوف وعنوان الجدول', () => {
        render(<DataTable<Invoice> {...BASE} rows={rows} />);

        const table = screen.getByRole('table', { name: 'فواتير المبيعات' });
        expect(table).toBeTruthy();
        expect(screen.getByRole('columnheader', { name: 'العميل' })).toBeTruthy();
        expect(within(table).getByText('شركة النخيل')).toBeTruthy();
        expect(screen.getByTestId('datatable').getAttribute('data-row-count')).toBe('2');
        expect(screen.getByTestId('datatable').getAttribute('data-virtualized')).toBe('false');
    });

    it('تعرض البطاقات على الجوال بنفس القيم', () => {
        render(<DataTable<Invoice> {...BASE} rows={rows} />);

        const cards = screen.getByRole('list', { name: 'فواتير المبيعات — بطاقات' });
        expect(within(cards).getByText('شركة النخيل')).toBeTruthy();
        expect(within(cards).getByText('980.50')).toBeTruthy();
    });

    it('حالة loading: الرؤوس تبقى وaria-busy ورسالة حالة', () => {
        render(<DataTable<Invoice> {...BASE} rows={[]} state="loading" />);

        expect(screen.getByRole('table', { name: 'فواتير المبيعات' }).getAttribute('aria-busy')).toBe('true');
        expect(screen.getByRole('columnheader', { name: 'العميل' })).toBeTruthy();
        expect(screen.getByRole('status').textContent).toContain('جارٍ تحميل البيانات');
    });

    it('حالة empty: عنوان وتلميح', () => {
        render(<DataTable<Invoice> {...BASE} rows={[]} state="empty" />);

        expect(screen.getByText('لا بيانات بعد')).toBeTruthy();
        expect(screen.getByText('غيّر المرشّحات أو أضف سجلًا جديدًا.')).toBeTruthy();
        expect(screen.getByRole('columnheader', { name: 'العميل' })).toBeTruthy();
    });

    it('حالة error: role=alert وإعادة المحاولة', () => {
        const onRetry = vi.fn();
        render(
            <DataTable<Invoice> {...BASE} rows={[]} state="error" errorMessage="تعذّر جلب الفواتير" onRetry={onRetry} />,
        );

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('تعذّر جلب الفواتير')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('يضيف ترقيم الصفحات عند تمريره', () => {
        const onPageChange = vi.fn();
        render(
            <DataTable<Invoice>
                {...BASE}
                rows={rows}
                pagination={{ page: 1, pageSize: 10, total: 57, onPageChange }}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'الصفحة 2' }));
        expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('التمرير الافتراضي فوق 200 صف: يرسم جزءًا فقط ويحفظ العدّ', async () => {
        const manyRows: Invoice[] = Array.from({ length: 500 }, (_, index) => ({
            id: `INV-${String(index + 1)}`,
            customer: `عميل ${String(index + 1)}`,
            total: `${String(index)}.00`,
        }));

        render(<DataTable<Invoice> caption="500 فاتورة" columns={columns} rows={manyRows} rowKey={rowKey} />);

        const container = screen.getByTestId('datatable');
        expect(container.getAttribute('data-virtualized')).toBe('true');
        expect(container.getAttribute('data-row-count')).toBe('500');
        expect(screen.getByRole('table', { name: '500 فاتورة' }).getAttribute('aria-rowcount')).toBe('501');

        const rendered = await screen.findAllByTestId('datatable-row');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(60);
        expect(rendered[0]?.getAttribute('data-row-index')).toBe('0');
        expect(rendered[0]?.getAttribute('aria-rowindex')).toBe('2');
    });

    it('لا يفعّل التمرير الافتراضي عند 200 صف أو أقل', () => {
        const small = Array.from({ length: 200 }, (_, index) => ({
            id: `INV-${String(index + 1)}`,
            customer: `عميل ${String(index + 1)}`,
            total: '0.00',
        }));
        render(<DataTable<Invoice> caption="200 فاتورة" columns={columns} rows={small} rowKey={rowKey} />);

        expect(screen.getByTestId('datatable').getAttribute('data-virtualized')).toBe('false');
        expect(screen.getAllByTestId('datatable-row').length).toBe(200);
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <DataTable<Invoice>
                {...BASE}
                rows={rows}
                title="فواتير المبيعات"
                pagination={{ page: 1, pageSize: 10, total: 57, onPageChange: vi.fn() }}
            />,
        );
        await expectNoAxeViolations(container);
    });
});
