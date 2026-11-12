import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import {
    buildPnlLines,
    fetchLedgerIncomeStatement,
    fetchPnl,
    type LedgerIncomeStatement,
} from '../lib/pnl';
import { roleIn } from './pos/pos-ui';
import {
    errorMessage,
    intOf,
    moneyOf,
    pctOf,
    presetRange,
    rangeProblem,
    textOf,
} from '../lib/reporting';
import { PrintActions } from '../components/PrintActions';

/**
 * الأرباح والخسائر — بيان الخادم كما هو (`/api/finance/pnl`).
 * لا جمع ولا هامش في الواجهة: كل رقم يصل محسوبًا من ستة جداول وفترتين.
 */
export function Pnl() {
    const auth = useAuthState();
    const [draft, setDraft] = useState(() => presetRange('month'));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');

    const pnlQuery = useQuery({
        queryKey: ['finance', 'pnl', range.from, range.to],
        queryFn: ({ signal }) => fetchPnl(range.from, range.to, signal),
    });
    const canReadLedger = roleIn(auth.user?.role, ['admin', 'accountant', 'manager', 'auditor']);
    const ledgerQuery = useQuery({
        queryKey: ['accounting', 'income-statement', range.from, range.to],
        queryFn: ({ signal }) => fetchLedgerIncomeStatement(range.from, range.to, signal),
        enabled: canReadLedger,
    });

    const payload = pnlQuery.data;
    const statement = payload?.statement ?? {};
    const lines = buildPnlLines(statement);
    // الخادم يعلّم الصفوف التي رُحّلت إلى أبيها بـ`rolledUp`؛ عرضها بجانبه يضاعف الرقم.
    const departments = (statement.by_department ?? []).filter((dept) => dept.rolledUp !== true);
    const daily = (statement.daily_series ?? []).slice(-10);
    const ledgerGroups: { title: string; accounts: LedgerIncomeStatement['revenues']['items'] }[] =
        ledgerQuery.data
            ? [
                  { title: 'الإيرادات', accounts: ledgerQuery.data.revenues.items },
                  { title: 'تكلفة البضاعة', accounts: ledgerQuery.data.cost_of_goods_sold.items },
                  { title: 'المصروفات التشغيلية', accounts: ledgerQuery.data.operating_expenses.items },
              ]
            : [];

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 366);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-lg">
            <ReportHeader
                title="الأرباح والخسائر"
                english="Profit & Loss"
                description="قائمة الدخل من دفتر الحركات المسجَّلة: الإيراد والتكلفة والتشغيل والرواتب وصافي الربح."
                pending={pnlQuery.isFetching || ledgerQuery.isFetching}
                onRefresh={() => {
                    void pnlQuery.refetch();
                    if (canReadLedger) void ledgerQuery.refetch();
                }}
            />
            <PrintActions title="الأرباح والخسائر" />

            <SectionCard title="الفترة" english="Period">
                <div className="p-sm">
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
                        pending={pnlQuery.isFetching}
                    />
                    {problem ? (
                        <p role="alert" className="mt-xs text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {pnlQuery.isPending ? <StateLoading label="جارٍ بناء قائمة الأرباح والخسائر…" /> : null}

            {pnlQuery.isError ? (
                <StateError
                    message={errorMessage(pnlQuery.error)}
                    onRetry={() => {
                        void pnlQuery.refetch();
                    }}
                />
            ) : null}

            {payload ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات قائمة الدخل">
                        {lines
                            .filter((line) => ['revenue', 'gross', 'operating', 'net'].includes(line.id))
                            .map((line) => (
                                <KpiCard
                                    key={line.id}
                                    label={line.label}
                                    english={line.english}
                                    value={moneyOf(line.value)}
                                    hint={line.hint}
                                    tone={line.tone}
                                />
                            ))}
                    </ul>

                    <SectionCard
                        title="البيان"
                        english="Statement"
                        actions={
                            <span className="text-body-sm text-muted" dir="ltr">
                                {`${textOf(payload.period?.from).slice(0, 10)} → ${textOf(payload.period?.to).slice(0, 10)}`}
                            </span>
                        }
                    >
                        <TableScroll label="جدول سطور قائمة الدخل">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            البند
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            القيمة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            التفصيل
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lines.map((line) => (
                                        <tr key={line.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs text-ink">{line.label}</td>
                                            <td
                                                className={`erp-numeric px-sm py-xxs ${
                                                    line.tone === 'danger' ? 'text-danger-text' : 'text-ink'
                                                }`}
                                                dir="ltr"
                                            >
                                                {moneyOf(line.value)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{line.hint}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                        <p className="border-t border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                            {`هامش صافي الربح: ${pctOf(statement.net_profit?.margin_pct)} · تحقق التوازن: ${
                                statement.checks?.balanced === true ? 'متوازن' : 'غير مؤكد'
                            }`}
                        </p>
                    </SectionCard>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="حسب القسم" english="By department">
                            {departments.length === 0 ? (
                                <StateEmpty title="لا أقسام في البيان" hint="لا حركة مسجلة لهذه الفترة." />
                            ) : (
                                <TableScroll label="جدول قائمة الدخل حسب القسم">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    القسم
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الإيراد
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الصافي
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الهامش
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {departments.map((dept) => (
                                                <tr
                                                    key={textOf(dept.code) || textOf(dept.name)}
                                                    className="border-b border-hairline"
                                                >
                                                    <td className="px-sm py-xxs text-ink">
                                                        {textOf(dept.name) || textOf(dept.code) || '—'}
                                                        {(dept.subDepartments?.length ?? 0) > 0 ? (
                                                            <span className="text-caption text-muted"> · مع فروعه</span>
                                                        ) : null}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(dept.revenue)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(dept.net)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                        {pctOf(dept.margin_pct)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>

                        <SectionCard title="الحركة اليومية" english="Daily series">
                            {daily.length === 0 ? (
                                <StateEmpty title="لا حركة يومية" hint="اختر فترة أوسع أو راجع ترحيل القيود." />
                            ) : (
                                <TableScroll label="جدول الحركة اليومية">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    اليوم
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الإيراد
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    التكلفة
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    التشغيل
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {daily.map((day) => (
                                                <tr key={textOf(day.date)} className="border-b border-hairline">
                                                    <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                        {textOf(day.date).slice(0, 10)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(day.revenue)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(day.cogs)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(day.opex)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>
                    </div>

                    <p className="text-caption text-muted" role="status">
                        {`الأقسام: ${intOf(departments.length)} · أيام السلسلة: ${intOf(daily.length)}`}
                    </p>
                </>
            ) : null}

            {pnlQuery.isPending ? (
                <SectionCard title="البيان" english="Statement">
                    <TableSkeleton rows={6} columns={3} />
                </SectionCard>
            ) : null}

            {canReadLedger ? (
                <SectionCard title="قائمة الدخل من الأستاذ العام" english="Posted-ledger P&L">
                    {ledgerQuery.isPending ? (
                        <StateLoading label="جارٍ تحميل قائمة الأستاذ العام…" />
                    ) : ledgerQuery.isError ? (
                        <StateError
                            message={errorMessage(ledgerQuery.error)}
                            onRetry={() => {
                                void ledgerQuery.refetch();
                            }}
                        />
                    ) : ledgerQuery.data ? (
                        <>
                            <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                                {`قيود مرحّلة ${intOf(ledgerQuery.data.integrity?.posted_entries)} · قيود غير متوازنة ${intOf(
                                    ledgerQuery.data.integrity?.unbalanced_posted_entries,
                                )} · `}
                                <span
                                    className={
                                        !ledgerQuery.data.integrity
                                            ? 'text-warning-text'
                                            : ledgerQuery.data.integrity.balanced
                                              ? 'text-success-text'
                                              : 'text-danger-text'
                                    }
                                >
                                    {!ledgerQuery.data.integrity
                                        ? 'تعذر التحقق من توازن القيود'
                                        : ledgerQuery.data.integrity.balanced
                                          ? 'القيود المرحّلة متوازنة'
                                          : 'تحذير: توجد قيود مرحّلة غير متوازنة'}
                                </span>
                            </p>
                            <ul className="grid list-none gap-sm p-sm sm:grid-cols-2 xl:grid-cols-4">
                                <KpiCard
                                    label="الإيرادات"
                                    english="Revenue"
                                    value={moneyOf(ledgerQuery.data.revenues.total)}
                                    hint="من القيود المرحلة"
                                />
                                <KpiCard
                                    label="تكلفة البضاعة"
                                    english="Cost of goods sold"
                                    value={moneyOf(ledgerQuery.data.cost_of_goods_sold.total)}
                                    hint="من القيود المرحلة"
                                    tone="warning"
                                />
                                <KpiCard
                                    label="إجمالي الربح"
                                    english="Gross profit"
                                    value={moneyOf(ledgerQuery.data.gross_profit.amount)}
                                    hint={`${Number(ledgerQuery.data.gross_profit.margin_pct).toFixed(1)}% هامش إجمالي`}
                                />
                                <KpiCard
                                    label="صافي الربح"
                                    english="Net profit"
                                    value={moneyOf(ledgerQuery.data.net_profit.amount)}
                                    hint={`${Number(ledgerQuery.data.net_profit.margin_pct).toFixed(1)}% هامش صافي`}
                                    tone={Number(ledgerQuery.data.net_profit.amount) < 0 ? 'danger' : 'success'}
                                />
                            </ul>
                            <div className="grid gap-md p-sm lg:grid-cols-3">
                                {ledgerGroups.map((group) => (
                                    <section key={group.title} className="rounded-lg border border-hairline">
                                        <h3 className="border-b border-hairline px-sm py-xs text-label-md text-ink">
                                            {group.title}
                                        </h3>
                                        <ul className="m-0 list-none p-sm">
                                            {group.accounts.map((account) => (
                                                <li
                                                    key={account.code}
                                                    className="flex justify-between gap-sm border-b border-hairline py-xxs text-body-sm"
                                                >
                                                    <span className="text-ink">
                                                        {account.name_ar || account.name_en || account.code}
                                                    </span>
                                                    <span className="erp-numeric text-ink" dir="ltr">
                                                        {moneyOf(account.balance)}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                ))}
                            </div>
                        </>
                    ) : (
                        <StateEmpty title="لا توجد بيانات دفتر أستاذ" hint="تحقق من الفترة ثم أعد المحاولة." />
                    )}
                </SectionCard>
            ) : null}
        </div>
    );
}
