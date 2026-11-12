import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { formatInt } from '../lib/format';
import {
    cellText,
    fetchOracleTable,
    fetchOracleTables,
    knownRowsTotal,
    liveCountOf,
    ORACLE_PAGE_SIZE,
    type OracleRefreshResponse,
    type OracleTable,
    refreshOracleTables,
    shortTableName,
    unknownCountTables,
} from '../lib/oracle-data';
import { errorMessage } from '../lib/reporting';
import { useWriteMutation } from '../lib/write';
import { useToast } from '../ui/Toast';

/**
 * بيانات Oracle المنسوخة.
 *
 * قائمة الجداول بعدّاداتها الحيّة + تفاصيل جدول بأعمدته وصفوفه: البحث والترقيم
 * خادميان (`page`/`limit`/`search`)، والأعمدة تأتي مع الاستجابة نفسها.
 * «مزامنة» تعيد عدّ الجداول على الخادم (نفس زرّ القديم) وتحدّث الطوابع فقط،
 * ثم تُبطل قائمة الجداول فيظهر العدّ الجديد.
 */

const TABLES_STALE_MS = 5 * 60 * 1000;

interface DetailState {
    name: string;
    page: number;
    search: string;
}

function tableLabel(table: OracleTable): string {
    return String(table.oracle_name ?? '') || shortTableName(table.pg_name);
}

