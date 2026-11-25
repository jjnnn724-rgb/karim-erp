import {
    type ColumnDef,
    type ExpandedState,
    getCoreRowModel,
    getExpandedRowModel,
    type Updater,
    useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, type Ref, useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox } from './Checkbox';
import { cn } from './cn';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Pagination, type PaginationLabels } from './Pagination';
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
 * الفرز المحلي اختياري عبر `sortValue` ويقتصر على الصفوف المحمّلة. للصفحات
 * القادمة من الخادم، `onSortingChange` يسلّم الفرز للمالك فلا يعيد ترتيب صفحة
 * واحدة على أنها كامل النتائج. CSV يصدّر القيم المعلنة فقط والصفوف المحمّلة،
 * مع إظهار ذلك في اسم الإجراء؛ يمكن للمالك توفير `onExport` لتصدير خادمي.
 *
 * التمرير الافتراضي: `@tanstack/react-virtual` **headless** فوق 200 صف
 * (PLAN §3.4). الحاوية هي منطقة التمرير الوحيدة (max-height) والـ`tbody`
 * مصغّر بـspacer rows يحفظ `scrollHeight`، مع `aria-rowcount`/`aria-rowindex`
 * ليبقى الجدول مفهومًا لقارئ الشاشة رغم أن الصفوف المرسومة جزئية.
 *
 * الصفوف الشجرية تستخدم TanStack Table (`getSubRows`/expanded row model).
 * عند تفعيل `manualFiltering` أو `manualPagination` تبقى نتيجة المرشّح والصفحة
 * مسؤولية طبقة الخدمة؛ لا يطبّق الجدول تقطيعًا أو ترشيحًا محليًا.
 */

export type DataTableState = 'data' | 'loading' | 'empty' | 'error';

export interface DataTableColumn<T> {
    key: string;
    header: string;
    cell: (row: T) => ReactNode;
    sortValue?: (row: T) => string | number | Date | null | undefined;
    exportValue?: (row: T) => string | number | boolean | Date | null | undefined;
    hideable?: boolean;
    visibleByDefault?: boolean;
    /** خلية رقمية: `tabular-nums` واتجاه معزول (DESIGN.md). */
    numeric?: boolean;
    align?: 'start' | 'center' | 'end';
    /** إخفاء في عرض البطاقات على الجوال (عمود ثانوي). */
    hideOnMobile?: boolean;
    className?: string;
}

export interface DataTableSorting {
    key: string;
    direction: 'asc' | 'desc';
}

export interface DataTablePagination {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    labels?: Partial<PaginationLabels>;
}

export interface DataTableTreeRow<T> {
    row: T;
    depth: number;
    expanded: boolean;
    canExpand: boolean;
    toggle: () => void;
}

export interface DataTableTree<T> {
    getSubRows: (row: T) => T[] | undefined;
    columnKey: string;
    renderToggle: (row: DataTableTreeRow<T>) => ReactNode;
    defaultExpanded?: ExpandedState;
    expanded?: ExpandedState;
    onExpandedChange?: (expanded: ExpandedState) => void;
    indentSize?: number;
    /** Total filtered records, including rows hidden under collapsed parents. */
    rowCount?: number;
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
    /** Data and page boundaries are owned by the query/service layer. */
    manualPagination?: boolean;
    /** Filtering is owned by the query/service layer. */
    manualFiltering?: boolean;
    tree?: DataTableTree<T>;
    sorting?: DataTableSorting | null;
    defaultSorting?: DataTableSorting | null;
    /** عند تمريره يكون الفرز يدويًا/خادميًا، وتبقى مسؤولية ترتيب الصفوف للمالك. */
    onSortingChange?: (sorting: DataTableSorting | null) => void;
    /** مفتاح فريد وثابت؛ أضف معرّف المستخدم إن كانت التفضيلات خاصة بالحساب. */
    columnPreferenceKey?: string;
    exportFilename?: string;
    /** تصدير مخصص للبيانات الكاملة من الخادم عند الحاجة. */
    onExport?: () => void;
    exportLabel?: string;
    /** عتبة تفعيل التمرير الافتراضي (PLAN §3.4: > 200). */
    virtualizeThreshold?: number;
    rowHeight?: number;
    maxHeight?: number;
    footer?: ReactNode;
    className?: string;
}

interface TableScrollRegionProps {
    caption: string;
    state: DataTableState;
    virtualized: boolean;
    rowCount: number;
    maxHeight: number;
    scrollRef: Ref<HTMLElement>;
    children: ReactNode;
}

