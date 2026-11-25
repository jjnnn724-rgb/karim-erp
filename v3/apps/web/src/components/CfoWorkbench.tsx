import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuthState } from '../lib/auth';
import {
    approveJournalEntry,
    CFO_WRITE_TEXT,
    canReopenCfo,
    canWriteCfo,
    closePeriod,
    createJournalEntry,
    fetchChartAccounts,
    fetchDrafts,
    type JournalLineInput,
    journalTotals,
    openPeriod,
    validateJournalEntry,
    voidJournalEntry,
} from '../lib/cfo-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { useConfirm } from './ConfirmProvider';

/**
 * واجهة كتابة المدير المالي: قيد يدوي (مسودة أو ترحيل)، اعتماد/إلغاء المسودات،
 * وإقفال/إعادة فتح الفترات. الصلاحيات والتحقق مطابقة للخادم، والواجهة لا
 * تحسب توازنًا نهائيًا بنفسها — تعرض المجاميع ثم تترك القرار للخادم.
 */

interface PeriodRow {
    period?: string | null | undefined;
    closed?: boolean | null | undefined;
}

interface CfoWorkbenchProps {
    periods: readonly PeriodRow[];
}

interface LineRow extends JournalLineInput {
    key: number;
}

let lineKey = 0;
function newLine(): LineRow {
    lineKey += 1;
    return { key: lineKey, accountCode: '', debit: '', credit: '' };
}

function money(cents: number): string {
    return (cents / 100).toFixed(2);
}

