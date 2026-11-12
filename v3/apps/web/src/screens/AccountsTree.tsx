import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { type AccountChartFilterDraft, SearchToolbar } from '../components/AccountingChartFilters';
import { ChevronIcon } from '../components/icons';
import { PrintActions } from '../components/PrintActions';
import type { AccountChartNode } from '../lib/account-chart';
import { mockAccountChartPageService } from '../lib/account-chart';
import { accountTypeLabel, formatInt } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import type { DataTableColumn, DataTableTreeRow } from '../ui';
import { DataTable, useToast } from '../ui';

const PAGE_SIZE = 4;
const EMPTY_PAGE_ITEMS: AccountChartNode[] = [];

const EMPTY_FILTERS: AccountChartFilterDraft = {
    search: '',
    type: 'all',
    level: null,
};

function getAccountChildren(node: AccountChartNode): AccountChartNode[] {
    return node.children;
}

function renderTreeToggle({ row, expanded, canExpand, toggle }: DataTableTreeRow<AccountChartNode>) {
    if (!canExpand) {
        return <span aria-hidden="true" className="inline-block w-5 shrink-0" />;
    }

    return (
        <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'طيّ' : 'فتح'} حساب ${row.account.code}`}
            className="grid size-5 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
            <ChevronIcon className={`size-4 ${expanded ? '' : 'rotate-90'}`} />
        </button>
    );
}

const ACCOUNT_COLUMNS: DataTableColumn<AccountChartNode>[] = [
    {
        key: 'account',
        header: 'الحساب',
        cell: (node) => (
            <span className="flex items-center gap-xs">
                <span className="erp-numeric text-body-md text-ink">{node.account.code}</span>
                {!node.account.is_active ? (
                    <span className="rounded-full border border-neutral px-xs py-xxs text-caption text-neutral-text">غير نشط</span>
                ) : null}
            </span>
        ),
        sortValue: (node) => node.account.code,
        exportValue: (node) => node.account.code,
    },
    {
        key: 'name',
        header: 'الاسم',
        cell: (node) => node.account.name_ar,
        sortValue: (node) => node.account.name_ar,
        exportValue: (node) => node.account.name_ar,
    },
    {
        key: 'type',
        header: 'النوع',
        cell: (node) => accountTypeLabel(node.account.type),
        sortValue: (node) => node.account.type,
        exportValue: (node) => accountTypeLabel(node.account.type),
    },
    {
        key: 'postable',
        header: 'قابل للترحيل',
        cell: (node) => (node.account.is_postable ? 'نعم' : 'لا'),
        exportValue: (node) => (node.account.is_postable ? 'نعم' : 'لا'),
    },
];

export function AccountsTree() {
    const { toast } = useToast();
    const [draft, setDraft] = useState<AccountChartFilterDraft>(EMPTY_FILTERS);
    const [filters, setFilters] = useState<AccountChartFilterDraft>(EMPTY_FILTERS);
    const [page, setPage] = useState(1);
    const request = useMemo(() => ({ ...filters, page, pageSize: PAGE_SIZE }), [filters, page]);

    const query = useQuery({
        queryKey: queryKeys.chartPage(request.page, request.pageSize, request.search, request.type, request.level),
        queryFn: ({ signal }) => mockAccountChartPageService(request, signal),
    });

    const pageItems = query.data?.items ?? EMPTY_PAGE_ITEMS;
    const hasActiveFilters = filters.search.trim() !== '' || filters.type !== 'all' || filters.level !== null;
    const defaultExpanded = useMemo(() => {
        const expanded: Record<string, boolean> = {};
        const visit = (nodes: readonly AccountChartNode[], rootsOnly: boolean) => {
            for (const node of nodes) {
                if (node.children.length > 0 && (!rootsOnly || node.depth === 0)) {
                    expanded[node.account.code] = true;
                }
                visit(node.children, rootsOnly);
            }
        };
        visit(pageItems, !hasActiveFilters);
        return expanded;
    }, [hasActiveFilters, pageItems]);

    const tree = useMemo(
        () => ({
            getSubRows: getAccountChildren,
            columnKey: 'account',
            renderToggle: renderTreeToggle,
            defaultExpanded,
            rowCount: query.data?.rowCount ?? 0,
            indentSize: 18,
        }),
        [defaultExpanded, query.data?.rowCount],
    );

    function applyFilters() {
        setFilters({ ...draft, search: draft.search.trim() });
        setPage(1);
        toast({ title: 'تم تطبيق المرشّحات', variant: 'success' });
    }

    function resetFilters() {
        setDraft(EMPTY_FILTERS);
        setFilters(EMPTY_FILTERS);
        setPage(1);
        toast({ title: 'تم مسح المرشّحات', variant: 'success' });
    }

    return (
        <div className="flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">شجرة الحسابات</h1>
                    <p className="text-body-sm text-muted" aria-live="polite">
                        {query.isSuccess
                            ? `${formatInt(query.data.matchedAccounts)} حساب مطابق · ${formatInt(query.data.total)} مجموعة حساب رئيسية`
                            : 'عرض شجري للحسابات مع البحث والمرشّحات'}
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    <PrintActions title="شجرة الحسابات" />
                </div>
            </header>

            <SearchToolbar
                value={draft}
                levels={query.data?.availableLevels ?? []}
                onChange={setDraft}
                onApply={applyFilters}
                onReset={resetFilters}
            />

            <DataTable<AccountChartNode>
                title="الحسابات"
                caption="جدول شجرة الحسابات"
                columns={ACCOUNT_COLUMNS}
                rows={pageItems}
                rowKey={(node) => node.account.code}
                state={query.isPending ? 'loading' : query.isError ? 'error' : pageItems.length === 0 ? 'empty' : 'data'}
                loadingRows={6}
                emptyTitle={hasActiveFilters ? 'لا نتائج' : 'لا توجد حسابات'}
                emptyDescription={hasActiveFilters ? 'لا يوجد حساب يطابق هذه المرشّحات. جرّب تغييرها أو مسحها.' : 'لم تُستورد الحسابات بعد.'}
                errorMessage={query.error instanceof Error ? query.error.message : 'خطأ غير معروف'}
                onRetry={() => {
                    void query.refetch();
                }}
                manualFiltering
                manualPagination
                tree={tree}
                {...(query.isSuccess && query.data.total > 0
                    ? {
                          pagination: {
                              page,
                              pageSize: PAGE_SIZE,
                              total: query.data.total,
                              onPageChange: setPage,
                              labels: {
                                  summary: (from: number, to: number, total: number) =>
                                      `${formatInt(from)}–${formatInt(to)} من ${formatInt(total)} مجموعة حساب رئيسية`,
                              },
                          },
                      }
                    : {})}
                exportFilename="شجرة-الحسابات"
            />
        </div>
    );
}
