import './InventoryMovements.premium.css';
import { fromCents, toCents } from '@karim/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card } from '../components/TableState';
import { fetchCurrency, firstOfMonth, riyadhToday } from '../lib/finance';
import { formatMoney } from '../lib/format';
import {
    fetchInventoryMovements,
    formatQty,
    MAX_PAGES,
    MOVEMENT_TYPE_LABEL,
    type MovementRow,
    movementToRow,
    sumValuesOfType,
    typeTone,
} from '../lib/inventory';
import { DataTable, type DataTableColumn } from '../ui';

/**
 * حركات المخزون — قراءة فقط من `/api/inventoryTx` لشهر الرياض الحالي،
 * بنفس سقف القديم (8 صفحات) المعلَن على الشاشة. التصفية بالتاريخ والبحث
 * عميلان على المحمّل، والنوع من مفردات الشاشة القديمة نفسها.
 */

const PAGE_SIZE = 50;

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
}

function Kpi({ label, english, value, hint }: { label: string; english: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg border border-hairline bg-surface p-md shadow-card">
            <p className="text-label-md text-muted">
                {label}{' '}
                <span className="text-caption text-faint" dir="ltr" lang="en">
                    {english}
                </span>
            </p>
            <p className="erp-numeric mt-xs text-heading-lg text-ink">{value}</p>
            <p className="mt-xxs text-caption text-muted">{hint}</p>
        </div>
    );
}

function typeClass(row: MovementRow): string {
    const tone = typeTone(row.type);
    if (tone === 'success') {
        return 'text-success-text';
    }
    if (tone === 'danger') {
        return 'text-danger-text';
    }
    return 'text-muted';
}

/**
 * أعمدة الحركات — القيم كما كانت حرفيًا (تواريخ وكميات لاتينية معزولة
 * الاتجاه، والنوع المجهول بشارته الخام). التصدير المعلن للصفحة المحمّلة
 * فقط (`exportValue` لكل عمود)؛ لا فرز هنا لأن التقطيع محلي على صفحة من
 * نتائج مرشّحة أكبر — فرز الصفحة وحدها يوحي بترتيب كامل وهو ليس كذلك.
 */
const MOVEMENT_COLUMNS: DataTableColumn<MovementRow>[] = [
    {
        key: 'date',
        header: 'التاريخ',
        align: 'center',
        className: 'erp-numeric text-body-sm text-muted',
        cell: (row) => <span dir="ltr">{row.date}</span>,
        exportValue: (row) => row.date,
    },
    {
        key: 'itemName',
        header: 'الصنف',
        className: 'text-ink',
        cell: (row) => row.itemName,
        exportValue: (row) => row.itemName,
    },
    {
        key: 'type',
        header: 'النوع',
        className: 'text-body-sm',
        cell: (row) => (
            <span className={typeClass(row)}>
                {row.typeLabel}
                {row.type && !row.typeKnown ? (
                    <span className="text-caption text-faint" dir="ltr">
                        {' '}
                        ({row.type})
                    </span>
                ) : null}
            </span>
        ),
        exportValue: (row) => (row.typeKnown ? row.typeLabel : `${row.typeLabel} (${row.type})`),
    },
    {
        key: 'qty',
        header: 'الكمية',
        align: 'end',
        className: 'erp-numeric text-ink',
        cell: (row) => <span dir="ltr">{formatQty(row.qty)}</span>,
        exportValue: (row) => Number(row.qty),
    },
    {
        key: 'cost',
        header: 'السعر',
        align: 'end',
        className: 'erp-numeric text-ink',
        cell: (row) => formatMoney(row.cost),
        exportValue: (row) => Number(row.cost),
    },
    {
        key: 'totalValue',
        header: 'القيمة',
        align: 'end',
        className: 'erp-numeric text-ink',
        cell: (row) => formatMoney(row.totalValue),
        exportValue: (row) => Number(row.totalValue),
    },
    {
        key: 'ref',
        header: 'المرجع',
        className: 'text-body-sm text-muted',
        cell: (row) => <span dir="ltr">{row.ref || '—'}</span>,
        exportValue: (row) => row.ref,
    },
];

