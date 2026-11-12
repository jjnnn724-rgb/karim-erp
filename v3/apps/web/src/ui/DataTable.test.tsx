import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn, dataTableCsv } from './DataTable';
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

interface TreeInvoice extends Invoice {
    children: TreeInvoice[];
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

const featureColumns: DataTableColumn<Invoice>[] = [
    { key: 'id', header: 'الفاتورة', cell: (row) => row.id, exportValue: (row) => row.id },
    {
        key: 'customer',
        header: 'العميل',
        cell: (row) => row.customer,
        sortValue: (row) => row.customer,
        exportValue: (row) => row.customer,
        hideable: true,
    },
    { key: 'total', header: 'الإجمالي', cell: (row) => row.total, exportValue: (row) => row.total },
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
        render(<DataTable<Invoice> {...BASE} rows={[]} state="error" errorMessage="تعذّر جلب الفواتير" onRetry={onRetry} />);

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('تعذّر جلب الفواتير')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('يضيف ترقيم الصفحات عند تمريره', () => {
        const onPageChange = vi.fn();
        render(<DataTable<Invoice> {...BASE} rows={rows} pagination={{ page: 1, pageSize: 10, total: 57, onPageChange }} />);

        fireEvent.click(screen.getByRole('button', { name: 'الصفحة 2' }));
        expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('يرتّب الصفوف محليًا ويحافظ على ثبات ترتيب القيم المتساوية', () => {
        render(<DataTable<Invoice> {...BASE} columns={featureColumns} rows={rows} />);

        const table = screen.getByRole('table', { name: 'فواتير المبيعات' });
        const sortButton = screen.getByRole('button', { name: 'فرز حسب العميل' });
        fireEvent.click(sortButton);
        fireEvent.click(sortButton);

        const renderedRows = within(table).getAllByTestId('datatable-row');
        expect(renderedRows[0]?.textContent).toContain('مطعم البحر');
        expect(screen.getByRole('columnheader', { name: /العميل/ }).getAttribute('aria-sort')).toBe('descending');
    });

    it('يفوّض الفرز الخادمي ولا يعيد ترتيب الصفحة الحالية محليًا', () => {
        const onSortingChange = vi.fn();
        render(
            <DataTable<Invoice>
                {...BASE}
                columns={featureColumns}
                rows={rows}
                pagination={{ page: 1, pageSize: 2, total: 100, onPageChange: vi.fn() }}
                onSortingChange={onSortingChange}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'فرز حسب العميل' }));

        expect(onSortingChange).toHaveBeenCalledWith({ key: 'customer', direction: 'asc' });
        const renderedRows = within(screen.getByRole('table', { name: 'فواتير المبيعات' })).getAllByTestId('datatable-row');
        expect(renderedRows[0]?.textContent).toContain('شركة النخيل');
    });

    it('يحفظ تفضيل إخفاء العمود ويستعيده عند إعادة فتح الجدول', () => {
        const preferenceKey = 'datatable-preferences-test';
        const props = { ...BASE, columns: featureColumns, rows, columnPreferenceKey: preferenceKey };
        const firstRender = render(<DataTable<Invoice> {...props} />);
        fireEvent.click(screen.getByText('الأعمدة'));
        fireEvent.click(screen.getByLabelText('العميل'));

        expect(screen.queryByRole('columnheader', { name: 'العميل' })).toBeNull();
        expect(window.localStorage.getItem(`karim:datatable:${preferenceKey}`)).toBe('[]');
        firstRender.unmount();

        render(<DataTable<Invoice> {...props} />);
        expect(screen.queryByRole('columnheader', { name: 'العميل' })).toBeNull();
    });

    it('ينشئ CSV مقتبسًا ويحمي القيم النصية التي قد تُفسّر كصيغ', () => {
        const csv = dataTableCsv(
            [
                { key: 'customer', header: 'العميل', cell: (row: Invoice) => row.customer, exportValue: (row: Invoice) => row.customer },
                { key: 'total', header: 'الإجمالي', cell: (row: Invoice) => row.total, exportValue: () => -4 },
            ],
            [{ id: 'INV-3', customer: '=1+1,"x"', total: '-4' }],
        );

        expect(csv).toBe('\uFEFF"العميل","الإجمالي"\r\n"\'=1+1,""x""","-4"');
    });

    it('يوضح أن التصدير الافتراضي يقتصر على الصفحة المحمّلة', () => {
        render(
            <DataTable<Invoice>
                {...BASE}
                columns={featureColumns}
                rows={rows}
                pagination={{ page: 1, pageSize: 2, total: 100, onPageChange: vi.fn() }}
            />,
        );

        expect(screen.getByRole('button', { name: 'تصدير الصفحة الحالية CSV' })).toBeTruthy();
    });

    it('يفوّض التصدير الكامل للمالك عند توفير onExport', () => {
        const onExport = vi.fn();
        render(<DataTable<Invoice> {...BASE} rows={rows} onExport={onExport} />);

        fireEvent.click(screen.getByRole('button', { name: 'تصدير CSV' }));
        expect(onExport).toHaveBeenCalledTimes(1);
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

    it('يدعم الصفوف الشجرية والتمديد مع التفويض اليدوي للترشيح والترقيم', async () => {
        const treeRows: TreeInvoice[] = [
            {
                id: 'ROOT',
                customer: 'حساب رئيسي',
                total: '0.00',
                children: [{ id: 'CHILD', customer: 'حساب فرعي', total: '10.00', children: [] }],
            },
        ];
        const treeColumns: DataTableColumn<TreeInvoice>[] = [
            { key: 'id', header: 'الحساب', cell: (row) => row.id },
            { key: 'customer', header: 'الاسم', cell: (row) => row.customer },
        ];
        const onPageChange = vi.fn();

        render(
            <DataTable<TreeInvoice>
                caption="شجرة الحسابات"
                columns={treeColumns}
                rows={treeRows}
                rowKey={(row) => row.id}
                manualFiltering
                manualPagination
                pagination={{ page: 1, pageSize: 1, total: 3, onPageChange }}
                tree={{
                    getSubRows: (row) => row.children,
                    columnKey: 'id',
                    rowCount: 2,
                    renderToggle: ({ row, canExpand, expanded, toggle }) =>
                        canExpand ? (
                            <button type="button" aria-expanded={expanded} aria-label={`فتح الحساب ${row.id}`} onClick={toggle}>
                                فتح
                            </button>
                        ) : (
                            <span aria-hidden="true" />
                        ),
                }}
            />,
        );

        const table = screen.getByRole('table', { name: 'شجرة الحسابات' });
        expect(table.getAttribute('data-manual-filtering')).toBe('true');
        expect(table.getAttribute('data-manual-pagination')).toBe('true');
        fireEvent.click(within(table).getByRole('button', { name: 'فتح الحساب ROOT' }));
        expect(await within(table).findByText('CHILD')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'الصفحة 2' }));
        expect(onPageChange).toHaveBeenCalledWith(2);
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
