import './JournalViewer.premium.css';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { ChevronIcon } from '../components/icons';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { formatMoney, statusLabel, totalCredit, totalDebit } from '../lib/format';
import { fetchJournal } from '../lib/queries';
import { queryKeys } from '../lib/queryKeys';

/**
 * عارض القيود — قراءة فقط (`/api/v3/accounting/journal`).
 *
 * `limit` يمرّ إلى المسار كما هو (القديم يحصره بين 1 و200). المبالغ نصوص
 * `NUMERIC(14,2)` (ADR-04) فتُجمع بـ`addMoney` (مليم) وتُعرض `en-US`.
 */

const LIMITS = [20, 50, 200] as const;

export function JournalViewer() {
    const [limit, setLimit] = useState<number>(20);
    const [openEntry, setOpenEntry] = useState<string | null>(null);

    const query = useQuery({
        queryKey: queryKeys.journal(limit),
        queryFn: ({ signal }) => fetchJournal(limit, signal),
    });

    const entries = query.data ?? [];

    return (
        <div className="journal-premium flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">القيود اليومية</h1>
                    <p className="text-body-sm text-muted">{query.isSuccess ? `${String(entries.length)} قيدًا معروضًا` : 'دفتر القيود'}</p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    <PrintActions title="القيود اليومية" />
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-v3-journal-limit">
                        عدد القيود
                        <select
                            id="erp-v3-journal-limit"
                            value={limit}
                            onChange={(event) => {
                                setLimit(Number(event.target.value));
                                setOpenEntry(null);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            {LIMITS.map((option) => (
                                <option key={option} value={option}>
                                    {option}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </header>

            <Card>
                {query.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل القيود" />
                        <TableSkeleton rows={6} columns={5} />
                    </div>
                ) : null}

                {query.isError ? (
                    <StateError
                        message={query.error instanceof Error ? query.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void query.refetch();
                        }}
                    />
                ) : null}

                {query.isSuccess && entries.length === 0 ? (
                    <StateEmpty title="لا قيود" hint="لا توجد قيود مسجّلة ضمن هذا العدد — جرّب عددًا أكبر." />
                ) : null}

                {query.isSuccess && entries.length > 0 ? (
                    <TableScroll label="جدول القيود اليومية">
                        <table className="w-full border-collapse text-body-md">
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        رقم القيد
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        التاريخ
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        البيان
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الحالة
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        مدين
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        دائن
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((entry) => {
                                    const isOpen = openEntry === entry.id;
                                    return (
                                        <Fragment key={entry.id}>
                                            <tr className="border-b border-hairline hover:bg-surface-hover">
                                                <td className="px-sm py-xxs">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setOpenEntry(isOpen ? null : entry.id);
                                                        }}
                                                        aria-expanded={isOpen}
                                                        className="flex items-center gap-xxs text-start"
                                                    >
                                                        <ChevronIcon className={`size-4 text-muted ${isOpen ? '' : 'rotate-90'}`} />
                                                        <span className="erp-numeric text-body-md text-ink">{entry.entry_no}</span>
                                                    </button>
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-body-sm text-muted">{entry.date}</td>
                                                <td className="px-sm py-xxs text-ink">{entry.memo ?? '—'}</td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">{statusLabel(entry.status)}</td>
                                                <td className="erp-numeric px-sm py-xxs text-end">{formatMoney(totalDebit(entry))}</td>
                                                <td className="erp-numeric px-sm py-xxs text-end">{formatMoney(totalCredit(entry))}</td>
                                            </tr>
                                            {isOpen ? (
                                                <tr className="border-b border-hairline bg-surface-sunken">
                                                    <td colSpan={6} className="px-sm py-sm">
                                                        <dl className="grid gap-xxs text-body-sm">
                                                            {entry.lines.map((line, index) => (
                                                                <div
                                                                    key={`${entry.id}-${String(index)}`}
                                                                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-sm"
                                                                >
                                                                    <dt className="erp-numeric text-ink-secondary">{line.account_code}</dt>
                                                                    <dd className="erp-numeric text-end text-ink">
                                                                        {formatMoney(line.debit)}
                                                                    </dd>
                                                                    <dd className="erp-numeric text-end text-muted">
                                                                        {formatMoney(line.credit)}
                                                                    </dd>
                                                                </div>
                                                            ))}
                                                        </dl>
                                                        <p className="mt-xs text-caption text-muted">
                                                            المصدر: {entry.source_type}
                                                            {entry.source_id ? ` #${entry.source_id}` : ''} · بواسطة:{' '}
                                                            {entry.created_by_name ?? '—'}
                                                        </p>
                                                    </td>
                                                </tr>
                                            ) : null}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TableScroll>
                ) : null}
            </Card>
        </div>
    );
}
