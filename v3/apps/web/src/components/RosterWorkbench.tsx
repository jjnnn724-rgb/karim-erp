import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuthState } from '../lib/auth';
import { formatInt } from '../lib/inventory-register';
import type { RosterApproval, RosterDay, RosterRow } from '../lib/roster';
import {
    approveRosterApproval,
    canApproveRoster,
    canWriteRoster,
    fetchPendingRosterApprovals,
    ROSTER_WRITE_TEXT,
    type RosterCellEdit,
    requestRosterApproval,
    saveRosterWeek,
    validateRosterSave,
} from '../lib/roster-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useConfirm } from './ConfirmProvider';

/**
 * واجهة كتابة الدوام: تحرير خلايا الأسبوع (المستقبل فقط كما يفرض الخادم)،
 * حفظ الشبكة، وطلب/اعتماد الطباعة. الخادم هو من يقرّر `editable` و`today`،
 * فالشاشة لا تخمّن تاريخًا ولا تفتح ماضيًا.
 */

const DAY_OFF_LABELS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

interface EditRow {
    key: string;
    id: string;
    date: string;
    name: string;
    shiftStart: string;
    shiftHours: string;
    dayOff: string;
}

function keyOf(id: string, date: string): string {
    return `${id}:${date}`;
}

function initialRows(rows: readonly RosterRow[], days: readonly RosterDay[]): Record<string, EditRow> {
    const map: Record<string, EditRow> = {};
    for (const row of rows) {
        days.forEach((day, index) => {
            const cell = row.cells[index];
            if (!cell?.editable || cell.onLeave) {
                return;
            }
            const key = keyOf(row.id, day.date);
            map[key] = {
                key,
                id: row.id,
                date: day.date,
                name: row.name,
                shiftStart: cell.shiftStart === '—' ? '' : cell.shiftStart,
                shiftHours: cell.shiftHours === null ? '10' : String(cell.shiftHours),
                dayOff: cell.dayOff === null ? '' : String(cell.dayOff),
            };
        });
    }
    return map;
}

function sameRow(a: EditRow, b: EditRow): boolean {
    return a.shiftStart === b.shiftStart && a.shiftHours === b.shiftHours && a.dayOff === b.dayOff;
}

interface RosterWorkbenchProps {
    weekStart: string;
    today: string;
    days: readonly RosterDay[];
    rows: readonly RosterRow[];
    dept: string;
    approvalKey: string;
    approval: RosterApproval;
}

