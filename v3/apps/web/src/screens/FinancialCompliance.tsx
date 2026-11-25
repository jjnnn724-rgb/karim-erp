import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import { useAuthState } from '../lib/auth';
import {
    type BankMatchResult,
    type ComplianceDashboard,
    fetchComplianceDashboard,
    fetchGosiMonth,
    fetchVatStatus,
    type GosiMonth,
    submitBankMatches,
    type VatStatus,
} from '../lib/financial-compliance';
import './FinancialCompliance.css';

type Module = 'command' | 'vat' | 'payroll' | 'bank';

const MODULES: readonly { readonly id: Module; readonly label: string }[] = [
    { id: 'command', label: 'مركز القيادة' },
    { id: 'vat', label: 'ضريبة القيمة المضافة' },
    { id: 'payroll', label: 'الرواتب والتأمينات' },
    { id: 'bank', label: 'مطابقة البنك' },
];

function money(value: string): string {
    const amount = Number(value);
    return Number.isFinite(amount)
        ? new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
        : value;
}

function errorText(error: unknown): string {
    if (error instanceof ApiError) {
        return error.message;
    }
    return error instanceof Error ? error.message : 'تعذر تحميل البيانات من الخادم.';
}

function QueryFailure({ error, retry }: { readonly error: unknown; readonly retry: () => void }) {
    return (
        <div className="fc-error" role="alert">
            <p>{errorText(error)}</p>
            <button type="button" className="fc-button fc-button--secondary" onClick={retry}>
                إعادة المحاولة
            </button>
        </div>
    );
}

function Loading({ label }: { readonly label: string }) {
    return (
        <p className="fc-loading" role="status">
            {label}
        </p>
    );
}

function Kpi({ label, value, tone = 'default' }: { readonly label: string; readonly value: string; readonly tone?: 'default' | 'accent' }) {
    return (
        <article className={`fc-kpi fc-kpi--${tone}`}>
            <h3>{label}</h3>
            <p className="fc-number" dir="ltr">
                {money(value)} <span>SAR</span>
            </p>
        </article>
    );
}

function AlertList({ data }: { readonly data: ComplianceDashboard }) {
    if (data.alerts.length === 0) {
        return <p className="fc-empty">لا توجد تنبيهات مطابقة للفترة الحالية.</p>;
    }
    return (
        <ul className="fc-alert-list">
            {data.alerts.map((alert) => (
                <li
                    className={`fc-alert fc-alert--${alert.severity === 'high' ? 'high' : 'warning'}`}
                    key={`${alert.type}-${alert.reference ?? alert.employeeId ?? alert.date ?? alert.expiryDate ?? alert.blocker ?? alert.title}`}
                >
                    <span className="fc-alert__marker" aria-hidden="true" />
                    <div>
                        <strong>{alert.title}</strong>
                        <p>
                            {alert.employeeName ? `${alert.employeeName} — ` : ''}
                            {alert.reference ? `مرجع ${alert.reference} — ` : ''}
                            {alert.expiryDate ?? alert.date ?? ''}
                            {alert.blocker ? ` — ${alert.blocker}` : ''}
                        </p>
                    </div>
                </li>
            ))}
        </ul>
    );
}

function DashboardPanel({
    data,
    loading,
    error,
    retry,
}: {
    readonly data: ComplianceDashboard | undefined;
    readonly loading: boolean;
    readonly error: unknown;
    readonly retry: () => void;
}) {
    if (loading) return <Loading label="جارٍ تحميل المؤشرات والتنبيهات من قاعدة البيانات…" />;
    if (error) return <QueryFailure error={error} retry={retry} />;
    if (!data) return <p className="fc-empty">لا توجد بيانات متاحة.</p>;

    return (
        <>
            <div className="fc-section-heading">
                <div>
                    <h2>ملخص الفترة</h2>
                    <p>
                        من {data.period.from} إلى {data.period.to} · أرقام الفواتير المرحّلة فقط
                    </p>
                </div>
            </div>
            <div className="fc-kpis">
                <Kpi label="إجمالي المبيعات" value={data.kpis.totalSales} />
                <Kpi label="ضريبة المخرجات" value={data.kpis.outputVat} />
                <Kpi label="ضريبة المدخلات" value={data.kpis.inputVat} />
                <Kpi label="صافي الضريبة" value={data.kpis.netPayable} tone="accent" />
            </div>
            <section className="fc-panel">
                <div className="fc-section-heading">
                    <div>
                        <h2>تنبيهات المخاطر</h2>
                        <p>فواتير غير مرحّلة وإقامات تقترب من الانتهاء</p>
                    </div>
                    <span className="fc-count">{data.alerts.length}</span>
                </div>
                <AlertList data={data} />
            </section>
        </>
    );
}