function TableScrollRegion({ caption, state, virtualized, rowCount, maxHeight, scrollRef, children }: TableScrollRegionProps) {
    return (
        <section
            tabIndex={0}
            ref={scrollRef}
            aria-label={caption}
            data-testid="datatable"
            data-state={state}
            data-virtualized={virtualized ? 'true' : 'false'}
            data-row-count={rowCount}
            className="erp-table__scroll"
            style={virtualized ? { maxHeight } : undefined}
        >
            {children}
        </section>
    );
}

interface ColumnVisibilityMetadata {
    key: string;
    hideable: boolean;
    visibleByDefault: boolean;
}

const ALIGN_CLASS = {
    start: 'text-start',
    center: 'text-center',
    end: 'text-end',
} as const;

const SORT_COLLATOR = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });

function columnAlign<T>(column: DataTableColumn<T>): string {
    if (column.align) {
        return ALIGN_CLASS[column.align];
    }
    return column.numeric ? 'text-end' : 'text-start';
}

function defaultColumnKeys(columns: readonly ColumnVisibilityMetadata[]): string[] {
    const visible = columns.filter((column) => !column.hideable || column.visibleByDefault !== false).map((column) => column.key);
    return visible.length > 0 ? visible : columns.map((column) => column.key);
}

function readColumnVisibility(
    preferenceKey: string | undefined,
    columns: readonly ColumnVisibilityMetadata[],
): { keys: string[]; error: string } {
    const defaults = defaultColumnKeys(columns);
    if (!preferenceKey || typeof window === 'undefined') {
        return { keys: defaults, error: '' };
    }

    try {
        const stored = window.localStorage.getItem(`karim:datatable:${preferenceKey}`);
        if (stored === null) {
            return { keys: defaults, error: '' };
        }
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed) || !parsed.every((key): key is string => typeof key === 'string')) {
            throw new Error('Stored column preferences must be an array of column keys.');
        }
        const selected = new Set(parsed);
        const visible = columns.filter((column) => !column.hideable || selected.has(column.key)).map((column) => column.key);
        if (visible.length === 0) {
            throw new Error('Stored column preferences cannot hide every column.');
        }
        return { keys: visible, error: '' };
    } catch (error) {
        console.error('[DataTable] Failed to load column preferences', error);
        return { keys: defaults, error: 'تعذّر تحميل تفضيلات الأعمدة؛ عُرضت الأعمدة الافتراضية.' };
    }
}

function compareSortValues(left: string | number | Date | null | undefined, right: string | number | Date | null | undefined): number {
    if (left == null || right == null) {
        if (left == null && right == null) {
            return 0;
        }
        return left == null ? 1 : -1;
    }
    if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
    }
    if (left instanceof Date && right instanceof Date) {
        return left.getTime() - right.getTime();
    }
    return SORT_COLLATOR.compare(String(left), String(right));
}

function csvCell(value: string | number | boolean | Date | null | undefined): string {
    const text = value instanceof Date ? value.toISOString() : value == null ? '' : String(value);
    const safeText = typeof value === 'number' || typeof value === 'boolean' || !/^\s*[=+\-@]/.test(text) ? text : `'${text}`;
    return `"${safeText.replace(/"/g, '""')}"`;
}