export function InventoryMovements() {
    const [from, setFrom] = useState(firstOfMonth());
    const [to, setTo] = useState(riyadhToday());
    const [search, setSearch] = useState('');
    const [type, setType] = useState('ALL');
    const [page, setPage] = useState(1);

    const movementsQuery = useQuery({
        queryKey: ['inventory', 'movements', 'month'],
        queryFn: ({ signal }) => fetchInventoryMovements(signal),
    });
    const currencyQuery = useQuery({
        queryKey: ['finance', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });

    const currency = currencyQuery.data ?? '';
    const rangeInvalid = Boolean(from && to && from > to);
    const allRows = useMemo(() => (movementsQuery.data ?? []).map(movementToRow), [movementsQuery.data]);

    const rows = useMemo(() => {
        if (rangeInvalid) {
            return [];
        }
        const term = search.trim().toLowerCase();
        return allRows.filter((row) => {
            if (from && row.date < from) {
                return false;
            }
            if (to && row.date > to) {
                return false;
            }
            if (type !== 'ALL' && row.type !== type) {
                return false;
            }
            if (!term) {
                return true;
            }
            return [row.itemName, row.ref, row.id]
                .map((value) => value.toLowerCase())
                .some((value) => value.includes(term));
        });
    }, [allRows, from, to, search, type, rangeInvalid]);

    const incoming = useMemo(() => sumValuesOfType(allRows, 'in'), [allRows]);
    const outgoing = useMemo(() => sumValuesOfType(allRows, 'out'), [allRows]);
    const net = fromCents(toCents(incoming) - toCents(outgoing));

    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const capped = (movementsQuery.data?.length ?? 0) >= 1000 * MAX_PAGES;

    return (
        <div className="flex flex-col gap-md erp-premium-InventoryMovements">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        حركات المخزون{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Stock Movements
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">سجل الوارد والصادر والتسويات لشهر الرياض الحالي.</p>
                </div>

                <div className="flex items-center gap-xs">
                    <PrintActions title="حركات المخزون" />
                    <button
                        type="button"
                        onClick={() => {
                            void movementsQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="الحركات" english="Movements" value={formatInt(allRows.length)} hint="المحمّل من الشهر" />
                <Kpi
                    label="قيمة الوارد"
                    english="Received"
                    value={`${formatMoney(incoming)} ${currency}`.trim()}
                    hint="مجموع type=in"
                />
                <Kpi
                    label="قيمة الصادر"
                    english="Issued"
                    value={`${formatMoney(outgoing)} ${currency}`.trim()}
                    hint="مجموع type=out"
                />
                <Kpi
                    label="الصافي"
                    english="Net Value"
                    value={`${formatMoney(net)} ${currency}`.trim()}
                    hint="وارد − صادر"
                />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-moves-from">
                        من
                        <input
                            id="erp-moves-from"
                            type="date"
                            value={from}
                            max={riyadhToday()}
                            onChange={(event) => {
                                setFrom(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-moves-to">
                        إلى
                        <input
                            id="erp-moves-to"
                            type="date"
                            value={to}
                            max={riyadhToday()}
                            onChange={(event) => {
                                setTo(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label
                        className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-moves-search"
                    >
                        بحث
                        <input
                            id="erp-moves-search"
                            type="search"
                            value={search}
                            placeholder="الصنف أو المرجع أو الرقم…"
                            onChange={(event) => {
                                setSearch(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-moves-type">
                        النوع
                        <select
                            id="erp-moves-type"
                            value={type}
                            onChange={(event) => {
                                setType(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="ALL">كل الأنواع</option>
                            <option value="in">{MOVEMENT_TYPE_LABEL.in}</option>
                            <option value="out">{MOVEMENT_TYPE_LABEL.out}</option>
                            <option value="return">{MOVEMENT_TYPE_LABEL.return}</option>
                            <option value="adjustment">{MOVEMENT_TYPE_LABEL.adjustment}</option>
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={() => {
                            setFrom('');
                            setTo('');
                            setSearch('');
                            setType('ALL');
                            setPage(1);
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        عرض الكل
                    </button>
                    <span className="text-body-sm text-muted">{formatInt(rows.length)} حركة</span>
                </div>
                {rangeInvalid ? (
                    <p role="alert" className="mt-sm text-body-sm text-danger-text">
                        بداية الفترة بعد نهايتها — صحّح التاريخين قبل العرض.
                    </p>
                ) : null}
            </Card>

            <DataTable<MovementRow>
                caption="جدول حركات المخزون"
                columns={MOVEMENT_COLUMNS}
                rows={pageRows}
                rowKey={(row) => row.id}
                state={
                    movementsQuery.isPending
                        ? 'loading'
                        : movementsQuery.isError
                          ? 'error'
                          : rows.length === 0
                            ? 'empty'
                            : 'data'
                }
                loadingRows={8}
                emptyTitle="لا حركات"
                emptyDescription={rangeInvalid ? 'صحّح التاريخين أولًا.' : 'لا حركة في هذه الفترة أو البحث.'}
                errorMessage={movementsQuery.error instanceof Error ? movementsQuery.error.message : 'خطأ غير معروف'}
                onRetry={() => {
                    void movementsQuery.refetch();
                }}
                manualFiltering
                manualPagination
                {...(rows.length > 0
                    ? {
                          pagination: {
                              page: safePage,
                              pageSize: PAGE_SIZE,
                              total: rows.length,
                              onPageChange: setPage,
                              labels: {
                                  summary: (from: number, to: number, total: number) =>
                                      `${formatInt(from)}–${formatInt(to)} من ${formatInt(total)} حركة${
                                          capped ? ` · الخادم أعاد أول ${formatInt(1000 * MAX_PAGES)} حركة فقط` : ''
                                      }`,
                              },
                          },
                      }
                    : {})}
                exportFilename="حركات-المخزون"
            />
        </div>
    );
}