function VatPanel({
    status,
    loading,
    error,
    retry,
}: {
    readonly status: VatStatus | undefined;
    readonly loading: boolean;
    readonly error: unknown;
    readonly retry: () => void;
}) {
    if (loading) return <Loading label="جارٍ التحقق من فترة ضريبة القيمة المضافة…" />;
    if (error) return <QueryFailure error={error} retry={retry} />;
    if (!status) return <p className="fc-empty">لم يتم تحميل حالة الفترة.</p>;

    if (!status.ok) {
        return (
            <section className="fc-hard-block" role="alert" aria-live="assertive">
                <div className="fc-hard-block__heading">
                    <span aria-hidden="true">!</span>
                    <div>
                        <h2>ممنوع اعتماد الفترة الضريبية</h2>
                        <p>{status.data.message}</p>
                    </div>
                </div>
                <p className="fc-code" dir="ltr">
                    {status.data.error}
                </p>
                {status.data.blockingInvoices.length > 0 ? (
                    <div className="fc-table-wrap">
                        <table className="fc-table">
                            <thead>
                                <tr>
                                    <th>المصدر</th>
                                    <th>رقم الفاتورة</th>
                                    <th>التاريخ</th>
                                    <th>الحالة / المانع</th>
                                </tr>
                            </thead>
                            <tbody>
                                {status.data.blockingInvoices.map((item) => (
                                    <tr
                                        key={`${item.sourceType ?? 'block'}-${item.documentId ?? item.invoiceReference ?? item.blocker ?? item.status ?? 'unknown'}`}
                                    >
                                        <td>{item.sourceType ?? '—'}</td>
                                        <td>{item.invoiceReference ?? item.documentId ?? '—'}</td>
                                        <td dir="ltr">{item.invoiceDate ?? '—'}</td>
                                        <td>
                                            {item.blocker ?? item.status ?? '—'}
                                            {item.count ? ` (${item.count})` : ''}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : null}
            </section>
        );
    }

    return (
        <section className="fc-panel">
            <div className="fc-section-heading">
                <div>
                    <h2>الفترة جاهزة للمراجعة</h2>
                    <p>
                        {status.data.period.from} — {status.data.period.to}
                    </p>
                </div>
                <span className="fc-status fc-status--ok">اجتازت فحوصات النظام</span>
            </div>
            <div className="fc-kpis fc-kpis--three">
                <Kpi label="ضريبة المخرجات" value={status.data.summary.outputVat} />
                <Kpi label="ضريبة المدخلات" value={status.data.summary.inputVat} />
                <Kpi label="الصافي المستحق / (الدائن)" value={status.data.summary.netVatPayable} tone="accent" />
            </div>
            <p className="fc-disclaimer">اجتياز الفحوصات الداخلية لا يعني تقديم الإقرار إلى زاتكا أو اعتماده من الهيئة.</p>
        </section>
    );
}

function PayrollPanel({
    data,
    loading,
    error,
    retry,
}: {
    readonly data: GosiMonth | undefined;
    readonly loading: boolean;
    readonly error: unknown;
    readonly retry: () => void;
}) {
    if (loading) return <Loading label="جارٍ تحميل حسابات التأمينات لهذا الشهر…" />;
    if (error) return <QueryFailure error={error} retry={retry} />;
    if (!data) return <p className="fc-empty">لا توجد بيانات رواتب متاحة.</p>;

    return (
        <>
            {!data.payrollApprovalAllowed ? (
                <div className="fc-hard-block fc-hard-block--compact" role="alert">
                    <strong>اعتماد الرواتب محظور</strong>
                    <p>لم يُعثر على مجموعة نسب تأمينات موثّقة ومعتمدة. الحسابات أدناه معاينة فقط، ولا تُعدّ اعتمادًا تنظيميًا.</p>
                </div>
            ) : null}
            <div className="fc-section-heading">
                <div>
                    <h2>حسابات شهر {data.month}</h2>
                    <p>أساس الحساب والأجور والنسب حسب سجل الموظف</p>
                </div>
            </div>
            <div className="fc-kpis fc-kpis--three">
                <Kpi label="حصة الموظفين" value={data.totals.employeeContribution} />
                <Kpi label="حصة المنشأة" value={data.totals.employerContribution} />
                <Kpi label="الإجمالي" value={data.totals.totalContribution} tone="accent" />
            </div>
            {data.calculations.length === 0 ? (
                <p className="fc-empty">لا توجد مسيرات لهذا الشهر.</p>
            ) : (
                <div className="fc-table-wrap fc-table-wrap--large">
                    <table className="fc-table">
                        <thead>
                            <tr>
                                <th>الموظف</th>
                                <th>الفئة</th>
                                <th>الأجر الخاضع</th>
                                <th>حصة الموظف</th>
                                <th>حصة المنشأة</th>
                                <th>الحالة</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.calculations.map((item) => (
                                <tr key={item.payrollId}>
                                    <td>{item.employeeName}</td>
                                    <td>
                                        {item.calculation?.insuredCategory === 'saudi'
                                            ? 'سعودي'
                                            : item.calculation?.insuredCategory === 'expat'
                                              ? 'غير سعودي'
                                              : 'غير محدد'}
                                    </td>
                                    <td dir="ltr">{item.calculation?.contributionBase ? money(item.calculation.contributionBase) : '—'}</td>
                                    <td dir="ltr">
                                        {item.calculation?.employeeContribution ? money(item.calculation.employeeContribution) : '—'}
                                    </td>
                                    <td dir="ltr">
                                        {item.calculation?.employerContribution ? money(item.calculation.employerContribution) : '—'}
                                    </td>
                                    <td>
                                        {item.blockers.length > 0
                                            ? item.blockers.map((blocker) => blocker.code).join(', ')
                                            : item.payrollApprovalAllowed
                                              ? 'موثّق'
                                              : 'معاينة — النسب غير موثّقة'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

function BankPanel() {
    const [idsText, setIdsText] = useState('');
    const [result, setResult] = useState<BankMatchResult | null>(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError('');
        setResult(null);
        const ids = idsText
            .split(/[\s,،]+/)
            .map((id) => id.trim())
            .filter(Boolean);
        if (ids.length === 0 || ids.some((id) => !/^\d+$/.test(id))) {
            setError('أدخل معرّفًا رقميًا صحيحًا لكل حركة مستوردة.');
            return;
        }
        setSaving(true);
        try {
            setResult(await submitBankMatches(ids));
        } catch (reason) {
            setError(errorText(reason));
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <section className="fc-panel">
                <div className="fc-section-heading">
                    <div>
                        <h2>المطابقة الآلية</h2>
                        <p>أدخل معرّفات صفوف كشف البنك المحفوظة مسبقًا في النظام.</p>
                    </div>
                </div>
                <form className="fc-bank-form" onSubmit={submit}>
                    <label htmlFor="fc-statement-ids">معرّفات حركات كشف البنك</label>
                    <textarea
                        id="fc-statement-ids"
                        value={idsText}
                        onChange={(event) => setIdsText(event.target.value)}
                        placeholder="أدخل المعرّفات مفصولة بفواصل أو أسطر"
                        rows={3}
                        dir="ltr"
                        autoComplete="off"
                    />
                    <p>تُطابق الحركات بمبلغ دقيق وتاريخ ضمن يومين. يلزم دور محاسب أو مسؤول.</p>
                    <button className="fc-button fc-button--primary" type="submit" disabled={saving}>
                        {saving ? 'جارٍ المطابقة…' : 'مطابقة الحركات'}
                    </button>
                </form>
                {error ? (
                    <p className="fc-error-inline" role="alert">
                        {error}
                    </p>
                ) : null}
            </section>
            {result ? (
                <section className="fc-panel" aria-live="polite">
                    <div className="fc-section-heading">
                        <h2>نتيجة المطابقة</h2>
                    </div>
                    <p className="fc-result-summary">
                        مطابق: {result.matched.length} · غير مطابق: {result.unmatched.length}
                    </p>
                    {result.matched.length > 0 ? (
                        <div className="fc-table-wrap">
                            <table className="fc-table">
                                <thead>
                                    <tr>
                                        <th>حركة البنك</th>
                                        <th>القيد المحاسبي</th>
                                        <th>النتيجة</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.matched.map((item) => (
                                        <tr key={item.bankTransactionId}>
                                            <td dir="ltr">{item.bankTransactionId}</td>
                                            <td dir="ltr">{item.journalEntryId}</td>
                                            <td>تمت المطابقة</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                    {result.unmatched.length > 0 ? (
                        <div className="fc-table-wrap">
                            <table className="fc-table fc-table--amber">
                                <thead>
                                    <tr>
                                        <th>حركة البنك</th>
                                        <th>سبب عدم المطابقة</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.unmatched.map((item) => (
                                        <tr key={item.bankTransactionId}>
                                            <td dir="ltr">{item.bankTransactionId}</td>
                                            <td>{item.reason}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                </section>
            ) : null}
        </>
    );
}

export function FinancialCompliance() {
    const auth = useAuthState();
    const initialModule: Module = auth.user?.role === 'hr' ? 'payroll' : 'command';
    const [active, setActive] = useState<Module>(initialModule);
    const visibleModules =
        auth.user?.role === 'hr'
            ? MODULES.filter((module) => module.id === 'payroll')
            : auth.user?.role === 'manager'
              ? MODULES.filter((module) => module.id === 'command' || module.id === 'vat')
              : MODULES;
    const dashboard = useQuery({
        queryKey: ['financial-compliance', 'dashboard'],
        queryFn: ({ signal }) => fetchComplianceDashboard(signal),
        staleTime: 30_000,
        refetchInterval: 60_000,
        enabled: auth.user?.role !== 'hr',
    });
    const vat = useQuery({
        queryKey: ['financial-compliance', 'vat-status'],
        queryFn: ({ signal }) => fetchVatStatus(signal),
        enabled: active === 'vat',
        retry: false,
    });
    const payroll = useQuery({
        queryKey: ['financial-compliance', 'gosi'],
        queryFn: ({ signal }) => fetchGosiMonth(signal),
        enabled: active === 'payroll',
        retry: false,
    });

    return (
        <section className="fc-page" dir="rtl" aria-label="مركز الامتثال المالي">
            <header className="fc-header">
                <div>
                    <p className="fc-eyebrow">KARIM ERP · FINANCIAL CONTROL</p>
                    <h1>مركز الامتثال المالي</h1>
                    <p>بيانات مباشرة من قاعدة النظام · لا توجد بيانات تجريبية</p>
                </div>
                <span className={`fc-live${dashboard.isError ? ' fc-live--error' : ''}`} role="status">
                    <span aria-hidden="true" />
                    {dashboard.isError ? 'تعذر الاتصال' : dashboard.isSuccess ? 'بيانات محدثة' : 'جارٍ الاتصال'}
                </span>
            </header>
            <nav className="fc-tabs" aria-label="وحدات الامتثال">
                {visibleModules.map((module) => (
                    <button
                        key={module.id}
                        type="button"
                        className={`fc-tab${active === module.id ? ' is-active' : ''}`}
                        aria-current={active === module.id ? 'page' : undefined}
                        onClick={() => setActive(module.id)}
                    >
                        {module.label}
                    </button>
                ))}
            </nav>
            <div className="fc-content" key={active}>
                {active === 'command' ? (
                    <DashboardPanel
                        data={dashboard.data}
                        loading={dashboard.isPending}
                        error={dashboard.error}
                        retry={() => void dashboard.refetch()}
                    />
                ) : null}
                {active === 'vat' ? (
                    <VatPanel status={vat.data} loading={vat.isPending} error={vat.error} retry={() => void vat.refetch()} />
                ) : null}
                {active === 'payroll' ? (
                    <PayrollPanel
                        data={payroll.data}
                        loading={payroll.isPending}
                        error={payroll.error}
                        retry={() => void payroll.refetch()}
                    />
                ) : null}
                {active === 'bank' ? <BankPanel /> : null}
            </div>
        </section>
    );
}
