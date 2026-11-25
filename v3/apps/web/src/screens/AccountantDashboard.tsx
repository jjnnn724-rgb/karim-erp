import './AccountantDashboard.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading } from '../components/TableState';
import { fetchAccountantSnapshot } from '../lib/dashboards';
import { moneyOf, num, pctOf, presetRange, rangeProblem, textOf } from '../lib/reporting';
import { FilterBar, StatCard } from '../ui';

/** لوحة المحاسب — الشهر من بيان الخادم نفسه، لا من مشي على سجلات الإيراد. */
export function AccountantDashboard() {
    const search = useSearch({ from: '/accountant-dashboard' });
    const navigate = useNavigate({ from: '/accountant-dashboard' });
    const initialRange = search.from && search.to ? { from: search.from, to: search.to } : presetRange('month');
    const [draft, setDraft] = useState(initialRange);
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');
    const [q, setQ] = useState(search.q ?? '');

    useEffect(() => {
        const nextRange = search.from && search.to ? { from: search.from, to: search.to } : presetRange('month');
        setDraft(nextRange);
        setRange(nextRange);
        setQ(search.q ?? '');
        setProblem('');
    }, [search.from, search.to, search.q]);

    const snapshot = useQuery({
        queryKey: ['dashboard', 'accountant', range.from, range.to],
        queryFn: ({ signal }) => fetchAccountantSnapshot(signal),
    });

    const data = snapshot.data;

    // فلاتر واجهة أمامية على أحدث الإيرادات والمصروفات (نطاق تاريخ + بحث نصي)
    const filteredRevenues = useMemo(() => {
        return (data?.latestRevenues ?? []).filter((row) => {
            const dateOk =
                range.from && range.to ? textOf(row.date).slice(0, 10) >= range.from && textOf(row.date).slice(0, 10) <= range.to : true;
            const textOk = q ? (textOf(row.source) ?? '').includes(q) : true;
            return dateOk && textOk;
        });
    }, [data, range, q]);

    const filteredExpenses = useMemo(() => {
        return (data?.latestExpenses ?? []).filter((row) => {
            const dateOk =
                range.from && range.to ? textOf(row.date).slice(0, 10) >= range.from && textOf(row.date).slice(0, 10) <= range.to : true;
            const textOk = q ? (textOf(row.desc) ?? textOf(row.category) ?? '').includes(q) : true;
            return dateOk && textOk;
        });
    }, [data, range, q]);

    const statement = data?.pnl?.statement ?? {};
    const revenue = num(statement.revenue?.total);
    const profit = num(statement.net_profit?.amount);
    const margin = statement.net_profit?.margin_pct ?? null;

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 366);
        setProblem(message);
        if (!message) {
            setRange(draft);
            void navigate({
                search: (previous) => ({ ...previous, from: draft.from, to: draft.to }),
                replace: true,
            });
        }
    }

    function resetFilters() {
        const month = presetRange('month');
        setDraft(month);
        setRange(month);
        setQ('');
        setProblem('');
        void navigate({ search: () => ({}), replace: true });
    }

    return (
        <div className="flex flex-col gap-md premium-screen premium-accountantdashboard">
            <ReportHeader
                title="لوحة المحاسب"
                english="Accountant Dashboard"
                description="شهر التشغيل من قائمة الدخل، وأحدث الإيرادات والمصروفات — أرقام الخادم بلا إعادة حساب."
                pending={snapshot.isFetching}
                onRefresh={() => {
                    void snapshot.refetch();
                }}
            />

            <FilterBar
                id="accountant-filter"
                from={draft.from}
                to={draft.to}
                onFrom={(value: string) => setDraft((current) => ({ ...current, from: value }))}
                onTo={(value: string) => setDraft((current) => ({ ...current, to: value }))}
                onApply={apply}
                searchLabel="بحث"
                searchPlaceholder="بحث في الإيرادات والمصروفات…"
                searchValue={q}
                onSearchChange={(next: string) => {
                    setQ(next);
                    void navigate({
                        search: (previous) => {
                            const nextSearch = { ...previous };
                            if (next) {
                                nextSearch.q = next;
                            } else {
                                delete nextSearch.q;
                            }
                            return nextSearch;
                        },
                        replace: true,
                    });
                }}
                onReset={resetFilters}
                pending={snapshot.isFetching}
                error={problem}
                data-testid="accountant-filter-bar"
            />

            {snapshot.isPending ? <StateLoading label="جارٍ جمع لوحة المحاسب…" /> : null}

            {snapshot.isError ? (
                <StateError
                    message={snapshot.error instanceof Error ? snapshot.error.message : 'خطأ غير معروف'}
                    onRetry={() => {
                        void snapshot.refetch();
                    }}
                />
            ) : null}

            {data ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات المحاسب">
                        <StatCard
                            label="إيراد الشهر"
                            english="Month revenue"
                            value={moneyOf(revenue)}
                            hint={`${String(num(statement.revenue?.invoice_count))} فاتورة كاشير`}
                        />
                        <StatCard
                            label="تكلفة البضاعة"
                            english="COGS"
                            value={moneyOf(statement.cogs?.net)}
                            hint="صرف مخزني بعد المرتجعات"
                            tone="warning"
                        />
                        <StatCard
                            label="صافي الربح"
                            english="Net profit"
                            value={moneyOf(profit)}
                            hint={pctOf(margin)}
                            tone={profit < 0 ? 'danger' : 'success'}
                        />
                        <StatCard
                            label="المصروفات التشغيلية"
                            english="Operating"
                            value={moneyOf(statement.operating?.total)}
                            hint={`${String(num(statement.operating?.count))} بندًا`}
                            tone="warning"
                        />
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="أحدث الإيرادات" english="Latest revenues">
                            {data.latestRevenues.length === 0 ? (
                                <StateEmpty title="لا إيرادات حديثة" hint="لم تُسجَّل حركة إيراد بعد." />
                            ) : (
                                <ul className="flex list-none flex-col gap-xxs p-sm">
                                    {filteredRevenues.map((row) => (
                                        <li
                                            key={row.id}
                                            className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-sm"
                                        >
                                            <span className="text-ink">
                                                {textOf(row.source) || 'إيراد'}{' '}
                                                <span className="text-caption text-faint" dir="ltr">
                                                    {textOf(row.date).slice(0, 10)}
                                                </span>
                                            </span>
                                            <span className="erp-numeric text-ink" dir="ltr">
                                                {moneyOf(row.amount)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </SectionCard>

                        <SectionCard title="أحدث المصروفات" english="Latest expenses">
                            {data.latestExpenses.length === 0 ? (
                                <StateEmpty title="لا مصروفات حديثة" hint="لم تُسجَّل حركة مصروف بعد." />
                            ) : (
                                <ul className="flex list-none flex-col gap-xxs p-sm">
                                    {filteredExpenses.map((row) => (
                                        <li
                                            key={row.id}
                                            className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-sm"
                                        >
                                            <span className="text-ink">
                                                {textOf(row.desc) || textOf(row.category) || 'مصروف'}{' '}
                                                <span className="text-caption text-faint" dir="ltr">
                                                    {textOf(row.date).slice(0, 10)}
                                                </span>
                                            </span>
                                            <span className="erp-numeric text-ink" dir="ltr">
                                                {moneyOf(row.amount)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </SectionCard>
                    </div>

                    {data.failures.length > 0 ? (
                        <p className="rounded-md border border-warning bg-surface p-sm text-body-sm text-warning-text" role="alert">
                            {`تعذّر قراءة: ${data.failures.join(' · ')}`}
                        </p>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
