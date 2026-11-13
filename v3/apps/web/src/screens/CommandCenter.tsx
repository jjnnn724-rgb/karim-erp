import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateError, StateLoading } from '../components/TableState';
import {
    type CommandRisk,
    type ComplianceScore,
    commandKpis,
    commandRisks,
    complianceScore,
    fetchCommandCenter,
} from '../lib/command-center';
import { currentMonth } from '../lib/payroll';
import { errorMessage, moneyOf } from '../lib/reporting';
import { vatMonthRange } from '../lib/vat-return';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import './CommandCenter.premium.css';

/**
 * مركز القيادة الموحّد — لوحة V3 واحدة تقرأ من مصادر النظام الحقيقية:
 * الضريبة، الرواتب، مدد/قوى، ومطابقة البنك. لا تُحسب أرقام هنا ولا تُخمَّن؛
 * كل مؤشّر مشتقّ من استجابة الخادم، وغياب مصدر يظهر «غير متاح» صراحةً.
 *
 * الشاشة تعرض الحالة وتنبّه على المخاطر وتفتح الشاشات المفصّلة — لا تكتب.
 */

const RISK_LEVEL: Record<CommandRisk['level'], { label: string; className: string }> = {
    high: { label: 'حرج', className: 'cc-risk cc-risk--high' },
    med: { label: 'متوسط', className: 'cc-risk cc-risk--med' },
    low: { label: 'منخفض', className: 'cc-risk cc-risk--low' },
};

const TONE_LABEL: Record<ComplianceScore['tone'], string> = {
    ok: 'التزام مرتفع',
    warn: 'التزام متوسط',
    danger: 'التزام منخفض',
};

function Gauge({ score }: { score: ComplianceScore }) {
    const value = score.overall ?? 0;
    const ratio = Math.max(0, Math.min(1, value / 100));
    const stroke = score.tone === 'ok' ? 'var(--erp-success)' : score.tone === 'warn' ? 'var(--erp-warning)' : 'var(--erp-danger)';
    const circumference = 2 * Math.PI * 42;
    return (
        <div className="cc-gauge">
            <svg viewBox="0 0 100 100" className="cc-gauge__ring" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--erp-hairline)" strokeWidth="10" />
                <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke={stroke}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - ratio)}
                />
            </svg>
            <div className="cc-gauge__value">
                <span className="erp-numeric" dir="ltr">
                    {score.overall === null ? '—' : `${String(score.overall)}%`}
                </span>
                <span className="cc-gauge__caption">{TONE_LABEL[score.tone]}</span>
            </div>
        </div>
    );
}

function ScoreRow({ label, value }: { label: string; value: number | null }) {
    return (
        <div className="flex items-center justify-between gap-sm text-body-sm">
            <span className="text-muted">{label}</span>
            <span className="erp-numeric font-bold text-ink" dir="ltr">
                {value === null ? 'غير متاح' : `${String(value)}%`}
            </span>
        </div>
    );
}

function ModuleLink({
    to,
    title,
    english,
    description,
    status,
}: {
    to: '/vat-return' | '/payroll' | '/mudad' | '/bank-rec';
    title: string;
    english: string;
    description: string;
    status: string;
}) {
    return (
        <Link to={to} className="cc-module">
            <span className="cc-module__head">
                <span className="cc-module__title">
                    {title}{' '}
                    <span dir="ltr" lang="en" className="text-body-sm text-faint">
                        {english}
                    </span>
                </span>
                <span className="cc-module__status">{status}</span>
            </span>
            <span className="cc-module__desc">{description}</span>
        </Link>
    );
}

