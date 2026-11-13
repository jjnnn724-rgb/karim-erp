import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { StateError, StateLoading } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchBankRec, matchBankRec } from '../lib/bank-rec';
import { errorMessage, moneyOf, num, presetRange, rangeProblem } from '../lib/reporting';
import { isWriteRole, useWriteMutation } from '../lib/write';
import { Button } from '../ui/Button';

/**
 * مطابقة البنك — سطح V3 على `GET /api/accounting/bank-rec` و
 * `POST /api/accounting/bank-rec/auto-match`.
 *
 * يعرض رصيد الدفتر وكشف البنك والفرق والحركات غير المطابقة في الفترة،
 * والمطابقة الآلية (admin/accountant) تربط قيدًا مطابقًا للمبلغ على نفس
 * الحساب بتاريخ ±3 أيام. لا تُنشئ قيودًا جديدة ولا تُرحّل أي حركة.
 */

const MATCH_WRITE_ROLES = ['admin', 'accountant'] as const;

export function BankReconciliation() {
    const [draft, setDraft] = useState(() => {
        const preset = presetRange('month');
        return { from: preset.from, to: preset.to };
    });
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');
    const auth = useAuthState();
    const canMatch = isWriteRole(auth.user?.role, MATCH_WRITE_ROLES);

    const query = useQuery({
        queryKey: ['bank-rec', range.from, range.to],
        queryFn: ({ signal }) => fetchBankRec(range.from, range.to, '', signal),
        retry: false,
    });

    const matchMutation = useWriteMutation<string, Awaited<ReturnType<typeof matchBankRec>>>({
        mutationFn: () => matchBankRec(),
        successTitle: 'تمت المطابقة الآلية',
        successDescription: 'أُنجزت المطابقة — اختفت الحركات المطابقة من القائمة وتُحدّث الشاشة تلقائيًا.',
        invalidate: [['bank-rec'], ['command-center']],
    });

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 366);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    const data = query.data;
    const diff = num(data?.diff);
    const unmatched = data?.unmatched ?? [];
    const difference = Math.abs(diff);
    const hasDifference = difference > 0.01;

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-lg">
            <ReportHeader
                title="مطابقة البنك"
                english="Bank reconciliation"
                description="كشف البنك مقابل الدفتر المرحّل: المطابقات الآلية والحركات غير المطابقة في الفترة."
                pending={query.isFetching}
                onRefresh={() => {
                    void query.refetch();
                }}
            />

            <SectionCard title="فترة المطابقة" english="Period">
                <div className="flex flex-col gap-sm p-sm">
                    <RangeControls
                        from={draft.from}
                        to={draft.to}
                        onFrom={(value) => {
                            setDraft((current) => ({ ...current, from: value }));
                        }}
                        onTo={(value) => {
                            setDraft((current) => ({ ...current, to: value }));
                        }}
                        onApply={apply}
                        pending={query.isFetching}
                    />
                    {problem ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {query.isPending ? <StateLoading label="جارٍ تجميع كشف المطابقة من الدفتر والبنك…" /> : null}
            {query.isError ? (
                <StateError
                    message={errorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                />
            ) : null}

            {data ? (
                <>
                    <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                        <KpiCard
                            label="رصيد الدفتر في الفترة"
                            english="Book movement"
                            value={moneyOf(data.book)}
                            hint="مدين − دائن على حساب البنك في القيود المرحّلة"
                        />
                        <KpiCard
                            label="مجموع كشف البنك"
                            english="Statement movement"
                            value={moneyOf(data.statement)}
                            hint="من الكشف المستورد للبنك"
                        />
                        <KpiCard
                            label="الفرق (كشف − دفتر)"
                            english="Difference"
                            value={moneyOf(diff)}
                            hint="صفر = مطابقة كاملة"
                            tone={hasDifference ? 'warning' : 'neutral'}
                        />
                        <KpiCard
                            label="حركات غير مطابقة"
                            english="Unmatched"
                            value={String(unmatched.length)}
                            hint="كشوف بلا قيد مرحّل مطابق"
                            tone={unmatched.length ? 'warning' : 'neutral'}
                        />
                    </div>

                    {hasDifference ? (
                        <aside role="alert" className="rounded-lg border border-warning bg-surface p-sm text-body-sm text-warning-text">
                            الفرق بين كشف البنك والدفتر لا يساوي صفرًا — راجع الحركات غير المطابقة أدناه أو القيود المرحّلة خارج الفترة قبل
                            الاعتماد.
                        </aside>
                    ) : (
                        <aside className="rounded-lg border border-success bg-surface p-sm text-body-sm text-success-text">
                            كشف البنك يطابق الدفتر في هذه الفترة.
                        </aside>
                    )}

                    <SectionCard
                        title="الحركات غير المطابقة"
                        english="Unmatched statements"
                        actions={
                            canMatch ? (
                                <Button
                                    variant="primary"
                                    loading={matchMutation.isPending}
                                    onClick={() => {
                                        matchMutation.mutate('auto-match');
                                    }}
                                >
                                    مطابقة تلقائية
                                </Button>
                            ) : null
                        }
                    >
                        {unmatched.length ? (
                            <div className="overflow-x-auto p-sm">
                                <table className="w-full border-collapse">
                                    <caption className="sr-only">حركات كشف البنك غير المطابقة في الفترة</caption>
                                    <thead>
                                        <tr>
                                            {['التاريخ', 'الوصف', 'المبلغ', 'الحساب'].map((label, index) => (
                                                <th
                                                    key={label}
                                                    scope="col"
                                                    className={`border-b border-hairline bg-surface-sunken px-sm py-xs text-label-md font-medium text-ink-secondary ${
                                                        index === 2 ? 'text-end' : 'text-start'
                                                    }`}
                                                >
                                                    {label}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {unmatched.map((statement) => (
                                            <tr key={statement.id}>
                                                <td dir="ltr" className="border-b border-hairline px-sm py-xxs text-ink erp-numeric">
                                                    {statement.stmt_date}
                                                </td>
                                                <td className="border-b border-hairline px-sm py-xxs text-ink">
                                                    {statement.description || '—'}
                                                </td>
                                                <td
                                                    dir="ltr"
                                                    className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric"
                                                >
                                                    {moneyOf(statement.amount)}
                                                </td>
                                                <td dir="ltr" className="border-b border-hairline px-sm py-xxs text-ink erp-numeric">
                                                    {statement.account_code}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="p-sm text-body-sm text-muted">لا حركات غير مطابقة في هذه الفترة.</p>
                        )}
                    </SectionCard>

                    <p className="rounded-lg border border-hairline bg-surface p-sm text-body-sm text-muted">
                        المطابقة الآلية تربط القيد ذي المبلغ نفسه على نفس الحساب بتاريخ ±3 أيام، وتُطالب به ذرّيًّا كي لا يربط تشغيلان نفس القيد
                        بكشفيين. لا تُنشئ قيودًا جديدة ولا تُرحّل أي حركة.
                    </p>
                </>
            ) : null}
        </div>
    );
}