export function OracleData() {
    const { toast } = useToast();
    const [filter, setFilter] = useState('');
    const [detail, setDetail] = useState<DetailState | null>(null);
    const [detailSearch, setDetailSearch] = useState('');

    const sync = useWriteMutation<void, OracleRefreshResponse>({
        mutationFn: () => refreshOracleTables(),
        errorTitle: 'تعذّرت مزامنة بيانات Oracle',
        invalidate: [['oracle-data', 'tables']],
        onSuccess: (data) => {
            const refreshed = Number(data.refreshed ?? 0);
            const failed = Number(data.failed ?? 0);
            const total = Number(data.total ?? refreshed + failed);
            toast({
                title: 'تمت مزامنة بيانات Oracle',
                description: failed
                    ? `حُدِّث ${formatInt(refreshed)} من ${formatInt(total)} جدولًا، وتعذّر عدّ ${formatInt(failed)}.`
                    : `حُدِّث ${formatInt(refreshed)} من ${formatInt(total)} جدولًا.`,
                variant: failed ? 'info' : 'success',
            });
        },
    });

    const tablesQuery = useQuery({
        queryKey: ['oracle-data', 'tables'],
        queryFn: ({ signal }) => fetchOracleTables(signal),
        staleTime: TABLES_STALE_MS,
    });

    const detailQuery = useQuery({
        queryKey: ['oracle-data', 'table', detail?.name ?? '', detail?.page ?? 1, detail?.search ?? ''],
        queryFn: ({ signal }) =>
            fetchOracleTable(
                detail?.name ?? '',
                {
                    page: detail?.page ?? 1,
                    limit: ORACLE_PAGE_SIZE,
                    search: detail?.search ?? '',
                },
                signal,
            ),
        enabled: detail !== null,
    });

    const tables = tablesQuery.data?.tables ?? [];
    const needle = filter.trim().toLowerCase();
    const filteredTables = needle
        ? tables.filter(
              (table) =>
                  String(table.oracle_name ?? '')
                      .toLowerCase()
                      .includes(needle) ||
                  String(table.pg_name ?? '')
                      .toLowerCase()
                      .includes(needle),
          )
        : tables;
    const knownRows = knownRowsTotal(tables);
    const unknownTables = unknownCountTables(tables);

    const content = detailQuery.data;
    const columns = content?.columns ?? [];
    const rows = content?.rows ?? [];

    function openTable(pgName: string) {
        setDetailSearch('');
        setDetail({ name: pgName, page: 1, search: '' });
    }

    function closeDetail() {
        setDetail(null);
        setDetailSearch('');
    }

    function applyDetailSearch() {
        if (!detail) {
            return;
        }
        setDetail({ ...detail, page: 1, search: detailSearch.trim() });
    }

    function goToPage(next: number) {
        if (!detail) {
            return;
        }
        setDetail({ ...detail, page: Math.max(1, next) });
    }

    return (
        <div className="flex flex-col gap-md">
            <ReportHeader
                title="بيانات Oracle المنسوخة"
                english="Oracle Data"
                description="الجداول المنسوخة من Oracle: عدّاد صفوفها الحيّ، وأعمدتها وصفوفها بحثًا وترقيمًا من الخادم."
                pending={tablesQuery.isFetching}
                onRefresh={() => {
                    void tablesQuery.refetch();
                }}
            />

            {tablesQuery.isPending ? (
                <SectionCard title="الجداول" english="Tables">
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل قائمة الجداول" />
                        <TableSkeleton rows={6} columns={4} />
                    </div>
                </SectionCard>
            ) : null}

            {tablesQuery.isError ? (
                <SectionCard title="الجداول" english="Tables">
                    <StateError
                        message={errorMessage(tablesQuery.error)}
                        onRetry={() => {
                            void tablesQuery.refetch();
                        }}
                    />
                </SectionCard>
            ) : null}

            {tablesQuery.data ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-3" aria-label="مؤشرات بيانات Oracle">
                        <KpiCard label="الجداول" english="Tables" value={formatInt(tables.length)} hint="جداول منسوخة معلنة في الخادم" />
                        <KpiCard
                            label="الصفوف المعروفة"
                            english="Known rows"
                            value={formatInt(knownRows)}
                            hint="مجموع العدّادات الحيّة (عدا المجهولة)"
                        />
                        <KpiCard
                            label="بلا عدّ"
                            english="Unknown"
                            value={formatInt(unknownTables)}
                            hint={unknownTables > 0 ? 'تعذّر عدّها على الخادم — تُعرض «—»' : 'كل الجداول معدودة'}
                            tone={unknownTables > 0 ? 'warning' : 'neutral'}
                        />
                    </ul>

                    <SectionCard
                        title="الجداول"
                        english="Tables"
                        actions={
                            <div className="flex flex-wrap items-center gap-sm">
                                <label className="flex items-center gap-xxs text-body-sm text-muted" htmlFor="ora-filter">
                                    بحث في اسم الجدول
                                    <input
                                        id="ora-filter"
                                        type="search"
                                        value={filter}
                                        onChange={(event) => {
                                            setFilter(event.target.value);
                                        }}
                                        placeholder="Oracle أو karim…"
                                        className="h-8 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={() => {
                                        sync.mutate();
                                    }}
                                    disabled={sync.isPending}
                                    className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                                >
                                    {sync.isPending ? 'جارٍ المزامنة…' : 'مزامنة'}
                                </button>
                            </div>
                        }
                    >
                        {filteredTables.length === 0 ? (
                            <StateEmpty
                                title={tables.length === 0 ? 'لا جداول منسوخة' : 'لا جداول مطابقة'}
                                hint={
                                    tables.length === 0
                                        ? 'لم يعلن الخادم أي جدول Oracle منسوخ بعد.'
                                        : 'امسح البحث أو جرّب اسمًا آخر من أسماء Oracle أو karim.'
                                }
                            />
                        ) : (
                            <TableScroll label="جدول قائمة جداول Oracle">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الجدول (Oracle)
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الجدول (karim)
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الصفوف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-center font-medium">
                                                <span className="sr-only">فتح الجدول</span>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredTables.map((table) => {
                                            const count = liveCountOf(table);
                                            const label = tableLabel(table);
                                            return (
                                                <tr key={table.pg_name} className="border-b border-hairline">
                                                    <td className="px-sm py-xxs text-ink">
                                                        <b>{String(table.oracle_name ?? '—')}</b>
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                        {table.pg_name}
                                                    </td>
                                                    <td className="px-sm py-xxs">
                                                        {count === null ? (
                                                            <span
                                                                className="text-caption text-warning-text"
                                                                title="تعذّر عدّ هذا الجدول على الخادم"
                                                            >
                                                                —
                                                            </span>
                                                        ) : (
                                                            <span className="erp-numeric text-body-sm text-ink" dir="ltr">
                                                                {formatInt(count)}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-sm py-xxs text-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                openTable(table.pg_name);
                                                            }}
                                                            aria-label={`عرض جدول ${label}`}
                                                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                                                        >
                                                            عرض
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>
                </>
            ) : null}

            {detail ? (
                <SectionCard
                    title={`جدول ${detail.name}`}
                    english="Table"
                    actions={
                        <div className="flex flex-wrap gap-xs">
                            {content ? <PrintActions title="بيانات Oracle المنسوخة" /> : null}
                            <button
                                type="button"
                                onClick={closeDetail}
                                className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                            >
                                إغلاق الجدول
                            </button>
                        </div>
                    }
                >
                    {detailQuery.isPending ? (
                        <div aria-busy="true">
                            <StateLoading label={`جارٍ تحميل جدول ${detail.name}`} />
                            <TableSkeleton rows={6} columns={4} />
                        </div>
                    ) : null}

                    {detailQuery.isError ? (
                        <StateError
                            message={errorMessage(detailQuery.error)}
                            onRetry={() => {
                                void detailQuery.refetch();
                            }}
                        />
                    ) : null}

                    {content ? (
                        <>
                            <div className="flex flex-wrap items-end justify-between gap-sm px-sm pt-sm">
                                <form
                                    className="flex flex-wrap items-end gap-sm"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        applyDetailSearch();
                                    }}
                                >
                                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="ora-search">
                                        بحث داخل الجدول
                                        <input
                                            id="ora-search"
                                            type="search"
                                            value={detailSearch}
                                            onChange={(event) => {
                                                setDetailSearch(event.target.value);
                                            }}
                                            placeholder="بحث في كل الأعمدة النصية…"
                                            className="h-9 min-w-56 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                                        />
                                    </label>
                                    <button
                                        type="submit"
                                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                                    >
                                        بحث
                                    </button>
                                    <span className="text-body-sm text-muted">
                                        {formatInt(content.total)} صف · صفحة {formatInt(content.page)} من {formatInt(content.totalPages)}
                                        {detail.search ? ` · بحث: ${detail.search}` : ''}
                                    </span>
                                </form>
                            </div>

                            {columns.length === 0 ? (
                                <StateEmpty
                                    title="لا أعمدة لهذا الجدول"
                                    hint="لم يعد الخادم أعمدة — تحقّق من وجود الجدول في قاعدة البيانات."
                                />
                            ) : rows.length === 0 ? (
                                <StateEmpty
                                    title="لا صفوف"
                                    hint={
                                        detail.search
                                            ? 'لا صفوف مطابقة للبحث — امسح البحث لعرض الكل.'
                                            : 'الجدول منسوخ لكنه فارغ في قاعدة البيانات.'
                                    }
                                />
                            ) : (
                                <TableScroll label={`جدول ${content.table || detail.name}`}>
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                {columns.map((column) => (
                                                    <th key={column} scope="col" className="px-sm py-xs text-start font-medium">
                                                        <span className="erp-numeric" dir="ltr" lang="en">
                                                            {column}
                                                        </span>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((row, rowIndex) => (
                                                <tr
                                                    key={`oracle-row-${String(rowIndex)}`}
                                                    className="border-b border-hairline hover:bg-surface-hover"
                                                >
                                                    {columns.map((column) => {
                                                        const value = cellText(row[column]);
                                                        return (
                                                            <td
                                                                key={`${column}-${String(rowIndex)}`}
                                                                className="max-w-56 px-sm py-xxs text-body-sm text-ink-secondary"
                                                                dir="auto"
                                                                title={value || undefined}
                                                            >
                                                                <span className="block truncate">{value || '—'}</span>
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}

                            {content.totalPages > 1 ? (
                                <div className="flex flex-wrap items-center justify-between gap-sm border-t border-hairline px-sm py-xs">
                                    <span className="text-body-sm text-muted">
                                        صفحة {formatInt(content.page)} من {formatInt(content.totalPages)}
                                    </span>
                                    <div className="flex gap-xs">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                goToPage(content.page - 1);
                                            }}
                                            disabled={content.page <= 1}
                                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                        >
                                            السابق
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                goToPage(content.page + 1);
                                            }}
                                            disabled={content.page >= content.totalPages}
                                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                        >
                                            التالي
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </>
                    ) : null}
                </SectionCard>
            ) : null}
        </div>
    );
}
