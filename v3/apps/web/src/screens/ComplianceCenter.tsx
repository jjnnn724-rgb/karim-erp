import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateError, StateLoading } from '../components/TableState';
import { fetchComplianceReport } from '../lib/compliance-report';
import { currentMonth } from '../lib/payroll';
import { errorMessage, intOf, moneyOf } from '../lib/reporting';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import './CommandCenter.premium.css';

/**
 * لوحة الامتثال الشهري — تُغني كل شخص في المنشأة عن الذهاب للأنظمة واحدًا واحدًا:
 * الرواتب، مدد (WPS)، التأمينات (GOSI)، وقوى — من مصادر النظام الحقيقية فقط.
 *
 * كل رقم يأتي من `/api/integration/monthly-report` (قراءة فقط). لا تُرسل أي شيء
 * ولا تُحدّث أي قيد — و«غير مسجّل» يُعرض «—» كما هو في الإقرار الضريبي.
 */

const RATE_SETS = [
    { value: 'legacy_before_2024_07', label: 'مسجّل قبل 2024-07-03' },
    { value: 'new_registrant_2026', label: 'مسجّل بعد 2024-07-03 (2026)' },
];

export function ComplianceCenter() {
    const [draft, setDraft] = useState(() => currentMonth());
    const [month, setMonth] = useState(draft);
    const [rateSetId, setRateSetId] = useState('legacy_before_2024_07');
    const [problem, setProblem] = useState('');

    const query = useQuery({
        queryKey: ['compliance-center', month, rateSetId],
        queryFn: ({ signal }) => fetchComplianceReport(month, rateSetId, signal),
        retry: false,
    });

    const data = query.data ?? null;
    const report = data?.report ?? null;

    function apply() {
        const message = /^\d{4}-\d{2}$/.test(draft.trim()) ? '' : 'أدخل شهرًا صحيحًا بصيغة YYYY-MM.';
        setProblem(message);
        if (!message) {
            setMonth(draft.trim());
        }
    }

    const readinessPercent = report?.readiness?.percent ?? 0;
    const blockers = useMemo(() => {
        if (!report) {
            return [] as string[];
        }
        return [...(report.global_blockers ?? []), ...(report.readiness.blockers ?? []).map((code) => `WPS: ${code}`)];
    }, [report]);

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-lg">
            <ReportHeader
                title="لوحة الامتثال الشهري"
                english="Compliance Center"
                description="رواتب ومدد وتأمينات وقوى في ورقة واحدة — أرقام حقيقية من النظام، بلا إرسال ولا رفع ولا اعتماد تلقائي."
                pending={query.isFetching}
                onRefresh={() => {
                    void query.refetch();
                }}
            />

            <div data-erp-print-hide className="flex flex-wrap items-center gap-sm">
                <PrintActions title={`تقرير الامتثال — ${month}`} />
            </div>

            <SectionCard title="شهر الامتثال" english="Compliance month">
                <div className="flex flex-col gap-sm p-sm">
                    <div className="flex flex-wrap items-end gap-sm">
                        <Input
                            label="الشهر"
                            type="month"
                            value={draft}
                            onChange={(event) => {
                                setDraft(event.target.value);
                            }}
                            containerClassName="w-48"
                            hint="YYYY-MM"
                        />
                        <select
                            className="erp-control block w-64 rounded-md border border-hairline-strong bg-surface px-sm py-xs text-body-md text-ink"
                            value={rateSetId}
                            onChange={(event) => {
                                setRateSetId(event.target.value);
                            }}
                            aria-label="مجموعة نسب التأمينات"
                        >
                            {RATE_SETS.map((set) => (
                                <option key={set.value} value={set.value}>
                                    {set.label}
                                </option>
                            ))}
                        </select>
                        <Button variant="secondary" loading={query.isFetching} onClick={apply}>
                            تطبيق
                        </Button>
                    </div>
                    {problem ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                    <p className="text-body-sm text-muted">
                        النسب غير موثّقة داخل النظام — يلزم تثبيتها من المحاسب قبل أي استخدام رسمي. التقرير للقراءة فقط.
                    </p>
                </div>
            </SectionCard>

            {query.isPending ? <StateLoading label="جارٍ تجميع تقرير الامتثال من الأنظمة…" /> : null}
            {query.isError ? (
                <StateError
                    message={errorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                />
            ) : null}

            {report ? (
                <>
                    <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                        <KpiCard
                            label="الموظفون النشطون"
                            english="Active employees"
                            value={intOf(report.payroll.active_employees)}
                            hint={report.payroll.posted ? 'المسير مُرحّل' : 'المسير غير مُرحّل'}
                            tone={report.payroll.posted ? 'neutral' : 'warning'}
                        />
                        <KpiCard
                            label="صافي الرواتب"
                            english="Net payroll"
                            value={moneyOf(report.payroll.totals.net)}
                            hint={`${intOf(report.payroll.employees_with_line)} بسطر مسير · ${intOf(report.payroll.employees_without_line)} بلا سطر`}
                        />
                        <KpiCard
                            label="جاهزية مدد (WPS)"
                            english="WPS readiness"
                            value={`${String(readinessPercent)}%`}
                            hint={report.export_ready ? 'كشف أجور جاهز للمراجعة' : 'غير جاهز — راجع الموانع'}
                            tone={report.export_ready ? 'neutral' : 'warning'}
                        />
                        <KpiCard
                            label="الجاهزية للتصدير"
                            english="Export readiness"
                            value={report.export_ready ? 'جاهزة' : 'موقوفة'}
                            hint={blockers.length ? `${intOf(blockers.length)} مانع` : 'لا موانع'}
                            tone={report.export_ready ? 'neutral' : 'warning'}
                        />
                    </div>

                    <SectionCard title="الموانع والفجوات" english="Blockers & gaps">
                        <div className="flex flex-col gap-sm p-sm">
                            {blockers.length ? (
                                <ul className="flex flex-col gap-xs">
                                    {blockers.map((item) => (
                                        <li key={item} className="cc-risk cc-risk--high">
                                            <span className="cc-risk__tag">مانع</span>
                                            <span>{item}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-body-sm text-success-text">لا موانع مسجلة لهذا الشهر.</p>
                            )}
                        </div>
                    </SectionCard>

                    <SectionCard title="التأمينات الاجتماعية (GOSI)" english="GOSI preview">
                        <div className="flex flex-col gap-sm p-sm">
                            {report.gosi.preview ? (
                                <>
                                    <p className="text-body-sm text-muted">
                                        مجموعة النسب: {report.gosi.rate_set?.label_ar ?? '—'} — غير موثّقة داخل النظام، تستلزم تثبيت المحاسب.
                                    </p>
                                    <p className="text-body-sm text-muted">{report.gosi.note}</p>
                                    <div className="grid gap-sm sm:grid-cols-2">
                                        <KpiCard
                                            label="تأمينات الموظفين (سعودي)"
                                            english="Employee GOSI (Saudi)"
                                            value={moneyOf(report.gosi.preview.totals?.saudiEmployee ?? 0)}
                                            hint="مجموع الاستقطاعات السعودية"
                                        />
                                        <KpiCard
                                            label="تأمينات صاحب العمل (سعودي)"
                                            english="Employer GOSI (Saudi)"
                                            value={moneyOf(report.gosi.preview.totals?.saudiEmployer ?? 0)}
                                            hint="مجموع مساهمة المنشأة"
                                        />
                                    </div>
                                </>
                            ) : (
                                <p className="text-body-sm text-warning-text">{report.gosi.note}</p>
                            )}
                        </div>
                    </SectionCard>

                    <SectionCard title="قوى (Qiwa)" english="Qiwa readiness">
                        <div className="overflow-x-auto p-sm">
                            <table className="w-full border-collapse">
                                <caption className="sr-only">فحوص منصة قوى</caption>
                                <thead>
                                    <tr>
                                        {['الفحص', 'الحالة', 'التفاصيل'].map((label) => (
                                            <th
                                                key={label}
                                                scope="col"
                                                className="border-b border-hairline bg-surface-sunken px-sm py-xs text-start text-label-md font-medium text-ink-secondary"
                                            >
                                                {label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.qiwa.checks.map((check) => (
                                        <tr key={check.id}>
                                            <td className="border-b border-hairline px-sm py-xxs text-ink">{check.label_ar}</td>
                                            <td className="border-b border-hairline px-sm py-xxs">
                                                <span className={check.ok ? 'text-success-text' : 'text-danger-text'}>
                                                    {check.ok ? '✔' : '✘'}
                                                </span>
                                            </td>
                                            <td className="border-b border-hairline px-sm py-xxs text-ink">{check.detail ?? '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </SectionCard>
                </>
            ) : null}
        </div>
    );
}