export function dataTableCsv<T>(columns: readonly DataTableColumn<T>[], rows: readonly T[]): string {
    const exportColumns = columns.filter((column) => column.exportValue);
    if (exportColumns.length === 0) {
        throw new Error('CSV export requires at least one column with exportValue.');
    }
    const lines = [
        exportColumns.map((column) => csvCell(column.header)).join(','),
        ...rows.map((row) => exportColumns.map((column) => csvCell(column.exportValue?.(row))).join(',')),
    ];
    return `\uFEFF${lines.join('\r\n')}`;
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
    manualPagination = Boolean(pagination),
    manualFiltering = false,
    tree,
    sorting,
    defaultSorting,
    onSortingChange,
    columnPreferenceKey,
    exportFilename,
    onExport,
    exportLabel,
    virtualizeThreshold = 200,
    rowHeight = 34,
    maxHeight = 520,
    footer,
    className,
}: DataTableProps<T>) {
    const scrollRef = useRef<HTMLElement | null>(null);
    const effectiveState: DataTableState = state ?? (rows.length === 0 ? 'empty' : 'data');
    const preferenceSignature = `${columnPreferenceKey ?? ''}:${columns
        .map((column) => `${column.key}:${column.hideable ? '1' : '0'}:${column.visibleByDefault === false ? '0' : '1'}`)
        .join('|')}`;
    // biome-ignore lint/correctness/useExhaustiveDependencies: preferenceSignature tracks every metadata value used by this projection.
    const preferenceColumns = useMemo(
        () =>
            columns.map(({ key, hideable, visibleByDefault }) => ({
                key,
                hideable: Boolean(hideable),
                visibleByDefault: visibleByDefault !== false,
            })),
        [preferenceSignature],
    );
    const [visibility, setVisibility] = useState(() => readColumnVisibility(columnPreferenceKey, preferenceColumns));
    const [internalSorting, setInternalSorting] = useState<DataTableSorting | null>(defaultSorting ?? null);
    const currentSorting = sorting === undefined ? internalSorting : sorting;
    const hideableColumns = columns.filter((column) => column.hideable);
    const visibleKeySet = new Set(visibility.keys);
    const visibleColumns = columns.filter((column) => !column.hideable || visibleKeySet.has(column.key));
    const exportColumns = visibleColumns.filter((column) => column.exportValue);
    const visibleRows = useMemo(() => {
        if (onSortingChange || !currentSorting) {
            return rows;
        }
        const column = columns.find((candidate) => candidate.key === currentSorting.key && candidate.sortValue);
        if (!column?.sortValue) {
            return rows;
        }
        return rows
            .map((row, index) => ({ row, index, value: column.sortValue?.(row) }))
            .sort(
                (left, right) =>
                    compareSortValues(left.value, right.value) * (currentSorting.direction === 'asc' ? 1 : -1) || left.index - right.index,
            )
            .map(({ row }) => row);
    }, [columns, currentSorting, onSortingChange, rows]);
    const tableData = useMemo(() => Array.from(visibleRows), [visibleRows]);
    const tableColumns = useMemo<ColumnDef<T, unknown>[]>(() => columns.map((column) => ({ id: column.key })), [columns]);
    const [internalExpanded, setInternalExpanded] = useState<ExpandedState>(() => tree?.defaultExpanded ?? {});
    const expanded = tree?.expanded ?? internalExpanded;

    useEffect(() => {
        if (tree?.expanded === undefined && tree?.defaultExpanded !== undefined) {
            setInternalExpanded(tree.defaultExpanded);
        }
    }, [tree?.defaultExpanded, tree?.expanded]);

    const table = useReactTable({
        data: tableData,
        columns: tableColumns,
        getRowId: (row) => String(rowKey(row)),
        getCoreRowModel: getCoreRowModel(),
        ...(tree
            ? {
                  getSubRows: tree.getSubRows,
                  getExpandedRowModel: getExpandedRowModel(),
                  state: { expanded },
                  onExpandedChange: (updater: Updater<ExpandedState>) => {
                      const next = typeof updater === 'function' ? updater(expanded) : updater;
                      if (tree.expanded === undefined) {
                          setInternalExpanded(next);
                      }
                      tree.onExpandedChange?.(next);
                  },
              }
            : {}),
        manualFiltering,
        manualPagination,
        ...(pagination ? { pageCount: Math.ceil(pagination.total / pagination.pageSize) } : {}),
    });
    const tableRows = table.getRowModel().rows;
    const exportRowsData = useMemo(() => {
        if (!tree) {
            return visibleRows;
        }
        const flattened: T[] = [];
        const visit = (items: readonly T[]) => {
            for (const item of items) {
                flattened.push(item);
                const children = tree.getSubRows(item);
                if (children) {
                    visit(children);
                }
            }
        };
        visit(visibleRows);
        return flattened;
    }, [tree, visibleRows]);

    useEffect(() => {
        setVisibility(readColumnVisibility(columnPreferenceKey, preferenceColumns));
    }, [columnPreferenceKey, preferenceColumns]);

    const virtualized = effectiveState === 'data' && tableRows.length > virtualizeThreshold;

    const virtualizer = useVirtualizer({
        count: tableRows.length,
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

    function changeSorting(key: string): void {
        const next: DataTableSorting | null =
            currentSorting?.key !== key
                ? { key, direction: 'asc' }
                : currentSorting.direction === 'asc'
                  ? { key, direction: 'desc' }
                  : null;
        if (onSortingChange) {
            onSortingChange(next);
        } else {
            setInternalSorting(next);
        }
    }

    function toggleColumn(key: string): void {
        const nextKeys = visibleKeySet.has(key) ? visibility.keys.filter((visibleKey) => visibleKey !== key) : [...visibility.keys, key];
        if (currentSorting?.key === key) {
            if (onSortingChange) {
                onSortingChange(null);
            } else {
                setInternalSorting(null);
            }
        }
        setVisibility({ keys: nextKeys, error: '' });
        if (!columnPreferenceKey) {
            return;
        }
        try {
            window.localStorage.setItem(
                `karim:datatable:${columnPreferenceKey}`,
                JSON.stringify(nextKeys.filter((visibleKey) => columns.some((column) => column.key === visibleKey && column.hideable))),
            );
        } catch (error) {
            console.error('[DataTable] Failed to save column preferences', error);
            setVisibility({ keys: nextKeys, error: 'تعذّر حفظ تفضيلات الأعمدة؛ سيبقى التغيير لهذه الجلسة فقط.' });
        }
    }

    function exportRows(): void {
        if (onExport) {
            onExport();
            return;
        }
        const csv = dataTableCsv(exportColumns, exportRowsData);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const filename = (exportFilename || caption || 'karim-export').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'karim-export';
        link.href = url;
        link.download = `${filename}.csv`;
        try {
            link.click();
        } finally {
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
        }
    }

    function renderTreeCell(row: (typeof tableRows)[number], column: DataTableColumn<T>): ReactNode {
        const content = column.cell(row.original);
        if (!tree || tree.columnKey !== column.key) {
            return content;
        }
        return (
            <div className="flex items-center gap-xxs" style={{ paddingInlineStart: `${String(row.depth * (tree.indentSize ?? 18))}px` }}>
                {tree.renderToggle({
                    row: row.original,
                    depth: row.depth,
                    expanded: row.getIsExpanded(),
                    canExpand: row.getCanExpand(),
                    toggle: row.getToggleExpandedHandler(),
                })}
                {content}
            </div>
        );
    }

    function renderDataRow(row: (typeof tableRows)[number], index: number): ReactNode {
        return (
            <tr
                key={row.id}
                data-testid="datatable-row"
                data-row-index={index}
                aria-rowindex={index + 2}
                className="border-b border-hairline transition-colors duration-[var(--erp-motion-fast)] hover:bg-surface-hover last:border-b-0"
                style={virtualized ? { height: rowHeight } : undefined}
            >
                {visibleColumns.map((column) => (
                    <td
                        key={column.key}
                        className={cn('px-sm py-xs align-middle', columnAlign(column), column.numeric && 'erp-numeric', column.className)}
                    >
                        {renderTreeCell(row, column)}
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
                        <td colSpan={visibleColumns.length} className="p-0">
                            <span role="status" className="sr-only">
                                جارٍ تحميل البيانات
                            </span>
                        </td>
                    </tr>
                    {Array.from({ length: loadingRows }, (_, rowIndex) => (
                        // biome-ignore lint/a11y/noAriaHiddenOnFocusable: decorative table row has no interactive descendants.
                        <tr key={`skeleton-row-${String(rowIndex)}`} style={{ height: rowHeight }} aria-hidden="true">
                            <td colSpan={visibleColumns.length} className="px-sm">
                                <div className="flex gap-sm">
                                    {visibleColumns.map((column) => (
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
                    <td colSpan={visibleColumns.length}>
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
                    <td colSpan={visibleColumns.length}>
                        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
                    </td>
                </tr>
            );
        }

        if (!virtualized) {
            return tableRows.map((row, index) => renderDataRow(row, index));
        }

        return (
            <>
                {paddingTop > 0 ? (
                    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: virtual spacer row is decorative and has no interactive descendants.
                    <tr aria-hidden="true" style={{ height: paddingTop }}>
                        <td colSpan={visibleColumns.length} />
                    </tr>
                ) : null}
                {virtualItems.map((virtualItem) => {
                    const row = tableRows[virtualItem.index];
                    return row ? renderDataRow(row, virtualItem.index) : null;
                })}
                {paddingBottom > 0 ? (
                    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: virtual spacer row is decorative and has no interactive descendants.
                    <tr aria-hidden="true" style={{ height: paddingBottom }}>
                        <td colSpan={visibleColumns.length} />
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
            {hideableColumns.length > 0 || (effectiveState === 'data' && (onExport || exportColumns.length > 0)) ? (
                <div className="flex flex-wrap items-start justify-between gap-sm border-b border-hairline px-md py-sm">
                    {hideableColumns.length > 0 ? (
                        <details>
                            <summary className="cursor-pointer text-label-md text-ink">الأعمدة</summary>
                            <fieldset className="mt-xs flex flex-col gap-xs rounded-md border border-hairline p-sm">
                                <legend className="px-xs text-caption text-muted">إظهار الأعمدة</legend>
                                {hideableColumns.map((column) => {
                                    const checked = visibleKeySet.has(column.key);
                                    return (
                                        <Checkbox
                                            key={column.key}
                                            label={column.header}
                                            checked={checked}
                                            disabled={checked && visibleColumns.length <= 1}
                                            onCheckedChange={(next) => {
                                                if (next !== 'indeterminate') {
                                                    toggleColumn(column.key);
                                                }
                                            }}
                                        />
                                    );
                                })}
                            </fieldset>
                        </details>
                    ) : null}
                    {effectiveState === 'data' && (onExport || exportColumns.length > 0) ? (
                        <button
                            type="button"
                            onClick={exportRows}
                            className="rounded-md border border-hairline px-sm py-xs text-label-md text-ink hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                            {exportLabel ?? (onExport ? 'تصدير CSV' : pagination ? 'تصدير الصفحة الحالية CSV' : 'تصدير الصفوف الحالية CSV')}
                        </button>
                    ) : null}
                    {visibility.error ? (
                        <p role="status" className="basis-full text-body-sm text-danger-text">
                            {visibility.error}
                        </p>
                    ) : null}
                </div>
            ) : null}
            <div className="hidden md:block">
                <TableScrollRegion
                    caption={caption}
                    state={effectiveState}
                    virtualized={virtualized}
                    rowCount={tableRows.length}
                    maxHeight={maxHeight}
                    scrollRef={scrollRef}
                >
                    <table
                        aria-rowcount={(tree?.rowCount ?? pagination?.total ?? tableRows.length) + 1}
                        aria-busy={effectiveState === 'loading' || undefined}
                        data-manual-filtering={manualFiltering ? 'true' : 'false'}
                        data-manual-pagination={manualPagination ? 'true' : 'false'}
                        className="w-full border-collapse text-body-md"
                    >
                        <caption className="sr-only">{caption}</caption>
                        <thead className={cn(virtualized && 'sticky top-0 z-[var(--erp-z-sticky)]')}>
                            <tr className="bg-surface-sunken text-ink-secondary">
                                {visibleColumns.map((column) => {
                                    const sortable =
                                        Boolean(column.sortValue) &&
                                        (!pagination || pagination.total <= rows.length || Boolean(onSortingChange));
                                    const sorted = currentSorting?.key === column.key;
                                    return (
                                        <th
                                            key={column.key}
                                            scope="col"
                                            aria-sort={
                                                sortable
                                                    ? sorted
                                                        ? currentSorting?.direction === 'asc'
                                                            ? 'ascending'
                                                            : 'descending'
                                                        : 'none'
                                                    : undefined
                                            }
                                            className={cn('px-sm py-xs text-label-md font-medium', columnAlign(column), column.className)}
                                        >
                                            {sortable ? (
                                                <button
                                                    type="button"
                                                    aria-label={`فرز حسب ${column.header}`}
                                                    onClick={() => changeSorting(column.key)}
                                                    className="inline-flex items-center gap-xs text-inherit hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                                                >
                                                    {column.header}
                                                    {sorted ? (currentSorting?.direction === 'asc' ? ' ↑' : ' ↓') : null}
                                                </button>
                                            ) : (
                                                column.header
                                            )}
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>{renderBody()}</tbody>
                    </table>
                </TableScrollRegion>
            </div>
            {effectiveState === 'data' ? (
                <ul aria-label={`${caption} — بطاقات`} className="flex flex-col divide-y divide-hairline md:hidden">
                    {tableRows.map((row) => (
                        <li key={row.id} className="flex flex-col gap-xs p-sm">
                            {visibleColumns
                                .filter((column) => !column.hideOnMobile)
                                .map((column) => (
                                    <div key={column.key} className="flex items-start justify-between gap-sm">
                                        <span className="text-caption text-muted">{column.header}</span>
                                        <div className={cn('text-end text-body-sm text-ink', column.numeric && 'erp-numeric')}>
                                            {renderTreeCell(row, column)}
                                        </div>
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
                        {...(pagination.labels ? { labels: pagination.labels } : {})}
                    />
                </div>
            ) : null}
            {footer ? <div className="border-t border-hairline p-sm">{footer}</div> : null}
        </div>
    );
}
