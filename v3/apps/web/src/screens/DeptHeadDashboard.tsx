import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { SectionCard } from '../components/Reports';
import { PrintActions } from '../components/PrintActions';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { fetchDeptHeadSnapshot } from '../lib/dashboards';
import { intOf, moneyOf, presetRange, rangeProblem } from '../lib/reporting';
import { FilterBar, StatCard , ScreenHero } from '../ui';

const STATUS_AR: Record<string, string> = {
    pending: 'معلّق',
    chef_approved: 'اعتماد الشيف',
    approved: 'معتمد — بانتظار الاستلام',
    partially_received: 'استلام جزئي',
    received: 'مستلم',
    rejected: 'مرفوض',
    unknown: 'بلا حالة',
};

/** لون الحالة — أخضر للمستلم، تحذير للمعلّق، أحمر للمرفوض. */
const STATUS_TONE: Record<string, string> = {
    pending: 'text-warning-text',
    chef_approved: 'text-warning-text',
    approved: 'text-primary',
    partially_received: 'text-warning-text',
    received: 'text-success-text',
    rejected: 'text-danger-text',
    unknown: 'text-muted',
};

/** الفترات الجاهزة — نفس مفاتيح presetRange في lib/reporting. */
const PRESETS: ReadonlyArray<{ preset: 'today' | 'week' | 'month' | 'year'; label: string }> = [
    { preset: 'today', label: 'اليوم' },
    { preset: 'week', label: 'آخر ٧ أيام' },
    { preset: 'month', label: 'هذا الشهر' },
    { preset: 'year', label: 'هذا العام' },
];