export function RosterWorkbench({ weekStart, today, days, rows, dept, approvalKey, approval }: RosterWorkbenchProps) {
    const auth = useAuthState();
    const writable = canWriteRoster(auth.user?.role);
    const approver = canApproveRoster(auth.user?.role);
    const confirm = useConfirm();

    const [open, setOpen] = useState(false);
    const [edits, setEdits] = useState<Record<string, EditRow>>({});
    const [error, setError] = useState('');

    const initial = useMemo(() => initialRows(rows, days), [rows, days]);

    const changed = useMemo(() => {
        const list: RosterCellEdit[] = [];
        for (const row of Object.values(edits)) {
            const before = initial[row.key];
            if (!before || !sameRow(before, row)) {
                list.push({
                    id: row.id,
                    date: row.date,
                    shiftStart: row.shiftStart,
                    shiftHours: row.shiftHours,
                    dayOff: row.dayOff,
                });
            }
        }
        return list;
    }, [edits, initial]);

    const pendingQuery = useQuery({
        queryKey: ['roster-pending-approvals', weekStart],
        queryFn: ({ signal }) => fetchPendingRosterApprovals(weekStart, signal),
        enabled: open && approver,
    });

    const saveMutation = useWriteMutation<void, void>({
        mutationFn: async () => {
            const validation = validateRosterSave(changed, weekStart, today);
            if (!validation.ok) {
                throw new Error(validation.error);
            }
            await saveRosterWeek(weekStart, validation.cells, dept);
        },
        successTitle: ROSTER_WRITE_TEXT.saved(changed.length),
        invalidate: [['roster-week'], ['roster-pending-approvals', weekStart]],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, ROSTER_WRITE_TEXT.saveFailed)),
        onSuccess: () => {
            setOpen(false);
            setEdits({});
            setError('');
        },
    });

    const requestMutation = useWriteMutation<void, void>({
        mutationFn: () => requestRosterApproval(weekStart, dept),
        successTitle: ROSTER_WRITE_TEXT.requested,
        invalidate: [['roster-week'], ['roster-pending-approvals', weekStart]],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, ROSTER_WRITE_TEXT.requestFailed)),
    });

    const approveMutation = useWriteMutation<void, void>({
        mutationFn: () => approveRosterApproval(weekStart, approvalKey),
        successTitle: ROSTER_WRITE_TEXT.approved,
        invalidate: [['roster-week'], ['roster-pending-approvals', weekStart]],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, ROSTER_WRITE_TEXT.approveFailed)),
    });

    function openEditor(): void {
        setEdits(initialRows(rows, days));
        setError('');
        setOpen(true);
    }

    function update(key: string, patch: Partial<Pick<EditRow, 'shiftStart' | 'shiftHours' | 'dayOff'>>): void {
        setEdits((previous) => {
            const current = previous[key];
            if (!current) {
                return previous;
            }
            return { ...previous, [key]: { ...current, ...patch } };
        });
    }

    async function handleRequest(): Promise<void> {
        const answer = await confirm('إرسال دوامات هذا الأسبوع لاعتماد شؤون العاملين؟ أي تعديل بعد الطلب يلغي الاعتماد.');
        if (!answer) {
            return;
        }
        setError('');
        requestMutation.mutate();
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                {writable ? (
                    <Button type="button" size="sm" onClick={openEditor}>
                        {ROSTER_WRITE_TEXT.save}
                    </Button>
                ) : null}
                {writable ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={requestMutation.isPending || !weekStart}
                        onClick={() => void handleRequest()}
                    >
                        {ROSTER_WRITE_TEXT.request}
                    </Button>
                ) : null}
                {approver && approval.key === 'pending' ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={approveMutation.isPending}
                        onClick={() => {
                            setError('');
                            approveMutation.mutate();
                        }}
                    >
                        {ROSTER_WRITE_TEXT.approve}
                    </Button>
                ) : null}
            </div>

            {error ? (
                <p role="alert" className="text-body-sm text-danger-text" data-erp-print-hide>
                    {error}
                </p>
            ) : null}

            <Dialog
                open={open}
                onOpenChange={(next) => {
                    if (!next && saveMutation.isPending) {
                        return;
                    }
                    setOpen(next);
                }}
                title="تحرير شبكة الأسبوع"
                description={`${ROSTER_WRITE_TEXT.saveHint}${dept ? ` — القسم: ${dept}` : ''}`}
                size="lg"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
                            {ROSTER_WRITE_TEXT.close}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={saveMutation.isPending || changed.length === 0}
                            onClick={() => {
                                setError('');
                                saveMutation.mutate();
                            }}
                        >
                            {saveMutation.isPending ? 'جارٍ الحفظ…' : ROSTER_WRITE_TEXT.save}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <p className="text-body-sm text-muted" role="status">
                        {changed.length ? ROSTER_WRITE_TEXT.dirty(changed.length) : 'عدّل وقت الدوام أو ساعاته أو يوم الراحة ثم احفظ.'}
                    </p>
                    {Object.keys(edits).length === 0 ? (
                        <p className="text-body-sm text-warning-text">
                            لا خلايا قابلة للتحرير في هذا النطاق — الخادم يقفل الماضي وأيام الإجازة.
                        </p>
                    ) : (
                        <div className="max-h-[60vh] overflow-auto rounded-md border border-hairline">
                            <table className="w-full border-collapse text-body-sm">
                                <caption className="sr-only">خلايا الدوام القابلة للتحرير</caption>
                                <thead className="sticky top-0 bg-surface-sunken text-label-md text-ink-secondary">
                                    <tr>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الموظف
                                        </th>
                                        {days.map((day) => (
                                            <th key={day.date} scope="col" className="px-sm py-xs text-center font-medium">
                                                {day.label}
                                                <small className="erp-numeric block text-caption" dir="ltr">
                                                    {day.date}
                                                </small>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => {
                                        const cells = days.map((day) => edits[keyOf(row.id, day.date)]);
                                        if (cells.every((cell) => cell === undefined)) {
                                            return null;
                                        }
                                        return (
                                            <tr key={row.id} className="border-b border-hairline">
                                                <td className="px-sm py-xxs text-ink">
                                                    {row.name}
                                                    <small className="block text-caption text-muted" dir="ltr">
                                                        {row.employeeId}
                                                    </small>
                                                </td>
                                                {days.map((day, index) => {
                                                    const cell = cells[index];
                                                    if (!cell) {
                                                        return (
                                                            <td key={day.date} className="px-sm py-xxs text-center text-caption text-faint">
                                                                مقفل
                                                            </td>
                                                        );
                                                    }
                                                    return (
                                                        <td key={day.date} className="px-sm py-xxs">
                                                            <div className="flex min-w-28 flex-col gap-xxs">
                                                                <input
                                                                    type="time"
                                                                    aria-label={`دخول ${row.name} ${day.date}`}
                                                                    value={cell.shiftStart}
                                                                    onChange={(event) =>
                                                                        update(cell.key, {
                                                                            shiftStart: event.target.value,
                                                                        })
                                                                    }
                                                                    className="h-8 w-full rounded border border-hairline-strong bg-surface px-xs text-body-sm text-ink"
                                                                />
                                                                <input
                                                                    type="number"
                                                                    min={1}
                                                                    max={24}
                                                                    aria-label={`ساعات ${row.name} ${day.date}`}
                                                                    value={cell.shiftHours}
                                                                    onChange={(event) =>
                                                                        update(cell.key, {
                                                                            shiftHours: event.target.value,
                                                                        })
                                                                    }
                                                                    className="erp-numeric h-8 w-full rounded border border-hairline-strong bg-surface px-xs text-body-sm text-ink"
                                                                />
                                                                <select
                                                                    aria-label={`راحة ${row.name} ${day.date}`}
                                                                    value={cell.dayOff}
                                                                    onChange={(event) =>
                                                                        update(cell.key, {
                                                                            dayOff: event.target.value,
                                                                        })
                                                                    }
                                                                    className="h-8 w-full rounded border border-hairline-strong bg-surface px-xs text-body-sm text-ink"
                                                                >
                                                                    <option value="">لا راحة</option>
                                                                    {DAY_OFF_LABELS.map((label, value) => (
                                                                        <option key={label} value={String(value)}>
                                                                            {label}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {error ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {error}
                        </p>
                    ) : null}
                </div>
            </Dialog>

            {approver && pendingQuery.data && pendingQuery.data.pending.length > 0 ? (
                <section
                    aria-label={ROSTER_WRITE_TEXT.pendingTitle}
                    className="rounded-lg border border-hairline bg-surface p-sm"
                    data-erp-print-hide
                >
                    <h2 className="text-heading-sm text-ink">{ROSTER_WRITE_TEXT.pendingTitle}</h2>
                    <ul className="mt-xs flex flex-col gap-xxs text-body-sm">
                        {pendingQuery.data.pending.map((row) => (
                            <li key={`${row.dept_key}:${row.week_start}`} className="flex flex-wrap items-center gap-sm">
                                <span className="text-ink">{row.dept_key}</span>
                                <span className="erp-numeric text-muted" dir="ltr">
                                    {row.week_start}
                                </span>
                                <span className="text-muted">{row.requested_name || '—'}</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={approveMutation.isPending}
                                    onClick={() => {
                                        void approveRosterApproval(row.week_start, row.dept_key)
                                            .then(() => {
                                                void pendingQuery.refetch();
                                            })
                                            .catch((cause: unknown) => {
                                                setError(writeErrorMessage(cause, ROSTER_WRITE_TEXT.approveFailed));
                                            });
                                    }}
                                >
                                    {ROSTER_WRITE_TEXT.approve}
                                </Button>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-xxs text-caption text-muted">{formatInt(pendingQuery.data.pending.length)} طلبًا لهذا الأسبوع.</p>
                </section>
            ) : null}
        </>
    );
}