export function CfoWorkbench({ periods }: CfoWorkbenchProps) {
    const auth = useAuthState();
    const writable = canWriteCfo(auth.user?.role);
    const reopener = canReopenCfo(auth.user?.role);
    const confirm = useConfirm();

    const [entryOpen, setEntryOpen] = useState(false);
    const [date, setDate] = useState('');
    const [memo, setMemo] = useState('');
    const [lines, setLines] = useState<LineRow[]>(() => [newLine(), newLine()]);
    const [error, setError] = useState('');

    const [draftsOpen, setDraftsOpen] = useState(false);
    const [periodsOpen, setPeriodsOpen] = useState(false);
    const [voidReason, setVoidReason] = useState('');

    const chartQuery = useQuery({
        queryKey: ['cfo-chart'],
        queryFn: ({ signal }) => fetchChartAccounts(signal),
        enabled: entryOpen,
        staleTime: 5 * 60 * 1000,
    });
    const draftsQuery = useQuery({
        queryKey: ['cfo-drafts'],
        queryFn: ({ signal }) => fetchDrafts(signal),
        enabled: draftsOpen,
    });

    const accounts = useMemo(
        () => (chartQuery.data ?? []).filter((account) => account.is_active !== false && account.is_postable !== false),
        [chartQuery.data],
    );
    const totals = useMemo(() => journalTotals(lines), [lines]);

    const createMutation = useWriteMutation<'draft' | 'posted', void>({
        mutationFn: async (status) => {
            const validation = validateJournalEntry(date, lines, status);
            if (!validation.ok) {
                throw new Error(validation.error);
            }
            await createJournalEntry({ ...validation.payload, memo: memo.trim() });
        },
        successTitle: (status) => (status === 'draft' ? CFO_WRITE_TEXT.savedDraft : CFO_WRITE_TEXT.posted),
        invalidate: [['cfo'], ['cfo-drafts']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_WRITE_TEXT.createFailed)),
        onSuccess: () => {
            setEntryOpen(false);
            setLines([newLine(), newLine()]);
            setMemo('');
            setError('');
        },
    });

    const approveMutation = useWriteMutation<string, void>({
        mutationFn: (id) => approveJournalEntry(id),
        successTitle: CFO_WRITE_TEXT.approved,
        invalidate: [['cfo'], ['cfo-drafts']],
    });

    const voidMutation = useWriteMutation<{ id: string; entry: string }, void>({
        mutationFn: ({ id }) => voidJournalEntry(id, voidReason),
        successTitle: CFO_WRITE_TEXT.voided,
        invalidate: [['cfo'], ['cfo-drafts']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_WRITE_TEXT.voidFailed)),
        onSuccess: () => setVoidReason(''),
    });

    const periodMutation = useWriteMutation<{ period: string; action: 'close' | 'open' }, void>({
        mutationFn: ({ period, action }) => (action === 'close' ? closePeriod(period, '') : openPeriod(period, '')),
        successTitle: (vars) => (vars.action === 'close' ? CFO_WRITE_TEXT.periodClosed : CFO_WRITE_TEXT.periodOpened),
        invalidate: [['cfo']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_WRITE_TEXT.periodFailed)),
    });

    async function closeOrOpen(period: string, action: 'close' | 'open'): Promise<void> {
        const message = action === 'close' ? CFO_WRITE_TEXT.closeConfirm(period) : CFO_WRITE_TEXT.openConfirm(period);
        if (!(await confirm(message))) {
            return;
        }
        periodMutation.mutate({ period, action });
    }

    async function handleVoid(id: string, entry: string): Promise<void> {
        if (!(await confirm(CFO_WRITE_TEXT.voidConfirm(entry)))) {
            return;
        }
        setError('');
        voidMutation.mutate({ id, entry });
    }

    if (!writable) {
        return null;
    }

    const periodRows = periods.filter((row): row is PeriodRow & { period: string } => Boolean(row.period));

    return (
        <>
            <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                        setDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }));
                        setError('');
                        setEntryOpen(true);
                    }}
                >
                    {CFO_WRITE_TEXT.newEntry}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                        setError('');
                        setDraftsOpen(true);
                    }}
                >
                    {CFO_WRITE_TEXT.drafts}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                        setError('');
                        setPeriodsOpen(true);
                    }}
                >
                    {CFO_WRITE_TEXT.periods}
                </Button>
            </div>

            {error ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {error}
                </p>
            ) : null}

            <Dialog
                open={entryOpen}
                onOpenChange={setEntryOpen}
                title={CFO_WRITE_TEXT.entryTitle}
                description={CFO_WRITE_TEXT.entryHint}
                size="lg"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setEntryOpen(false)}>
                            {CFO_WRITE_TEXT.close}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={createMutation.isPending}
                            onClick={() => {
                                setError('');
                                createMutation.mutate('draft');
                            }}
                        >
                            {CFO_WRITE_TEXT.saveDraft}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={createMutation.isPending}
                            onClick={() => {
                                setError('');
                                createMutation.mutate('posted');
                            }}
                        >
                            {CFO_WRITE_TEXT.post}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <div className="grid gap-sm sm:grid-cols-2">
                        <Input label={CFO_WRITE_TEXT.date} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                        <Input
                            label={CFO_WRITE_TEXT.memo}
                            value={memo}
                            maxLength={255}
                            placeholder={CFO_WRITE_TEXT.memoPlaceholder}
                            onChange={(event) => setMemo(event.target.value)}
                        />
                    </div>

                    {chartQuery.isError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {writeErrorMessage(chartQuery.error, CFO_WRITE_TEXT.loadFailed)}
                        </p>
                    ) : null}

                    <div className="hidden overflow-auto rounded-md border border-hairline sm:block">
                        <table className="w-full min-w-[34rem] border-collapse text-body-sm">
                            <caption className="sr-only">سطور القيد</caption>
                            <thead className="bg-surface-sunken text-label-md text-ink-secondary">
                                <tr>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        {CFO_WRITE_TEXT.account}
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        {CFO_WRITE_TEXT.debit}
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        {CFO_WRITE_TEXT.credit}
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium" />
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((line) => (
                                    <tr key={line.key} className="border-t border-hairline">
                                        <td className="px-sm py-xxs">
                                            <select
                                                aria-label={CFO_WRITE_TEXT.account}
                                                value={line.accountCode}
                                                onChange={(event) =>
                                                    setLines((current) =>
                                                        current.map((row) =>
                                                            row.key === line.key ? { ...row, accountCode: event.target.value } : row,
                                                        ),
                                                    )
                                                }
                                                className="h-8 w-full min-w-52 rounded border border-hairline-strong bg-surface px-xs text-body-sm text-ink"
                                            >
                                                <option value="">— اختر حسابًا —</option>
                                                {accounts.map((account) => (
                                                    <option key={account.code} value={account.code}>
                                                        {account.code} — {account.name_ar || account.name_en || ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-sm py-xxs">
                                            <input
                                                aria-label={CFO_WRITE_TEXT.debit}
                                                inputMode="decimal"
                                                value={line.debit}
                                                onChange={(event) =>
                                                    setLines((current) =>
                                                        current.map((row) =>
                                                            row.key === line.key ? { ...row, debit: event.target.value, credit: '' } : row,
                                                        ),
                                                    )
                                                }
                                                className="erp-numeric h-8 w-28 rounded border border-hairline-strong bg-surface px-xs text-body-sm text-ink"
                                                dir="ltr"
                                            />
                                        </td>
                                        <td className="px-sm py-xxs">
                                            <input
                                                aria-label={CFO_WRITE_TEXT.credit}
                                                inputMode="decimal"
                                                value={line.credit}
                                                onChange={(event) =>
                                                    setLines((current) =>
                                                        current.map((row) =>
                                                            row.key === line.key ? { ...row, credit: event.target.value, debit: '' } : row,
                                                        ),
                                                    )
                                                }
                                                className="erp-numeric h-8 w-28 rounded border border-hairline-strong bg-surface px-xs text-body-sm text-ink"
                                                dir="ltr"
                                            />
                                        </td>
                                        <td className="px-sm py-xxs">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="secondary"
                                                className="text-danger-text"
                                                disabled={lines.length <= 2}
                                                onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                                            >
                                                {CFO_WRITE_TEXT.removeLine}
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-surface-sunken text-body-sm">
                                <tr>
                                    <th scope="row" className="px-sm py-xs text-start">
                                        {CFO_WRITE_TEXT.total}
                                    </th>
                                    <td className="erp-numeric px-sm py-xs" dir="ltr">
                                        {money(totals.debit)}
                                    </td>
                                    <td className="erp-numeric px-sm py-xs" dir="ltr">
                                        {money(totals.credit)}
                                    </td>
                                    <td className={`px-sm py-xs ${totals.balanced ? 'text-success-text' : 'text-danger-text'}`}>
                                        {totals.balanced ? CFO_WRITE_TEXT.balanced : CFO_WRITE_TEXT.unbalanced}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <div className="flex flex-col gap-sm sm:hidden" data-testid="entry-lines-mobile">
                        {lines.map((line) => (
                            <div key={line.key} className="flex flex-col gap-xs rounded-md border border-hairline p-sm">
                                <label className="text-label-md text-ink-secondary" htmlFor={`cfo-mobile-account-${String(line.key)}`}>
                                    {CFO_WRITE_TEXT.account}
                                </label>
                                <select
                                    id={`cfo-mobile-account-${String(line.key)}`}
                                    value={line.accountCode}
                                    onChange={(event) =>
                                        setLines((current) =>
                                            current.map((row) =>
                                                row.key === line.key ? { ...row, accountCode: event.target.value } : row,
                                            ),
                                        )
                                    }
                                    className="h-9 w-full rounded border border-hairline-strong bg-surface px-xs text-body-sm text-ink"
                                >
                                    <option value="">— اختر حسابًا —</option>
                                    {accounts.map((account) => (
                                        <option key={account.code} value={account.code}>
                                            {account.code} — {account.name_ar || account.name_en || ''}
                                        </option>
                                    ))}
                                </select>
                                <div className="grid grid-cols-2 gap-sm">
                                    <Input
                                        label={CFO_WRITE_TEXT.debit}
                                        inputMode="decimal"
                                        value={line.debit}
                                        onChange={(event) =>
                                            setLines((current) =>
                                                current.map((row) =>
                                                    row.key === line.key ? { ...row, debit: event.target.value, credit: '' } : row,
                                                ),
                                            )
                                        }
                                        className="erp-numeric"
                                        dir="ltr"
                                    />
                                    <Input
                                        label={CFO_WRITE_TEXT.credit}
                                        inputMode="decimal"
                                        value={line.credit}
                                        onChange={(event) =>
                                            setLines((current) =>
                                                current.map((row) =>
                                                    row.key === line.key ? { ...row, credit: event.target.value, debit: '' } : row,
                                                ),
                                            )
                                        }
                                        className="erp-numeric"
                                        dir="ltr"
                                    />
                                </div>
                                <div className="flex justify-end">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        className="text-danger-text"
                                        disabled={lines.length <= 2}
                                        onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                                    >
                                        {CFO_WRITE_TEXT.removeLine}
                                    </Button>
                                </div>
                            </div>
                        ))}
                        <div className="flex flex-wrap items-center justify-between gap-xs rounded-md bg-surface-sunken p-sm text-body-sm">
                            <span className="text-muted">{CFO_WRITE_TEXT.total}</span>
                            <span className="erp-numeric text-ink" dir="ltr">
                                {money(totals.debit)} / {money(totals.credit)}
                            </span>
                            <span className={totals.balanced ? 'text-success-text' : 'text-danger-text'}>
                                {totals.balanced ? CFO_WRITE_TEXT.balanced : CFO_WRITE_TEXT.unbalanced}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-sm">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setLines((current) => [...current, newLine()])}>
                            {CFO_WRITE_TEXT.addLine}
                        </Button>
                        {error ? (
                            <p role="alert" className="text-body-sm text-danger-text">
                                {error}
                            </p>
                        ) : null}
                    </div>
                </div>
            </Dialog>

            <Dialog
                open={draftsOpen}
                onOpenChange={setDraftsOpen}
                title={CFO_WRITE_TEXT.draftsTitle}
                description={CFO_WRITE_TEXT.draftsHint}
                size="lg"
                footer={
                    <Button type="button" variant="secondary" size="sm" onClick={() => setDraftsOpen(false)}>
                        {CFO_WRITE_TEXT.close}
                    </Button>
                }
            >
                <div className="flex flex-col gap-sm">
                    {draftsQuery.isPending ? (
                        <p className="text-body-sm text-muted" role="status">
                            جارٍ التحميل…
                        </p>
                    ) : null}
                    {draftsQuery.isError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {writeErrorMessage(draftsQuery.error, CFO_WRITE_TEXT.loadFailed)}
                        </p>
                    ) : null}
                    {draftsQuery.data && draftsQuery.data.length === 0 ? (
                        <p className="text-body-sm text-muted">{CFO_WRITE_TEXT.noDrafts}</p>
                    ) : null}
                    {draftsQuery.data?.map((draft) => {
                        const label = draft.entry_no || `#${draft.id}`;
                        return (
                            <div
                                key={draft.id}
                                className="flex flex-wrap items-center justify-between gap-sm border-b border-hairline pb-xs last:border-0"
                            >
                                <div className="text-body-sm">
                                    <p className="text-ink">
                                        <span className="erp-numeric" dir="ltr">
                                            {label}
                                        </span>
                                        {' · '}
                                        <span className="erp-numeric" dir="ltr">
                                            {String(draft.date ?? '').slice(0, 10)}
                                        </span>
                                    </p>
                                    <p className="text-muted">{draft.memo || '—'}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-xxs">
                                    <Button
                                        type="button"
                                        size="sm"
                                        disabled={approveMutation.isPending}
                                        onClick={() => approveMutation.mutate(draft.id)}
                                    >
                                        {CFO_WRITE_TEXT.approve}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="danger"
                                        disabled={voidMutation.isPending}
                                        onClick={() => void handleVoid(draft.id, label)}
                                    >
                                        {CFO_WRITE_TEXT.void}
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                    {draftsQuery.data?.length ? (
                        <Input
                            label="سبب الإلغاء (اختياري)"
                            value={voidReason}
                            maxLength={500}
                            onChange={(event) => setVoidReason(event.target.value)}
                        />
                    ) : null}
                </div>
            </Dialog>

            <Dialog
                open={periodsOpen}
                onOpenChange={setPeriodsOpen}
                title={CFO_WRITE_TEXT.periodsTitle}
                description={CFO_WRITE_TEXT.periodsHint}
                size="md"
                footer={
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPeriodsOpen(false)}>
                        {CFO_WRITE_TEXT.close}
                    </Button>
                }
            >
                <div className="flex flex-col gap-xxs">
                    {periodRows.length === 0 ? <p className="text-body-sm text-muted">لا فترات معروضة.</p> : null}
                    {periodRows.slice(0, 24).map((row) => (
                        <div
                            key={row.period}
                            className="flex flex-wrap items-center justify-between gap-sm border-b border-hairline py-xxs last:border-0"
                        >
                            <span className="erp-numeric text-body-sm text-ink" dir="ltr">
                                {row.period}
                            </span>
                            <span className="flex items-center gap-xs">
                                <span className={row.closed ? 'text-success-text' : 'text-muted'}>{row.closed ? 'مقفلة' : 'مفتوحة'}</span>
                                {row.closed ? (
                                    reopener ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            disabled={periodMutation.isPending}
                                            onClick={() => void closeOrOpen(row.period, 'open')}
                                        >
                                            {CFO_WRITE_TEXT.openPeriod}
                                        </Button>
                                    ) : null
                                ) : (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        disabled={periodMutation.isPending}
                                        onClick={() => void closeOrOpen(row.period, 'close')}
                                    >
                                        {CFO_WRITE_TEXT.closePeriod}
                                    </Button>
                                )}
                            </span>
                        </div>
                    ))}
                </div>
            </Dialog>
        </>
    );
}
