import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { YarasoftWorkbench } from '../components/YarasoftWorkbench';
import { cashierLabel, cashierMatches, fetchCashierRevenues } from '../lib/cashier-revenues';
import { formatMoney } from '../lib/format';
import { presetRange, rangeProblem } from '../lib/reporting';
import { FilterBar, StatCard } from '../ui';

/**
 * شاشة يارسوفت — تبويبان كاملان:
 *
 * 1. **تكامل قاعدة الكاشير** — كل تبويبات V2 الثمانية (`yarasoft.js`) عبر
 *    نفس مسارات `/api/yarasoft/*` ونفس الأدوار (`admin|manager` يكتبان).
 * 2. **الإيرادات المحلية** — تقرير قراءة فقط من جدول `revenues` عندنا عبر
 *    `GET /api/cashier-revenues`؛ لا يعتمد على محرّك المزامنة، فلو أُوقف
 *    الاستيراد أو فُصل YaraSoft تبقى القراءة من قاعدتنا.
 */

type YarasoftTab = 'integration' | 'revenues';

const TABS: readonly { key: YarasoftTab; label: string; hint: string }[] = [
    { key: 'integration', label: 'تكامل قاعدة الكاشير', hint: 'YaraSoft Integration' },
    { key: 'revenues', label: 'الإيرادات المحلية', hint: 'Cashier Revenue' },
];

export function Yarasoft() {
    const [tab, setTab] = useState<YarasoftTab>('integration');

    return (
        <div className="flex flex-col gap-md">
            <div className="flex flex-wrap gap-xs" role="tablist" aria-label="أقسام شاشة يارسوفت">
                {TABS.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.key}
                        data-testid={`yarasoft-tab-${item.key}`}
                        onClick={() => setTab(item.key)}
                        className={`shrink-0 whitespace-nowrap rounded-md border px-sm py-xs text-button-md ${
                            tab === item.key
                                ? 'border-primary bg-primary text-on-primary'
                                : 'border-hairline-strong bg-surface text-ink hover:bg-surface-hover'
                        }`}
                    >
                        {item.label}{' '}
                        <span className="hidden text-caption opacity-75 sm:inline" dir="ltr" lang="en">
                            {item.hint}
                        </span>
                    </button>
                ))}
            </div>

            {tab === 'integration' ? <IntegrationConsole /> : <LocalRevenueReport />}
        </div>
    );
}

function IntegrationConsole() {
    const queryClient = useQueryClient();

    return (
        <div className="flex flex-col gap-sm">
            <ReportHeader
                title="تكامل قاعدة الكاشير"
                english="YaraSoft Integration"
                description="حالة الاستيراد والمراجعة والأقسام والروابط وربط Oracle وجودة البيانات والمرآة — نفس عقود V2."
                pending={false}
                onRefresh={() => {
                    void queryClient.invalidateQueries({ queryKey: ['yarasoft'] });
                }}
            />
            <YarasoftWorkbench />
        </div>
    );
}

function LocalRevenueReport() {
    const [draft, setDraft] = useState(() => presetRange('month'));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');
    const [q, setQ] = useState('');

    const snapshot = useQuery({
        queryKey: ['cashier-revenues', range.from, range.to],
        queryFn: ({ signal }) => fetchCashierRevenues({ from: range.from, to: range.to }, signal),
    });

    const data = snapshot.data;

    const rows = useMemo(() => (data?.cashiers ?? []).filter((row) => cashierMatches(row, q)), [data, q]);

    const days = useMemo(() => data?.byDay ?? [], [data]);

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 366);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    return (
        <div className="flex flex-col gap-md">
            <ReportHeader
                title="إيرادات الكاشير"
                english="Cashier Revenue"
                description="إيرادات الكاشير مقروءة من قاعدة البيانات المحلية — مصدر القراءة هو PostgreSQL عندنا لا مزامنة Yarasoft."
                pending={snapshot.isFetching}
                onRefresh={() => {
                    void snapshot.refetch();
                }}
            />
            <div className="flex justify-end gap-xs" data-erp-print-hide>
                <PrintActions title="إيرادات الكاشير" />
            </div>

            <FilterBar
                id="yarasoft-filter"
                from={draft.from}
                to={draft.to}
                onFrom={(value: string) => setDraft((current) => ({ ...current, from: value }))}
                onTo={(value: string) => setDraft((current) => ({ ...current, to: value }))}
                onApply={apply}
                searchLabel="بحث في الكاشير"
                searchPlaceholder="ابحث باسم الكاشير…"
                searchValue={q}
                onSearchChange={(next: string) => setQ(next)}
                pending={snapshot.isFetching}
                error={problem}
                data-testid="yarasoft-filter-bar"
            />

            {snapshot.isPending ? <StateLoading label="جارٍ قراءة إيرادات الكاشير…" /> : null}

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
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات إيرادات الكاشير">
                        <StatCard
                            label="إجمالي الإيرادات"
                            english="Total"
                            value={formatMoney(data.total)}
                            hint="مجموع الفترة من قاعدة البيانات"
                            tone="success"
                        />
                        <StatCard label="عدد الفواتير" english="Invoices" value={String(data.invoices)} hint="فاتورة متمايزة في الفترة" />
                        <StatCard label="عدد الكاشير" english="Cashiers" value={String(data.cashiers.length)} hint="قسم إيراد فعّال" />
                        <StatCard label="الفترة" english="Period" value={`${data.from} → ${data.to}`} hint="من وإلى" />
                    </ul>

                    <SectionCard title="إيرادات حسب الكاشير" english="By cashier">
                        {rows.length === 0 ? (
                            <StateEmpty title="لا توجد إيرادات في هذه الفترة" hint="غيّر الفترة أو امسح البحث لعرض نتائج أخرى." />
                        ) : (
                            <TableScroll label="جدول إيرادات الكاشير">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الكاشير
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                الفواتير
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                السطور
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                الإيراد
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row) => (
                                            <tr key={row.deptCode} className="border-b border-hairline">
                                                <td className="px-sm py-xxs text-ink">
                                                    {cashierLabel(row)}
                                                    {row.displayEn ? (
                                                        <span className="me-xs text-caption text-faint" lang="en" dir="ltr">
                                                            {row.displayEn}
                                                        </span>
                                                    ) : null}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                                    {String(row.invoices)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                                    {String(row.entries)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                                    {formatMoney(row.total)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>

                    <SectionCard title="ملخّص يومي" english="Daily summary">
                        {days.length === 0 ? (
                            <StateEmpty title="لا توجد أيام في هذه الفترة" hint="اختر فترة أخرى." />
                        ) : (
                            <TableScroll label="جدول الإيراد اليومي">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                اليوم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                السطور
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                الإيراد
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {days.map((day) => (
                                            <tr key={day.date} className="border-b border-hairline">
                                                <td className="px-sm py-xxs text-ink" dir="ltr">
                                                    {day.date}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                                    {String(day.entries)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                                    {formatMoney(day.total)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>

                    <p className="text-caption text-muted">
                        المصدر: جدول <span dir="ltr">revenues</span> في PostgreSQL المحلي.
                    </p>
                </>
            ) : null}
        </div>
    );
}
