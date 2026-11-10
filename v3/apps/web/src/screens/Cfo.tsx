import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CfoGrowth, CFO_GROWTH_TABS, type CfoGrowthView } from '../components/CfoGrowth';
import { ReportHeader, SectionCard } from '../components/Reports';
import { FilterBar, StatCard } from '../ui';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import {
    balanceLine,
    fetchCfoSnapshot,
    marginText,
    reconciliationTone,
    type CfoSnapshot,
    type JournalEntry,
} from '../lib/cfo';
import { errorMessage, intOf, moneyOf, num, presetRange, rangeProblem, textOf } from '../lib/reporting';
import { PrintActions } from '../components/PrintActions';

/**
 * المدير المالي — قراءة فقط. كل رقم يصل جاهزًا من الخادم؛ لا جمع ولا حساب
 * مالي هنا. الفترة تُمرَّر كما هي، والمدى المقلوب يُمنع محليًا قبل الطلب.
 */

const STATUS_LABEL: Record<string, string> = {
    posted: 'مرحّل',
    draft: 'مسوّدة',
    void: 'ملغى',
};

const TYPE_LABEL: Record<string, string> = {
    asset: 'أصول',
    liability: 'التزامات',
    equity: 'حقوق ملكية',
    revenue: 'إيرادات',
    cogs: 'تكلفة مبيعات',
    expense: 'مصروفات',
};

const TONE_CLASS = {
    neutral: 'text-ink',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
} as const;

