import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, type ReactNode } from 'react';
import { cn } from './cn';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Pagination } from './Pagination';
import { Skeleton } from './Skeleton';

/**
 * جدول بيانات — عقد DESIGN.md للحالات الأربع (لا منطقة فارغة أبدًا):
 *
 *  1. `loading` → هيكل عظمي بصفوف بنفس الارتفاع **مع إبقاء الرؤوس الحقيقية**،
 *     `aria-busy` ورسالة `role="status"` مخفية (هدف CLS = 0).
 *  2. `error` → `role="alert"` + زر إعادة المحاولة.
 *  3. `empty` → عنوان + تلميح (ماذا يفعل المستخدم الآن؟).
 *  4. `data` → الصفوف.
 *
 * التجاوب: نفس البيانات تُعرض بطاقات على الجوال (`md:hidden`) والجدول يبقى
 * لسطح المكتب — لا تمرير أفقي للصفحة.
 *
 * التمرير الافتراضي: `@tanstack/react-virtual` **headless** فوق 200 صف
 * (PLAN §3.4). الحاوية هي منطقة التمرير الوحيدة (max-height) والـ`tbody`
 * مصغّر بـspacer rows يحفظ `scrollHeight`، مع `aria-rowcount`/`aria-rowindex`
 * ليبقى الجدول مفهومًا لقارئ الشاشة رغم أن الصفوف المرسومة جزئية.
 */

export type DataTableState = 'data' | 'loading' | 'empty' | 'error';

export interface DataTableColumn<T> {
    key: string;
    header: string;
    cell: (row: T) => ReactNode;
    /** خلية رقمية: `tabular-nums` واتجاه معزول (DESIGN.md). */
    numeric?: boolean;
    align?: 'start' | 'center' | 'end';
    /** إخفاء في عرض البطاقات على الجوال (عمود ثانوي). */
    hideOnMobile?: boolean;
    className?: string;
}

export interface DataTablePagination {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
}

export interface DataTableProps<T> {
    columns: readonly DataTableColumn<T>[];
    rows: readonly T[];
    rowKey: (row: T) => string | number;
    /** عنوان الجدول المفهوم (caption مخفي بصريًا + اسم منطقة التمرير). */
    caption: string;
    /** عنوان ظاهر فوق الجدول. */
    title?: string;
    state?: DataTableState;
    loadingRows?: number;
    emptyTitle?: string;
    emptyDescription?: string;
    emptyAction?: ReactNode;
    errorMessage?: string;
    /** عنوان حالة الخطأ (افتراضي: «تعذّر جلب البيانات») — يُخصَّص في معرض المكوّنات. */
    errorTitle?: string;
    onRetry?: () => void;
    pagination?: DataTablePagination;
    /** عتبة تفعيل التمرير الافتراضي (PLAN §3.4: > 200). */
    virtualizeThreshold?: number;
    rowHeight?: number;
    maxHeight?: number;
    footer?: ReactNode;
    className?: string;
}

const ALIGN_CLASS = {
    start: 'text-start',
    center: 'text-center',
    end: 'text-end',
} as const;

function columnAlign<T>(column: DataTableColumn<T>): string {
    if (column.align) {
        return ALIGN_CLASS[column.align];
    }
    return column.numeric ? 'text-end' : 'text-start';
}