/** لوحة رئيس القسم — القسم ونطاقه ومصروفاته وأذونه من لوحة القسم على الخادم. */
export function DeptHeadDashboard() {
    const [draft, setDraft] = useState(() => presetRange('month'));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');
    const [q, setQ] = useState('');
    const navigate = useNavigate();

    function applyPreset(preset: (typeof PRESETS)[number]['preset']) {
        const next = presetRange(preset);
        setDraft(next);
        setRange(next);
        setProblem('');
    }

    const snapshot = useQuery({
        queryKey: ['dashboard', 'dept-head', range.from, range.to],
        queryFn: ({ signal }) => fetchDeptHeadSnapshot(signal),
    });

    const data = snapshot.data;

    // فلاتر واجهة أمامية على المصروفات والأذون (نطاق تاريخ + بحث نصي)
    const filteredSources = useMemo(() => {
        return (data?.sources ?? []).filter((source) => {
            const textOk = q ? (source.label ?? '').includes(q) : true;
            return textOk;
        });
    }, [data, q]);

    const filteredDispatches = useMemo(() => {
        return (data?.dispatchStatuses ?? []).filter((status) => {
            const textOk = q ? (STATUS_AR[status.key] ?? status.key ?? '').includes(q) : true;
            return textOk;
        });
    }, [data, q]);

    // صفوف مصروفات أذون الصرف — يرشحها البحث النصي نفسه (البيان/الملاحظة/رقم الإذن)
    const filteredDispatchExpenses = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return (data?.dispatchExpenses ?? []).filter((row) => {
            if (!needle) {return true;}
            const haystack = `${row.desc} ${row.notes} ${row.dispatchId ?? ''} ${row.adjustmentType}`.toLowerCase();
            return haystack.includes(needle);
        });
    }, [data, q]);

    const visibleDispatchExpensesTotal = useMemo(
        () => Math.round(filteredDispatchExpenses.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
        [filteredDispatchExpenses],
    );

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 366);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    return (
        <div className="flex flex-col gap-md">
<ScreenHero
                title="لوحة رئيس القسم"
                english="Dept Head Dashboard"
                description="قسمك ونطاقه الفرعي، ومصروفاته بحسب المصدر، وأذون الصرف بمراحلها — النطاق محسوم على الخادم."
                actions={
                    <>
                        <PrintActions title="لوحة رئيس القسم" />
                        <button
                            type="button"
                            onClick={() => {
                                void snapshot.refetch();
                            }}
                            disabled={snapshot.isFetching}
                            className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                        >
                            تحديث
                        </button>
                    </>
                }
            />
            <div className="flex justify-end gap-xs" data-erp-print-hide>
                <button
                    type="button"
                    onClick={() => {
                        void navigate({ to: '/dispatch' });
                    }}
                    className="rounded-md bg-primary px-md py-xs text-button-md text-ink-inverse hover:bg-primary-strong"
                >
                    أذون الصرف والقرارات
                </button>
            </div>

            <FilterBar
                id="dept-head-filter"
                from={draft.from}
                to={draft.to}
                onFrom={(value: string) => setDraft((current) => ({ ...current, from: value }))}
                onTo={(value: string) => setDraft((current) => ({ ...current, to: value }))}
                onApply={apply}
                searchLabel="بحث"
                searchPlaceholder="ابحث في المصروفات والأذون…"
                searchValue={q}
                onSearchChange={(next: string) => setQ(next)}
                pending={snapshot.isFetching}
                error={problem}
                data-testid="dept-head-filter-bar"
                advancedFilters={
                    <div className="flex flex-col gap-xxs" data-testid="dept-head-presets">
                        <span className="text-label-md text-ink-secondary">فترات جاهزة</span>
                        <div className="flex flex-wrap gap-xxs" role="group" aria-label="فترات جاهزة">
                            {PRESETS.map((preset) => (
                                <button
                                    key={preset.preset}
                                    type="button"
                                    onClick={() => {
                                        applyPreset(preset.preset);
                                    }}
                                    className={`rounded-md border px-sm py-xxs text-button-md ${
                                        draft.from === presetRange(preset.preset).from && draft.to === presetRange(preset.preset).to
                                            ? 'border-primary bg-primary/10 text-primary'
                                            : 'border-hairline-strong bg-surface text-muted hover:bg-surface-hover hover:text-ink'
                                    }`}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </div>
                }
            />

            {snapshot.isPending ? <StateLoading label="جارٍ جمع لوحة القسم…" /> : null}

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
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات لوحة القسم">
                        <StatCard
                            label="القسم"
                            english="Department"
                            value={data.deptName || data.deptCode || '—'}
                            hint={data.deptCode ? `الكود: ${data.deptCode}` : 'لا كود قسم معلن'}
                        />
                        <StatCard
                            label="مصروفات القسم"
                            english="Expenses"
                            value={moneyOf(data.expensesTotal)}
                            hint={`${intOf(data.expensesCount)} حركة مسجلة`}
                            tone="warning"
                        />
                        <StatCard label="أذون الصرف" english="Dispatches" value={intOf(data.dispatchTotal)} hint="إجمالي أذون القسم" />
                        <StatCard
                            label="أقسام فرعية"
                            english="Sub-departments"
                            value={intOf(data.subDepartments.length)}
                            hint={data.subDepartments.join(' · ') || 'لا أقسام فرعية'}
                        />
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="المصروفات بحسب المصدر" english="By source">
                            {filteredSources.length === 0 ? (
                                <StateEmpty title="لا مصروفات مسجلة" hint="لم تُسجَّل حركة مصروف لهذا القسم." />
                            ) : (
                                <ul className="flex list-none flex-col gap-xxs p-sm">
                                    {filteredSources.map((source) => (
                                        <li
                                            key={source.key}
                                            className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md"
                                        >
                                            <span className="text-ink">
                                                {source.label} <span className="text-caption text-faint">({intOf(source.count)})</span>
                                            </span>
                                            <span className="erp-numeric text-ink" dir="ltr">
                                                {moneyOf(source.total)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </SectionCard>

                        <SectionCard title="أذون الصرف بالحالة" english="Dispatches by status">
                            {filteredDispatches.length === 0 ? (
                                <StateEmpty title="لا أذون هذا الشهر" hint="لا أذون صرف مسجلة للقسم." />
                            ) : (
                                <ul className="flex list-none flex-col gap-xxs p-sm">
                                    {filteredDispatches.map((status) => (
                                        <li
                                            key={status.key}
                                            className="flex items-center justify-between rounded-md border border-hairline bg-surface-sunken p-xs text-body-md"
                                        >
                                            <span className={`font-medium ${STATUS_TONE[status.key] ?? 'text-ink'}`}>
                                                {STATUS_AR[status.key] ?? status.key}
                                            </span>
                                            <span className="erp-numeric text-ink" dir="ltr">
                                                {intOf(status.count)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </SectionCard>
                    </div>

                    <SectionCard title="مصروفات أذون الصرف — التفصيل" english="Dispatch expenses detail">
                        {filteredDispatchExpenses.length === 0 ? (
                            <StateEmpty
                                title={q ? 'لا توجد نتائج مطابقة للبحث' : 'لا مصروفات أذون صرف مسجلة'}
                                hint={q ? 'عدّل البحث أو امسحه لعرض كل الحركات.' : 'لم تُترحّل حركات صرف مخزني لهذا القسم بعد.'}
                            />
                        ) : (
                            <>
                                <TableScroll label="جدول مصروفات أذون الصرف">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">التاريخ</th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">البيان</th>
                                                <th scope="col" className="px-sm py-xs text-end font-medium">المبلغ</th>
                                                <th scope="col" className="px-sm py-xs text-center font-medium">النوع</th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">إذن الصرف</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredDispatchExpenses.map((row) => (
                                                <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                                    <td className="erp-numeric px-sm py-xxs whitespace-nowrap text-body-sm text-muted" dir="ltr">
                                                        {row.date || '—'}
                                                    </td>
                                                    <td className="px-sm py-xxs text-ink">
                                                        {row.desc}
                                                        {row.notes ? <span className="block text-caption text-faint">{row.notes}</span> : null}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                        {moneyOf(row.amount)}
                                                    </td>
                                                    <td className="px-sm py-xxs text-center text-body-sm">
                                                        {row.adjustmentType === 'dispatch_return' ? (
                                                            <span className="text-success-text">مرتجع (عكس)</span>
                                                        ) : (
                                                            <span className="text-muted">صرف مخزون</span>
                                                        )}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                        {row.dispatchId ? `#${row.dispatchId}` : '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr className="border-t border-hairline-strong bg-surface-sunken">
                                                <td colSpan={2} className="px-sm py-xs text-label-md text-ink-secondary">
                                                    الإجمالي المعروض ({intOf(filteredDispatchExpenses.length)} حركة)
                                                </td>
                                                <td className="erp-numeric px-sm py-xs text-end text-heading-sm text-ink" dir="ltr">
                                                    {moneyOf(visibleDispatchExpensesTotal)}
                                                </td>
                                                <td colSpan={2} />
                                            </tr>
                                        </tfoot>
                                    </table>
                                </TableScroll>
                                <p className="px-sm pb-xs pt-xxs text-caption text-faint">
                                    أحدث 200 حركة من مصروفات أذونات الصرف المعتمدة للقسم — القيمة دفترية (متوسط التكلفة وقت الاعتماد) وتُقيَّد بسالب عند الإرجاع.
                                </p>
                            </>
                        )}
                    </SectionCard>

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