export function CommandCenter() {
    const [draft, setDraft] = useState(() => currentMonth());
    const [month, setMonth] = useState(draft);
    const [problem, setProblem] = useState('');

    const bounds = vatMonthRange(month);
    const from = bounds?.from ?? `${month}-01`;
    const to = bounds?.to ?? `${month}-28`;

    const query = useQuery({
        queryKey: ['command-center', month],
        queryFn: ({ signal }) => fetchCommandCenter({ vat: { from, to }, month, bank: { from, to } }, signal),
        retry: false,
    });

    const data = query.data ?? null;
    const score = useMemo(() => (data ? complianceScore(data) : null), [data]);
    const risks = useMemo(() => (data ? commandRisks(data) : []), [data]);
    const kpis = useMemo(() => (data ? commandKpis(data) : null), [data]);

    function apply() {
        const message = /^\d{4}-\d{2}$/.test(draft.trim()) ? '' : 'أدخل شهرًا صحيحًا بصيغة YYYY-MM.';
        setProblem(message);
        if (!message) {
            setMonth(draft.trim());
        }
    }

    const vatBlockers = data?.vat?.filing_readiness?.blockers?.length ?? 0;
    const wpsBlockers = data?.wps?.blockers?.length ?? 0;
    const bankUnmatched = data?.bank?.unmatched?.length ?? 0;

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-lg">
            <ReportHeader
                title="مركز القيادة الموحّد"
                english="Command Center"
                description="قراءة موحّدة من الضريبة والرواتب ومدد ومطابقة البنك — لا أرقام مخمّنة ولا إرسال إلى زاتكا."
                pending={query.isFetching}
                onRefresh={() => {
                    void query.refetch();
                }}
            />

            <SectionCard title="شهر المتابعة" english="Period">
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
                            hint="YYYY-MM — نفس الفترة لكل المصادر"
                        />
                        <Button variant="secondary" loading={query.isFetching} onClick={apply}>
                            تطبيق
                        </Button>
                    </div>
                    {problem ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {query.isPending ? <StateLoading label="جارٍ تجميع مؤشرات القيادة من الأنظمة…" /> : null}
            {query.isError ? (
                <StateError
                    message={errorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                />
            ) : null}

            {data && score ? (
                <>
                    <div className="grid gap-sm lg:grid-cols-[340px_1fr]">
                        <SectionCard title="الالتزام العام" english="Compliance">
                            <div className="flex flex-col items-center gap-md p-sm">
                                <Gauge score={score} />
                                <div className="flex w-full flex-col gap-xs border-t border-hairline pt-sm">
                                    <ScoreRow label="ضريبة القيمة المضافة" value={score.tax} />
                                    <ScoreRow label="الرواتب ومدّد (WPS)" value={score.payroll} />
                                    <ScoreRow label="مطابقة البنك" value={score.bank} />
                                </div>
                                <p className="text-body-sm text-muted">
                                    الأوزان: ضريبة 40% · رواتب 35% · بنك 25% — وتُوزَّع من جديد على المصادر المتاحة فقط.
                                </p>
                            </div>
                        </SectionCard>

                        <div className="grid content-start gap-sm sm:grid-cols-2">
                            <KpiCard
                                label="الرواتب المستحقة"
                                english="Payroll liability"
                                value={kpis?.payrollLiability ? moneyOf(Number(kpis.payrollLiability)) : '—'}
                                hint={
                                    kpis?.payrollEmployees === null
                                        ? 'غير متاح — تعذّر جلب كشف الرواتب'
                                        : `${String(kpis?.payrollEmployees ?? 0)} موظفًا نشطًا في الشهر`
                                }
                                tone={kpis?.payrollLiability ? 'neutral' : 'warning'}
                            />
                            <KpiCard
                                label="صافي الضريبة المستحقة"
                                english="Net VAT"
                                value={kpis?.taxNet === null || kpis?.taxNet === undefined ? '—' : moneyOf(kpis.taxNet)}
                                hint="من قيود الإقرار المرحّلة — لا يشمل التسويات اليدوية"
                                tone={kpis?.taxNet ? 'neutral' : 'warning'}
                            />
                            <KpiCard
                                label="صافي حركة البنك"
                                english="Bank movement"
                                value={kpis?.bankMovement === null || kpis?.bankMovement === undefined ? '—' : moneyOf(kpis.bankMovement)}
                                hint="مدين − دائن على الحساب في الفترة"
                                tone={kpis?.bankMovement === null || kpis?.bankMovement === undefined ? 'warning' : 'neutral'}
                            />
                            <KpiCard
                                label="حركات بنك غير مطابقة"
                                english="Unmatched bank"
                                value={kpis?.bankUnmatched === null || kpis?.bankUnmatched === undefined ? '—' : String(kpis.bankUnmatched)}
                                hint="كشوف بلا قيد مرحّل مطابق في الفترة"
                                tone={kpis?.bankUnmatched ? 'warning' : 'neutral'}
                            />
                        </div>
                    </div>

                    <SectionCard title="التنبؤ بالمخاطر" english="Risk prediction">
                        <div className="flex flex-col gap-sm p-sm">
                            {risks.length ? (
                                <ul className="flex flex-col gap-xs">
                                    {risks.map((risk, index) => (
                                        <li key={`${risk.level}-${String(index)}`} className={RISK_LEVEL[risk.level].className}>
                                            <span className="cc-risk__tag">{RISK_LEVEL[risk.level].label}</span>
                                            <span>{risk.text}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-body-sm text-muted">لا مخاطر مؤثّرة من مصادر النظام في هذه الفترة.</p>
                            )}
                        </div>
                    </SectionCard>

                    <SectionCard title="وحدات النظام" english="Modules">
                        <div className="grid gap-sm p-sm sm:grid-cols-2 xl:grid-cols-4">
                            <ModuleLink
                                to="/vat-return"
                                title="الضرائب وزاتكا"
                                english="VAT · ZATCA"
                                description="ورقة عمل الإقرار بخانات النموذج، ومطابقة الأرصدة، وجاهزية التقديم."
                                status={data.vat ? (vatBlockers ? `${String(vatBlockers)} موانع` : 'مطابقة') : 'غير متاح'}
                            />
                            <ModuleLink
                                to="/payroll"
                                title="الرواتب"
                                english="Payroll"
                                description="كشف الرواتب والمسيرات المعتمدة والرواتب المستحقة للشهر."
                                status={data.payroll ? `${String(data.payroll.employees.length)} موظفًا` : 'غير متاح'}
                            />
                            <ModuleLink
                                to="/mudad"
                                title="مدد والتأمينات وقوى"
                                english="WPS · GOSI · Qiwa"
                                description="جاهزية ملف الأجور، والتأمينات، وعقود قوى — قراءة ومراجعة بشرية."
                                status={data.wps ? (wpsBlockers ? `${String(wpsBlockers)} موانع` : 'جاهز للمراجعة') : 'غير متاح'}
                            />
                            <ModuleLink
                                to="/bank-rec"
                                title="الخزينة والبنك"
                                english="Bank reconciliation"
                                description="كشف البنك مقابل الدفتر، والمطابقة الآلية، والحركات غير المطابقة."
                                status={data.bank ? (bankUnmatched ? `${String(bankUnmatched)} غير مطابقة` : 'مطابقة') : 'غير متاح'}
                            />
                        </div>
                    </SectionCard>

                    <p className="rounded-lg border border-hairline bg-surface p-sm text-body-sm text-muted">
                        هذه اللوحة للقراءة فقط: لا تُرسل أي إقرار ولا تُرحّل أي قيد. الأرقام من الخادم كما هي، وكل مصدر يتعذّر يظهر «غير متاح»
                        بدل أن يُقرأ صفرًا.
                    </p>
                </>
            ) : null}
        </div>
    );
}