export function DataTable<T>({
    columns,
    rows,
    rowKey,
    caption,
    title,
    state,
    loadingRows = 5,
    emptyTitle = 'لا بيانات بعد',
    emptyDescription = 'غيّر المرشّحات أو أضف سجلًا جديدًا.',
    emptyAction,
    errorMessage,
    errorTitle,
    onRetry,
    pagination,
    virtualizeThreshold = 200,
    rowHeight = 34,
    maxHeight = 520,
    footer,
    className,
}: DataTableProps<T>) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const effectiveState: DataTableState = state ?? (rows.length === 0 ? 'empty' : 'data');
    const virtualized = effectiveState === 'data' && rows.length > virtualizeThreshold;

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => rowHeight,
        overscan: 10,
        enabled: virtualized,
        initialRect: { width: 0, height: Math.min(maxHeight, rowHeight * 12) },
    });

    const virtualItems = virtualizer.getVirtualItems();
    const firstVirtual = virtualItems[0];
    const lastVirtual = virtualItems[virtualItems.length - 1];
    const paddingTop = virtualized && firstVirtual ? firstVirtual.start : 0;
    const paddingBottom = virtualized && lastVirtual ? virtualizer.getTotalSize() - lastVirtual.end : 0;

    function renderDataRow(row: T, index: number): ReactNode {
        return (
            <tr
                key={rowKey(row)}
                data-testid="datatable-row"
                data-row-index={index}
                aria-rowindex={index + 2}
                className="border-b border-hairline transition-colors duration-[var(--erp-motion-fast)] hover:bg-surface-hover last:border-b-0"
                style={virtualized ? { height: rowHeight } : undefined}
            >
                {columns.map((column) => (
                    <td
                        key={column.key}
                        className={cn(
                            'px-sm py-xs align-middle',
                            columnAlign(column),
                            column.numeric && 'erp-numeric',
                            column.className,
                        )}
                    >
                        {column.cell(row)}
                    </td>
                ))}
            </tr>
        );
    }

    function renderBody(): ReactNode {
        if (effectiveState === 'loading') {
            return (
                <>
                    <tr>
                        <td colSpan={columns.length} className="p-0">
                            <span role="status" className="sr-only">
                                جارٍ تحميل البيانات
                            </span>
                        </td>
                    </tr>
                    {Array.from({ length: loadingRows }, (_, rowIndex) => (
                        <tr key={`skeleton-row-${String(rowIndex)}`} style={{ height: rowHeight }} aria-hidden="true">
                            <td colSpan={columns.length} className="px-sm">
                                <div className="flex gap-sm">
                                    {columns.map((column) => (
                                        <Skeleton key={column.key} className="flex-1" />
                                    ))}
                                </div>
                            </td>
                        </tr>
                    ))}
                </>
            );
        }

        if (effectiveState === 'error') {
            return (
                <tr>
                    <td colSpan={columns.length}>
                        <ErrorState
                            {...(errorMessage ? { message: errorMessage } : {})}
                            {...(errorTitle ? { title: errorTitle } : {})}
                            {...(onRetry ? { onRetry } : {})}
                        />
                    </td>
                </tr>
            );
        }

        if (effectiveState === 'empty') {
            return (
                <tr>
                    <td colSpan={columns.length}>
                        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
                    </td>
                </tr>
            );
        }

        if (!virtualized) {
            return rows.map((row, index) => renderDataRow(row, index));
        }

        return (
            <>
                {paddingTop > 0 ? (
                    <tr aria-hidden="true" style={{ height: paddingTop }}>
                        <td colSpan={columns.length} />
                    </tr>
                ) : null}
                {virtualItems.map((virtualItem) => {
                    const row = rows[virtualItem.index];
                    return row ? renderDataRow(row, virtualItem.index) : null;
                })}
                {paddingBottom > 0 ? (
                    <tr aria-hidden="true" style={{ height: paddingBottom }}>
                        <td colSpan={columns.length} />
                    </tr>
                ) : null}
            </>
        );
    }

    return (
        <div className={cn('overflow-hidden rounded-lg border border-hairline bg-surface shadow-card', className)}>
            {title ? (
                <div className="border-b border-hairline px-md py-sm">
                    <h3 className="text-heading-md text-ink">{title}</h3>
                </div>
            ) : null}
            <div className="hidden md:block">
                <div
                    ref={scrollRef}
                    role="region"
                    aria-label={caption}
                    tabIndex={0}
                    data-testid="datatable"
                    data-state={effectiveState}
                    data-virtualized={virtualized ? 'true' : 'false'}
                    data-row-count={rows.length}
                    className="erp-table__scroll"
                    style={virtualized ? { maxHeight } : undefined}
                >
                    <table
                        aria-rowcount={rows.length + 1}
                        aria-busy={effectiveState === 'loading' || undefined}
                        className="w-full border-collapse text-body-md"
                    >
                        <caption className="sr-only">{caption}</caption>
                        <thead className={cn(virtualized && 'sticky top-0 z-[var(--erp-z-sticky)]')}>
                            <tr className="bg-surface-sunken text-ink-secondary">
                                {columns.map((column) => (
                                    <th
                                        key={column.key}
                                        scope="col"
                                        className={cn(
                                            'px-sm py-xs text-label-md font-medium',
                                            columnAlign(column),
                                            column.className,
                                        )}
                                    >
                                        {column.header}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>{renderBody()}</tbody>
                    </table>
                </div>
            </div>
            {effectiveState === 'data' ? (
                <ul aria-label={`${caption} — بطاقات`} className="flex flex-col divide-y divide-hairline md:hidden">
                    {rows.map((row) => (
                        <li key={rowKey(row)} className="flex flex-col gap-xs p-sm">
                            {columns
                                .filter((column) => !column.hideOnMobile)
                                .map((column) => (
                                    <div key={column.key} className="flex items-start justify-between gap-sm">
                                        <span className="text-caption text-muted">{column.header}</span>
                                        <span
                                            className={cn(
                                                'text-end text-body-sm text-ink',
                                                column.numeric && 'erp-numeric',
                                            )}
                                        >
                                            {column.cell(row)}
                                        </span>
                                    </div>
                                ))}
                        </li>
                    ))}
                </ul>
            ) : null}
            {pagination ? (
                <div className="border-t border-hairline p-sm">
                    <Pagination
                        page={pagination.page}
                        pageSize={pagination.pageSize}
                        total={pagination.total}
                        onPageChange={pagination.onPageChange}
                    />
                </div>
            ) : null}
            {footer ? <div className="border-t border-hairline p-sm">{footer}</div> : null}
        </div>
    );
}