export function Cfo() {
    const initial = presetRange('month');
    const [draft, setDraft] = useState(() => ({ from: initial.from, to: initial.to }));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');
    const [q, setQ] = useState('');
    const [tab, setTab] = useState<'dashboard' | CfoGrowthView>('dashboard');

    const query = useQuery({
        queryKey: ['cfo', range.from, range.to],
        queryFn: ({ signal }) => fetchCfoSnapshot(range.from, range.to, signal),
        enabled: problem === '',
    });

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 366);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    const snapshot: CfoSnapshot | undefined = query.data;
    const summary = snapshot?.summary ?? null;
    const trialBalance = snapshot?.trialBalance ?? null;
    const accounts = trialBalance?.accounts ?? [];
    const journal = snapshot?.journal ?? [];
    const periods = snapshot?.periods?.periods ?? [];
    const shifts = snapshot?.openShifts?.shifts ?? [];
    const dayClose = snapshot?.dayClose ?? null;
    const reconciliation = summary?.reconciliation;
    const reconStatus = textOf(reconciliation?.status);
    const reconTone = reconciliationTone(reconStatus);

    // فلتر واجهة أمامية على جدول ميزان المراجعة باسم الحساب
    const filteredAccounts = useMemo(() => {
        return accounts.filter((account) => {
            const textOk = q ? ((textOf(account.name_ar) ?? textOf(account.name_en) ?? '') ?? '').includes(q) : true;
            return textOk;
        });
    }, [accounts, q]);

    return (
        <div className="flex flex-col gap-md">
            <ReportHeader
                title="المدير المالي"
                english="CFO"
                description="الإيراد والتكلفة والصافي والنقد وميزان المراجعة والفترات — قراءة واحدة من دفتر القيود المرحّلة."
                pending={query.isFetching}
                onRefresh={() => {
                    void query.refetch();
                }}
            />
            <PrintActions title="المدير المالي" />

            <FilterBar
                id="cfo-filter"
                from={draft.from}
                to={draft.to}
                onFrom={(value: string) => setDraft((current) => ({ ...current, from: value }))}
                onTo={(value: string) => setDraft((current) => ({ ...current, to: value }))}
                onApply={apply}
                searchLabel="بحث في الحسابات"
                searchPlaceholder="ابحث باسم الحساب أو الكود…"
                searchValue={q}
                onSearchChange={(next: string) => setQ(next)}
                pending={query.isFetching}
                error={problem}
                data-testid="cfo-filter-bar"
            />

            <div className="flex flex-wrap gap-xs" role="tablist" aria-label="أقسام المدير المالي">
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'dashboard'}
                    onClick={() => setTab('dashboard')}
                    className={`rounded-md border px-sm py-xs text-button-md ${
                        tab === 'dashboard'
                            ? 'border-primary bg-primary text-on-primary'
                            : 'border-hairline-strong bg-surface text-ink hover:bg-surface-hover'
                    }`}
                >
                    لوحة CFO{' '}
                    <span className="text-caption opacity-75" dir="ltr" lang="en">
                        Dashboard
                    </span>
                </button>
                {CFO_GROWTH_TABS.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.key}
                        onClick={() => setTab(item.key)}
                        className={`rounded-md border px-sm py-xs text-button-md ${
                            tab === item.key
                                ? 'border-primary bg-primary text-on-primary'
                                : 'border-hairline-strong bg-surface text-ink hover:bg-surface-hover'
                        }`}
                    >
                        {item.label}{' '}
                        <span className="text-caption opacity-75" dir="ltr" lang="en">
                            {item.english}
                        </span>
                    </button>
                ))}
            </div>

            {tab === 'dashboard' ? (
                <>
                    {query.isPending && problem === '' ? <StateLoading label="جارٍ تحميل لوحة المدير المالي…" /> : null}

            {query.isError ? (
                <StateError
                    message={errorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                />
            ) : null}

            {snapshot?.failures.length ? (
                <div role="alert" className="rounded-md border border-hairline bg-surface-sunken p-sm text-body-sm text-warning-text">
                    <p className="text-body-md text-ink">بعض المصادر لم تستجب — المعروض هو ما وصل فقط:</p>
                    <ul className="mt-xxs list-disc ps-md">
                        {snapshot.failures.map((failure) => (
                            <li key={failure}>{failure}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {summary ? (
                <>
                    <ul
                        className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4"
                        aria-label="مؤشرات المدير المالي"
                    >
                        <StatCard
                            label="الإيراد"
                            english="Revenue"
                            value={moneyOf(summary.revenue?.total)}
                            hint={`${intOf(summary.revenue?.count)} حركة — صافي بلا ضريبة`}
                        />
                        <StatCard
                            label="مجمل الربح"
                            english="Gross profit"
                            value={moneyOf(summary.gross_profit?.amount)}
                            hint={`هامش ${marginText(summary.gross_profit?.margin_pct)} — بعد تكلفة المواد`}
                            tone={num(summary.gross_profit?.amount) < 0 ? 'danger' : 'success'}
                        />
                        <StatCard
                            label="المصروفات التشغيلية"
                            english="Operating expenses"
                            value={moneyOf(summary.expenses?.total)}
                            hint={`${intOf(summary.expenses?.count)} سطرًا — بلا صرف مخزون`}
                            tone="warning"
                        />
                        <StatCard
                            label="صافي الربح"
                            english="Net profit"
                            value={moneyOf(summary.net_profit?.amount)}
                            hint={`هامش ${marginText(summary.net_profit?.margin_pct)}`}
                            tone={num(summary.net_profit?.amount) < 0 ? 'danger' : 'success'}
                        />
                        <StatCard
                            label="النقدية"
                            english="Cash"
                            value={moneyOf(summary.cash_position)}
                            hint={`صندوق ${moneyOf(summary.cash_ledger?.petty_cash)} · بنك ${moneyOf(summary.cash_ledger?.bank)}`}
                        />
                        <StatCard
                            label="تسوية الدفتر"
                            english="Ledger parity"
                            value={reconStatus || '—'}
                            hint={`فرق ${moneyOf(reconciliation?.difference)} · ${intOf(reconciliation?.unposted_rows)} صفًا بلا قيد`}
                            tone={reconTone}
                        />
                        <StatCard
                            label="قيود الفترة"
                            english="Journal entries"
                            value={intOf(summary.journal_entries)}
                            hint={`${intOf(summary.journal_entries_all_time)} قيدًا مرحّلًا إجمالًا`}
                        />
                        <StatCard
                            label="فواتير POS"
                            english="POS invoices"
                            value={intOf(summary.pos?.invoices)}
                            hint={`إجمالي ${moneyOf(summary.pos?.total)}`}
                        />
                    </ul>

                    {reconciliation ? (
                        <SectionCard title="تسوية الدفتر مع الكاشير" english="Ledger parity">
                            <dl className="grid gap-sm p-sm text-body-sm sm:grid-cols-2 lg:grid-cols-4">
                                <div>
                                    <dt className="text-muted">إيراد المرآة</dt>
                                    <dd className="erp-numeric text-ink" dir="ltr">
                                        {moneyOf(reconciliation.mirror_revenue)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-muted">إيراد الدفتر</dt>
                                    <dd className="erp-numeric text-ink" dir="ltr">
                                        {moneyOf(reconciliation.ledger_revenue)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-muted">الفرق</dt>
                                    <dd className={`erp-numeric ${TONE_CLASS[reconTone]}`} dir="ltr">
                                        {moneyOf(reconciliation.difference)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-muted">صفوف بلا قيد</dt>
                                    <dd className="erp-numeric text-ink" dir="ltr">
                                        {intOf(reconciliation.unposted_rows)}
                                    </dd>
                                </div>
                            </dl>
                        </SectionCard>
                    ) : null}
                </>
            ) : null}

            <SectionCard title="ميزان المراجعة" english="Trial balance">
                {trialBalance ? (
                    <>
                        <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                            {`مجموع مدين ${moneyOf(trialBalance.total_debit)} · مجموع دائن ${moneyOf(trialBalance.total_credit)} · `}
                            <span className={trialBalance.balanced ? 'text-success-text' : 'text-danger-text'}>
                                {trialBalance.balanced ? 'متوازن' : 'غير متوازن'}
                            </span>
                            <span className="me-xs text-caption text-faint" dir="ltr">
                                {balanceLine(trialBalance)}
                            </span>
                        </p>
                        {accounts.length === 0 ? (
                            <StateEmpty title="لا حركات في الفترة" hint="رحّل المبيعات من الكاشير أو أدخل قيدًا في v2." />
                        ) : filteredAccounts.length === 0 ? (
                            <StateEmpty title="لا نتائج للبحث" hint="جرّب اسم حساب آخر أو امسح البحث." />
                        ) : (
                            <TableScroll label="جدول ميزان المراجعة">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الكود
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الحساب
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                النوع
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
                                        {filteredAccounts.map((account) => (
                                            <tr key={textOf(account.code)} className="border-b border-hairline hover:bg-surface-hover">
                                                <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                    {textOf(account.code) || '—'}
                                                </td>
                                                <td className="px-sm py-xxs text-ink">
                                                    {textOf(account.name_ar) || textOf(account.name_en) || '—'}
                                                </td>
                                                <td className="px-sm py-xxs text-muted">
                                                    {TYPE_LABEL[textOf(account.type)] ?? (textOf(account.type) || '—')}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                    {moneyOf(account.debit)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                    {moneyOf(account.credit)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </>
                ) : (
                    <StateEmpty title="ميزان المراجعة غير متاح" hint="المصدر لم يستجب — أعد المحاولة بعد قليل." />
                )}
            </SectionCard>

            <SectionCard title="دفتر اليومية" english="Journal — latest 30">
                {journal.length === 0 ? (
                    <StateEmpty title="لا قيود في السجل" hint="تُرحَّل القيود تلقائيًا من الكاشير أو يدويًا من v2." />
                ) : (
                    <TableScroll label="جدول دفتر اليومية">
                        <table className="w-full border-collapse text-body-md">
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        القيد
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        التاريخ
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        البيان
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        المصدر
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الحالة
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {journal.map((entry: JournalEntry) => (
                                    <tr key={String(entry.id)} className="border-b border-hairline hover:bg-surface-hover">
                                        <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                            {textOf(entry.entry_no) || `#${String(entry.id)}`}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                            {textOf(entry.date).slice(0, 10) || '—'}
                                        </td>
                                        <td className="px-sm py-xxs text-ink">{textOf(entry.memo) || '—'}</td>
                                        <td className="px-sm py-xxs text-muted" dir="ltr">
                                            {textOf(entry.source_type) || '—'}
                                        </td>
                                        <td className="px-sm py-xxs">
                                            <span
                                                className={
                                                    entry.status === 'posted'
                                                        ? 'text-success-text'
                                                        : entry.status === 'draft'
                                                          ? 'text-warning-text'
                                                          : 'text-muted'
                                                }
                                            >
                                                {STATUS_LABEL[textOf(entry.status)] ?? (textOf(entry.status) || '—')}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                )}
            </SectionCard>

            <div className="grid gap-md lg:grid-cols-2">
                <SectionCard title="الإغلاق الشهري" english="Periods">
                    {periods.length === 0 ? (
                        <StateEmpty title="لا فترات" hint="يعرض الخادم آخر 24 شهرًا — لم يصل شيء." />
                    ) : (
                        <TableScroll label="جدول الفترات المحاسبية">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الفترة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الحالة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            مُرحّل
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            مسوّدات
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {periods.slice(0, 12).map((period) => (
                                        <tr key={textOf(period.period)} className="border-b border-hairline">
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {textOf(period.period) || '—'}
                                            </td>
                                            <td className="px-sm py-xxs">
                                                <span className={period.closed ? 'text-success-text' : 'text-muted'}>
                                                    {period.closed ? 'مقفلة' : 'مفتوحة'}
                                                </span>
                                                {period.closed_by_name ? (
                                                    <span className="ms-xs text-caption text-faint">
                                                        {textOf(period.closed_by_name)}
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {intOf(period.posted)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {intOf(period.drafts)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    )}
                </SectionCard>

                <SectionCard title="ورديات الكاشير المفتوحة" english="Open shifts">
                    {dayClose ? (
                        <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                            {`حالة ${textOf(dayClose.date) || 'اليوم'}: `}
                            {dayClose.existing_z ? 'أُقفل اليوم (Z)' : dayClose.can_close ? 'جاهز للإقفال' : 'لا ورديات'}
                            {` · ${intOf(dayClose.open?.length)} مفتوحة · ${intOf(dayClose.closed?.length)} مغلقة`}
                        </p>
                    ) : null}
                    {shifts.length === 0 ? (
                        <StateEmpty title="لا ورديات مفتوحة" hint="كل ورديات الكاشير مغلقة — لا نقد معلّق." />
                    ) : (
                        <TableScroll label="جدول الورديات المفتوحة">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الكاشير
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            القسم
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            النقد المتوقع
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            فواتير
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {shifts.map((shift) => (
                                        <tr key={String(shift.id)} className="border-b border-hairline">
                                            <td className="px-sm py-xxs text-ink">{textOf(shift.cashier_name) || '—'}</td>
                                            <td className="px-sm py-xxs text-muted">{textOf(shift.dept_name) || '—'}</td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {moneyOf(shift.expected_cash)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {intOf(shift.invoice_count)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    )}
                </SectionCard>
            </div>

            {summary?.basis ? (
                <Card>
                    <div className="border-b border-hairline px-sm py-xs">
                        <h2 className="text-heading-md text-ink">
                            أساس الأرقام{' '}
                            <span className="text-body-sm text-muted" dir="ltr" lang="en">
                                Basis
                            </span>
                        </h2>
                    </div>
                    <dl className="flex flex-col gap-xxs p-sm text-body-sm text-muted">
                        {Object.entries(summary.basis).map(([key, value]) => (
                            <div key={key} className="flex flex-wrap gap-xs">
                                <dt className="text-caption text-faint" dir="ltr">
                                    {key}
                                </dt>
                                <dd className="text-ink">{value}</dd>
                            </div>
                        ))}
                    </dl>
                </Card>
            ) : null}

            {query.isPending && problem === '' ? (
                <Card>
                    <TableSkeleton rows={4} columns={4} />
                </Card>
            ) : null}
                </>
            ) : (
                <CfoGrowth view={tab} from={range.from} to={range.to} />
            )}

        </div>
    );
}
