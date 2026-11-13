import './Mudad.premium.css';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { MudadCredentials } from '../components/MudadCredentials';
import { MudadDelivery } from '../components/MudadDelivery';
import { PrintActions } from '../components/PrintActions';
import { ShellIcon } from '../components/ShellIcons';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { formatInt } from '../lib/inventory-register';
import {
    type BadgeTone,
    type BankPayload,
    type BankUpdateResponse,
    blockerLabel,
    downloadTextFile,
    exportWpsReview,
    fetchGosiPreview,
    fetchGosiRates,
    fetchQiwaReadiness,
    fetchWpsReadiness,
    fetchWpsRequirements,
    gosiBasisLabel,
    gosiReasonLabel,
    issueLabel,
    isValidMonth,
    MUDAD_WRITE_ROLES,
    moneyText,
    NATIONALITY_CATEGORY_LABELS,
    nationalityCategory,
    OFFICIAL_PORTALS,
    previousMonth,
    ratePercent,
    readinessPercent,
    requirementStatusLabel,
    updateEmployeeBank,
    validateBankForm,
    type WpsExportResponse,
    type WpsReadinessEmployee,
} from '../lib/mudad';
import { mudadReviewCsv, mudadReviewFilename, mudadReviewPrintHtml } from '../lib/mudad-print';
import { openBlankTab, writeHtmlDocument } from '../lib/print-document';
import { isWriteRole, useWriteMutation, writeErrorMessage } from '../lib/write';

/**
 * مدد (WPS) والتأمينات وقوى — سطح V3 لعقد GATE 06.
 *
 * كل ما تعرضه الشاشة يأتي من `/api/integration/*` كما هو. لا تُحسب نسب ولا
 * تُخمَّن جنسيات ولا يُوسم أي شيء «مقبول من مدد»: مدد `BLOCKED` بحكم ADR-008،
 * والكشف الناتج «كشف أجور للمراجعة البشرية» وليس SIF ولا يُرفع تلقائيًا.
 *
 * الكتابة الوحيدة: بيانات الصرف (IBAN/جنسية/رقم تأمينات) — admin فقط، ويسبقها
 * تحقق محلي مطابق لدوال الخادم (`mudad.ts`). القراءة admin/manager.
 */

function Badge({ tone, children }: { tone: BadgeTone; children: string }) {
    return (
        <span className="mudad-badge" data-tone={tone}>
            {children}
        </span>
    );
}

function Metric({
    label,
    english,
    value,
    hint,
    tone = 'neutral',
    progress,
}: {
    label: string;
    english: string;
    value: string;
    hint: string;
    tone?: BadgeTone;
    progress?: number;
}) {
    return (
        <li className="mudad-metric" data-tone={tone}>
            <p className="mudad-metric__label">
                {label}{' '}
                <span className="mudad-metric__english" dir="ltr" lang="en">
                    {english}
                </span>
            </p>
            <p className="mudad-metric__value erp-numeric" dir="ltr">
                {value}
            </p>
            {typeof progress === 'number' ? (
                <span
                    aria-hidden="true"
                    className="mudad-metric__meter"
                    style={
                        {
                            '--mudad-progress': String(Math.max(0, Math.min(1, progress / 100))),
                        } as CSSProperties
                    }
                />
            ) : null}
            <p className="mudad-metric__hint">{hint}</p>
        </li>
    );
}

function SectionHead({
    kicker,
    title,
    description,
    children,
}: {
    kicker: string;
    title: string;
    description: string;
    children?: ReactNode;
}) {
    return (
        <div className="mudad-section__head">
            <div className="mudad-section__titles">
                <p className="mudad-section__kicker" dir="ltr" lang="en">
                    {kicker}
                </p>
                <h2 className="mudad-section__title">{title}</h2>
                <p className="mudad-section__desc">{description}</p>
            </div>
            {children ? <div className="mudad-section__actions">{children}</div> : null}
        </div>
    );
}

function Gauge({ percent, ready, employees }: { percent: number; ready: number; employees: number }) {
    const ratio = Math.max(0, Math.min(1, percent / 100));
    return (
        <div className="mudad-gauge">
            <div className="mudad-gauge__ring" style={{ '--mudad-progress': String(ratio) } as CSSProperties}>
                <span className="mudad-gauge__value erp-numeric" dir="ltr">
                    {percent}%
                </span>
                <span className="mudad-gauge__caption">جاهزية الملف</span>
            </div>
            <p className="mudad-gauge__meta">
                <strong className="erp-numeric" dir="ltr">
                    {formatInt(ready)}
                </strong>{' '}
                من{' '}
                <strong className="erp-numeric" dir="ltr">
                    {formatInt(employees)}
                </strong>{' '}
                موظفًا جاهز
            </p>
        </div>
    );
}

type StepState = 'done' | 'pending' | 'locked';

/** دورة المزامنة التلقائية — قراءة فقط، ولا كتابة تلقائية. */
const AUTO_REFRESH_MS = 60_000;

/** وقت آخر تحديث مُعلن من الخادم (`generated_at`). */
function generatedAtText(value: string | null | undefined): string {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

type FlowStep = {
    id: string;
    label: string;
    hint: string;
    state: StepState;
};

const STEP_STATE_LABEL: Record<StepState, string> = {
    done: 'مكتمل',
    pending: 'بانتظار',
    locked: 'يدوي',
};

type BankFormState = {
    employeeId: string;
    name: string;
    iban: string;
    nationality: string;
    gosiNumber: string;
};

/** حروف أولى للاسم — عرضٌ فقط، والاسم الكامل يبقى في الخلية. */
function initialsOf(name: string | null | undefined): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    const letters = parts
        .slice(0, 2)
        .map((part) => part.slice(0, 1))
        .join('');
    return letters || '—';
}

/** نطاق البوابة للعرض فقط (لا يُبنى منه رابط). */
function hostOf(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function Mudad() {
    const auth = useAuthState();
    const role = auth.user?.role ?? '';
    const canWrite = isWriteRole(role, MUDAD_WRITE_ROLES);

    const [month, setMonth] = useState(() => previousMonth());
    const [rateSet, setRateSet] = useState('');
    const [search, setSearch] = useState('');
    const [form, setForm] = useState<BankFormState | null>(null);
    const [formError, setFormError] = useState('');
    const [notice, setNotice] = useState('');
    const [exportError, setExportError] = useState('');
    const [copiedChecksum, setCopiedChecksum] = useState(false);
    const [exportInfo, setExportInfo] = useState<{
        filename: string;
        sha256: string;
        rows: number;
        note: string;
    } | null>(null);

    const requirementsQuery = useQuery({
        queryKey: ['mudad', 'requirements', month],
        queryFn: ({ signal }) => fetchWpsRequirements(month, signal),
        refetchInterval: AUTO_REFRESH_MS,
        refetchOnWindowFocus: true,
    });
    const readinessQuery = useQuery({
        queryKey: ['mudad', 'readiness', month],
        queryFn: ({ signal }) => fetchWpsReadiness(month, signal),
        refetchInterval: AUTO_REFRESH_MS,
        refetchOnWindowFocus: true,
    });
    const ratesQuery = useQuery({
        queryKey: ['mudad', 'gosi-rates'],
        queryFn: ({ signal }) => fetchGosiRates(signal),
        refetchInterval: AUTO_REFRESH_MS,
        refetchOnWindowFocus: true,
    });
    const previewQuery = useQuery({
        queryKey: ['mudad', 'gosi-preview', month, rateSet],
        queryFn: ({ signal }) => fetchGosiPreview(month, rateSet, signal),
        enabled: rateSet !== '',
        refetchInterval: AUTO_REFRESH_MS,
        refetchOnWindowFocus: true,
    });
    const qiwaQuery = useQuery({
        queryKey: ['mudad', 'qiwa'],
        queryFn: ({ signal }) => fetchQiwaReadiness(signal),
        refetchInterval: AUTO_REFRESH_MS,
        refetchOnWindowFocus: true,
    });

    const readiness = readinessQuery.data;
    const summary = readiness?.summary;
    const requirements = requirementsQuery.data?.requirements ?? [];
    const rates = ratesQuery.data?.rates ?? [];
    const preview = previewQuery.data;
    const qiwa = qiwaQuery.data;

    const rows = useMemo(() => {
        const employees = readiness?.employees ?? [];
        const query = search.trim().toLocaleLowerCase();
        if (!query) {
            return employees;
        }
        return employees.filter((employee) =>
            `${employee.name ?? ''} ${employee.employee_id} ${employee.nationality ?? ''}`.toLocaleLowerCase().includes(query),
        );
    }, [readiness?.employees, search]);

    const bankMutation = useWriteMutation<{ id: string; payload: BankPayload }, BankUpdateResponse>({
        mutationFn: ({ id, payload }) => updateEmployeeBank(id, payload),
        successTitle: 'تم حفظ بيانات الصرف',
        invalidate: () => [
            ['mudad', 'readiness', month],
            ['mudad', 'requirements', month],
            ['mudad', 'gosi-preview', month, rateSet],
        ],
        silentError: true,
        onSuccess: () => {
            setForm(null);
            setFormError('');
            setNotice('حُفظت بيانات الصرف بعد التحقق والتدقيق في سجل التكامل.');
        },
        onError: (error) => {
            setFormError(writeErrorMessage(error));
        },
    });

    const exportMutation = useWriteMutation<{ month: string }, WpsExportResponse>({
        mutationFn: ({ month: target }) => exportWpsReview(target),
        silentError: true,
        onSuccess: (data) => {
            setExportError('');
            setCopiedChecksum(false);
            setExportInfo({
                filename: data.filename,
                sha256: data.sha256,
                rows: data.rows,
                note: data.note ?? '',
            });
            downloadTextFile(data.filename, data.csv);
        },
        onError: (error) => {
            setExportInfo(null);
            setExportError(writeErrorMessage(error));
        },
    });

    const canExport = canWrite && readiness?.export_ready === true && !exportMutation.isPending;

    const percent = summary ? readinessPercent(summary) : 0;
    const missingBank = summary ? summary.missing_id + summary.missing_salary + summary.missing_iban + summary.unknown_nationality : 0;

    const steps: FlowStep[] = [
        {
            id: 'bank',
            label: 'بيانات الصرف والهوية',
            hint: !summary
                ? 'بانتظار بيانات الشهر'
                : missingBank
                  ? `${formatInt(missingBank)} بطاقة تحتاج استكمالًا`
                  : 'كل بيانات الصرف مكتملة',
            state: summary && missingBank === 0 ? 'done' : 'pending',
        },
        {
            id: 'payroll',
            label: 'إقفال مسير الشهر',
            hint: summary?.posted ? 'المسير مُقفل (posted)' : 'المسير غير مُقفل بعد',
            state: summary?.posted ? 'done' : 'pending',
        },
        {
            id: 'review',
            label: 'توليد كشف المراجعة',
            hint: readiness?.export_ready ? 'CSV وبصمة SHA-256 جاهزان' : 'محجوب حتى تُستكمل الموانع',
            state: readiness?.export_ready ? 'done' : 'pending',
        },
        {
            id: 'upload',
            label: 'الرفع على مدد',
            hint: 'يدوي بالكامل خارج النظام',
            state: 'locked',
        },
    ];

    function changeMonth(value: string) {
        setMonth(isValidMonth(value) ? value : previousMonth());
        setExportInfo(null);
        setExportError('');
        setCopiedChecksum(false);
        setForm(null);
        setFormError('');
        setNotice('');
    }

    function startEditing(employee: WpsReadinessEmployee) {
        setNotice('');
        setFormError('');
        setForm({
            employeeId: employee.employee_id,
            name: employee.name ?? `#${employee.employee_id}`,
            iban: '',
            nationality: employee.nationality ?? '',
            gosiNumber: '',
        });
    }

    function saveBank(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!form || !canWrite) {
            return;
        }
        const validated = validateBankForm({
            iban: form.iban,
            nationality: form.nationality,
            gosiNumber: form.gosiNumber,
        });
        if (!validated.ok) {
            setFormError(validated.message);
            return;
        }
        setFormError('');
        bankMutation.mutate({ id: form.employeeId, payload: validated.payload });
    }

    async function copyChecksum(value: string) {
        try {
            await navigator.clipboard?.writeText(value);
            setCopiedChecksum(true);
        } catch {
            setCopiedChecksum(false);
        }
    }

    function refreshAll() {
        void requirementsQuery.refetch();
        void readinessQuery.refetch();
        void ratesQuery.refetch();
        void qiwaQuery.refetch();
        if (rateSet) {
            void previewQuery.refetch();
        }
    }

    const selectedRateSet = rates.find((rate) => rate.id === rateSet) ?? null;

    /** ورقة مراجعة A4 — تُبنى من البيانات المحمَّلة نفسها، بلا نداء جديد. */
    function printReviewSheet() {
        if (!readiness) {
            return;
        }
        const win = openBlankTab('ورقة مراجعة الامتثال — ملف الأجور');
        if (!win) {
            setNotice('تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
            return;
        }
        writeHtmlDocument(
            win,
            mudadReviewPrintHtml(readiness, {
                month,
                byName: auth.user?.name ?? '—',
                requirements,
                preview: preview ?? null,
                rateSet: selectedRateSet,
                qiwaChecks: qiwa?.checks ?? [],
            }),
        );
        win.document.querySelector('[data-mudad-print]')?.addEventListener('click', () => win.print());
        win.document.querySelector('[data-mudad-close]')?.addEventListener('click', () => win.close());
    }

    function exportReviewCsv() {
        if (!readiness) {
            return;
        }
        const filename = mudadReviewFilename(month);
        downloadTextFile(
            filename,
            mudadReviewCsv(readiness, {
                month,
                byName: auth.user?.name ?? '—',
                requirements,
                preview: preview ?? null,
                rateSet: selectedRateSet,
                qiwaChecks: qiwa?.checks ?? [],
            }),
        );
        setNotice(`نُزّل ملخّص المراجعة — ${filename}`);
    }

    const refreshing = requirementsQuery.isFetching || readinessQuery.isFetching || ratesQuery.isFetching || qiwaQuery.isFetching;

    return (
        <div className="mudad-premium flex flex-col gap-md">
            <header className="mudad-hero">
                <div className="mudad-hero__text">
                    <p className="mudad-eyebrow">
                        <span className="mudad-eyebrow__mark" aria-hidden="true">
                            <ShellIcon name="shield" className="mudad-eyebrow__icon" />
                        </span>
                        الامتثال العمالي · GATE 06
                    </p>
                    <h1 className="mudad-hero__title">
                        مدد والتأمينات وقوى{' '}
                        <span className="mudad-hero__english" dir="ltr" lang="en">
                            WPS · GOSI · Qiwa
                        </span>
                    </h1>
                    <p className="mudad-hero__lead">
                        جاهزية ملف الأجور وبيانات التأمينات ومتطلبات قوى — قراءة محلية فقط، بلا اتصال حكومي وبلا رفع تلقائي.
                    </p>
                    <ul className="mudad-hero__meta">
                        <li>
                            <span>شهر الملف</span>
                            <strong className="erp-numeric" dir="ltr">
                                {month}
                            </strong>
                        </li>
                        <li>
                            <span>مصدر البيانات</span>
                            <strong>سجلاتنا المحلية</strong>
                        </li>
                        <li>
                            <span>الربط الحكومي</span>
                            <strong data-tone="warning">معطّل</strong>
                        </li>
                        <li>
                            <span>المزامنة التلقائية</span>
                            <strong className="erp-numeric" dir="ltr">
                                كل {AUTO_REFRESH_MS / 1000} ثانية
                            </strong>
                        </li>
                        <li>
                            <span>آخر تحديث</span>
                            <strong className="erp-numeric" dir="ltr">
                                {generatedAtText(readiness?.generated_at ?? requirementsQuery.data?.generated_at)}
                            </strong>
                        </li>
                    </ul>
                </div>
                <div className="mudad-hero__actions">
                    <PrintActions title="مدد والتأمينات وقوى" />
                    <button type="button" onClick={printReviewSheet} disabled={!readiness} className="mudad-btn">
                        طباعة ورقة المراجعة
                    </button>
                    <button type="button" onClick={exportReviewCsv} disabled={!readiness} className="mudad-btn">
                        تنزيل ملخّص CSV
                    </button>
                    <button type="button" onClick={refreshAll} disabled={refreshing} className="mudad-btn mudad-btn--primary">
                        {refreshing ? 'جارٍ التحديث…' : 'تحديث البيانات'}
                    </button>
                </div>
            </header>

            <aside className="mudad-notice" aria-label="حالة التكامل مع مدد">
                <span className="mudad-notice__icon" aria-hidden="true">
                    <ShellIcon name="shield" />
                </span>
                <div className="mudad-notice__body">
                    <p className="mudad-notice__title">
                        مدد يبقى <strong dir="ltr">BLOCKED</strong> — لا اتصال حكومي ولا رفع تلقائي.
                    </p>
                    <p className="mudad-notice__text">
                        الكشف الذي تُولّده الشاشة هو «كشف أجور للمراجعة البشرية» وليس ملف SIF، ولا يُوسم أي شيء «مقبول من مدد».
                    </p>
                </div>
                <ul className="mudad-notice__chips">
                    <li>بيانات محلية فقط</li>
                    <li>رفع يدوي</li>
                    <li>مراجعة بشرية</li>
                </ul>
            </aside>

            <Card className="mudad-section">
                <SectionHead
                    kicker="01 · WPS readiness"
                    title="جاهزية ملف الأجور"
                    description="الشهر الافتراضي هو الشهر السابق، كما في الخادم. الحالة تعبّر عن بياناتنا فقط."
                >
                    <label className="mudad-field" htmlFor="erp-mudad-month">
                        شهر الملف
                        <input id="erp-mudad-month" type="month" value={month} onChange={(event) => changeMonth(event.target.value)} />
                    </label>
                </SectionHead>
                <div className="mudad-section__body">
                    {summary ? (
                        <>
                            <ul className="mudad-metrics" aria-label="مؤشرات جاهزية ملف الأجور">
                                <Metric
                                    label="الموظفون النشطون"
                                    english="Active employees"
                                    value={formatInt(summary.employees)}
                                    hint="من يشمله ملف الشهر"
                                />
                                <Metric
                                    label="الجاهزون"
                                    english="Ready"
                                    value={formatInt(summary.ready)}
                                    hint={`${formatInt(percent)}% جاهزية`}
                                    tone={percent === 100 ? 'success' : 'warning'}
                                    progress={percent}
                                />
                                <Metric
                                    label="الموانع"
                                    english="Blockers"
                                    value={formatInt(readiness?.blockers.length ?? 0)}
                                    hint="كل مانع يمنع توليد الكشف"
                                    tone={(readiness?.blockers.length ?? 0) > 0 ? 'danger' : 'success'}
                                />
                                <Metric
                                    label="حالة المسير"
                                    english="Payroll status"
                                    value={summary.posted ? 'posted' : 'غير مُقفل'}
                                    hint={summary.employer_identifier ? 'السجل التجاري مضبوط' : 'السجل التجاري غير مضبوط'}
                                    tone={summary.posted ? 'success' : 'warning'}
                                />
                            </ul>

                            <div className="mudad-deck">
                                <div className="mudad-panel">
                                    <p className="mudad-panel__title">
                                        نسبة الجاهزية{' '}
                                        <span className="mudad-panel__english" dir="ltr" lang="en">
                                            Readiness
                                        </span>
                                    </p>
                                    <Gauge percent={percent} ready={summary.ready} employees={summary.employees} />
                                </div>

                                <div className="mudad-panel">
                                    <p className="mudad-panel__title">
                                        مسار الملف{' '}
                                        <span className="mudad-panel__english" dir="ltr" lang="en">
                                            Workflow
                                        </span>
                                    </p>
                                    <ol className="mudad-pipeline">
                                        {steps.map((step, index) => (
                                            <li key={step.id} className="mudad-step" data-state={step.state}>
                                                <span className="mudad-step__index" aria-hidden="true">
                                                    {String(index + 1).padStart(2, '0')}
                                                </span>
                                                <span className="mudad-step__body">
                                                    <span className="mudad-step__label">{step.label}</span>
                                                    <span className="mudad-step__hint">{step.hint}</span>
                                                </span>
                                                <span className="mudad-step__state">{STEP_STATE_LABEL[step.state]}</span>
                                            </li>
                                        ))}
                                    </ol>
                                </div>

                                {readiness ? (
                                    readiness.blockers.length ? (
                                        <div className="mudad-callout" data-tone="danger">
                                            <h3 className="mudad-callout__title">موانع تمنع توليد الكشف</h3>
                                            <ul className="mudad-callout__list">
                                                {readiness.blockers.map((code) => (
                                                    <li key={code}>
                                                        {blockerLabel(code)}
                                                        <span className="mudad-callout__code" dir="ltr">
                                                            {code}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : (
                                        <div className="mudad-callout" data-tone="success">
                                            <h3 className="mudad-callout__title">لا موانع لهذا الشهر</h3>
                                            <p>الكشف جاهز للمراجعة البشرية، والرفع على مدد يبقى يدويًا.</p>
                                        </div>
                                    )
                                ) : null}
                            </div>
                        </>
                    ) : null}

                    {readinessQuery.isPending ? (
                        <div aria-busy="true">
                            <StateLoading label="جارٍ تحميل جاهزية ملف الأجور" />
                            <TableSkeleton rows={3} columns={4} />
                        </div>
                    ) : null}
                    {readinessQuery.isError ? (
                        <StateError
                            message={readinessQuery.error instanceof Error ? readinessQuery.error.message : 'تعذّر تحميل جاهزية ملف الأجور'}
                            onRetry={() => {
                                void readinessQuery.refetch();
                            }}
                        />
                    ) : null}
                    {readiness?.note ? <p className="mudad-footnote">{readiness.note}</p> : null}
                    <p className="mudad-footnote">
                        آخر تحديث من الخادم:{' '}
                        <span className="erp-numeric" dir="ltr">
                            {generatedAtText(readiness?.generated_at)}
                        </span>{' '}
                        · {readinessQuery.isFetching ? 'جارٍ التحديث…' : 'المزامنة التلقائية كل 60 ثانية'}
                    </p>
                </div>
            </Card>

            <Card className="mudad-section">
                <SectionHead
                    kicker="02 · Mudad requirements"
                    title="متطلبات مدد"
                    description="متطلبات نظامية للملف؛ الحالة تعبّر عن جاهزية بياناتنا وليست قبولًا حكوميًا."
                />
                <div className="mudad-section__body">
                    {requirementsQuery.isError ? (
                        <StateError
                            message={requirementsQuery.error instanceof Error ? requirementsQuery.error.message : 'تعذّر تحميل المتطلبات'}
                            onRetry={() => {
                                void requirementsQuery.refetch();
                            }}
                        />
                    ) : requirementsQuery.isPending ? (
                        <TableSkeleton rows={5} columns={4} />
                    ) : requirements.length ? (
                        <div className="mudad-table">
                            <TableScroll label="متطلبات مدد وحالتها">
                                <table className="w-full border-collapse">
                                    <caption className="sr-only">متطلبات ملف الأجور وحالة كل متطلب</caption>
                                    <thead>
                                        <tr>
                                            <th scope="col">المتطلب</th>
                                            <th scope="col">الحالة</th>
                                            <th scope="col">التفصيل</th>
                                            <th scope="col">المصدر</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {requirements.map((requirement) => {
                                            const status = requirementStatusLabel(requirement.status);
                                            return (
                                                <tr key={requirement.id}>
                                                    <th scope="row">
                                                        <span className="mudad-person__name">{requirement.title_ar}</span>
                                                        <span className="mudad-person__id">{requirement.requirement}</span>
                                                    </th>
                                                    <td>
                                                        <Badge tone={status.tone}>{status.label}</Badge>
                                                    </td>
                                                    <td className="text-muted">{requirement.detail ?? '—'}</td>
                                                    <td className="mudad-mono text-muted">{requirement.source ?? '—'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </TableScroll>
                        </div>
                    ) : (
                        <StateEmpty title="لا متطلبات معلنة" hint="راجع مسار /api/integration/wps/requirements ثم أعد المحاولة." />
                    )}
                    {requirementsQuery.data?.note ? <p className="mudad-footnote">{requirementsQuery.data.note}</p> : null}
                    <p className="mudad-footnote">
                        آخر تحديث:{' '}
                        <span className="erp-numeric" dir="ltr">
                            {generatedAtText(requirementsQuery.data?.generated_at)}
                        </span>
                    </p>
                </div>
            </Card>

            <Card className="mudad-section">
                <SectionHead
                    kicker="03 · Employee readiness"
                    title="بيانات الصرف والجاهزية لكل موظف"
                    description="IBAN يظهر مقنّعًا؛ الاستكمال متاح للأدمن فقط ويُدقَّق في سجل التكامل."
                >
                    <label className="mudad-field" htmlFor="erp-mudad-search">
                        بحث
                        <input
                            id="erp-mudad-search"
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="الاسم أو الرقم أو الجنسية…"
                        />
                    </label>
                </SectionHead>
                <div className="mudad-section__body">
                    {notice ? (
                        <p role="status" aria-live="polite" className="mudad-form__notice">
                            {notice}
                        </p>
                    ) : null}

                    {form ? (
                        <form onSubmit={saveBank} className="mudad-form">
                            <div className="mudad-form__head">
                                <h3 className="mudad-form__title">
                                    استكمال بيانات الصرف — {form.name}
                                    <span className="mudad-form__id" dir="ltr">
                                        #{form.employeeId}
                                    </span>
                                </h3>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setForm(null);
                                        setFormError('');
                                    }}
                                    className="mudad-btn mudad-btn--small"
                                >
                                    إلغاء
                                </button>
                            </div>
                            <label className="mudad-field" htmlFor="erp-mudad-iban">
                                IBAN سعودي
                                <input
                                    id="erp-mudad-iban"
                                    value={form.iban}
                                    onChange={(event) => setForm({ ...form, iban: event.target.value })}
                                    placeholder="SA…"
                                    dir="ltr"
                                    maxLength={34}
                                    className="mudad-mono"
                                />
                                <span className="mudad-hint">اتركه فارغًا للإبقاء على القيمة الحالية — لا يُعرض IBAN كاملًا في القائمة.</span>
                            </label>
                            <label className="mudad-field" htmlFor="erp-mudad-nationality">
                                الجنسية (ISO من حرفين)
                                <input
                                    id="erp-mudad-nationality"
                                    value={form.nationality}
                                    onChange={(event) => setForm({ ...form, nationality: event.target.value })}
                                    placeholder="SA"
                                    dir="ltr"
                                    maxLength={2}
                                    className="mudad-mono uppercase"
                                />
                            </label>
                            <label className="mudad-field" htmlFor="erp-mudad-gosi">
                                رقم التأمينات
                                <input
                                    id="erp-mudad-gosi"
                                    value={form.gosiNumber}
                                    onChange={(event) => setForm({ ...form, gosiNumber: event.target.value })}
                                    placeholder="6–12 رقمًا"
                                    dir="ltr"
                                    inputMode="numeric"
                                    maxLength={12}
                                    className="mudad-mono"
                                />
                                <span className="mudad-hint">رقم التأمينات لا يُولَّد تلقائيًا؛ اتركه فارغًا للإبقاء على المسجّل حاليًا.</span>
                            </label>
                            <div className="mudad-form__footer">
                                <button type="submit" disabled={bankMutation.isPending} className="mudad-btn mudad-btn--primary">
                                    {bankMutation.isPending ? 'جارٍ الحفظ…' : 'حفظ بيانات الصرف'}
                                </button>
                                <span className="mudad-hint">يتحقق النظام محليًا من IBAN والجنسية ورقم التأمينات قبل الإرسال.</span>
                            </div>
                            {formError ? (
                                <p role="alert" className="mudad-form__error">
                                    {formError}
                                </p>
                            ) : null}
                        </form>
                    ) : null}

                    {readinessQuery.isPending ? (
                        <TableSkeleton rows={5} columns={7} />
                    ) : rows.length ? (
                        <div className="mudad-table">
                            <TableScroll label="جاهزية بيانات الصرف لكل موظف">
                                <table className="w-full border-collapse">
                                    <caption className="sr-only">الموظفون النشطون وحالة هويتهم وIBAN وجنسيتهم ورقم تأميناتهم</caption>
                                    <thead>
                                        <tr>
                                            <th scope="col">الموظف</th>
                                            <th scope="col">الهوية/الإقامة</th>
                                            <th scope="col">IBAN</th>
                                            <th scope="col">الجنسية</th>
                                            <th scope="col">الراتب</th>
                                            <th scope="col">النواقص</th>
                                            <th scope="col">الجاهزية</th>
                                            {canWrite ? <th scope="col">إجراء</th> : null}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((employee) => (
                                            <tr key={employee.employee_id}>
                                                <th scope="row">
                                                    <span className="mudad-person">
                                                        <span className="mudad-avatar" aria-hidden="true">
                                                            {initialsOf(employee.name)}
                                                        </span>
                                                        <span className="mudad-person__text">
                                                            <span className="mudad-person__name">{employee.name ?? '—'}</span>
                                                            <span className="mudad-person__id" dir="ltr">
                                                                #{employee.employee_id}
                                                            </span>
                                                        </span>
                                                    </span>
                                                </th>
                                                <td className="mudad-mono" dir="ltr">
                                                    {employee.id_number ?? '—'}
                                                </td>
                                                <td className="mudad-mono" dir="ltr">
                                                    {employee.iban_masked ?? '—'}
                                                </td>
                                                <td className="text-muted">
                                                    {NATIONALITY_CATEGORY_LABELS[nationalityCategory(employee.nationality)]}
                                                </td>
                                                <td className="erp-numeric" dir="ltr">
                                                    {moneyText(employee.salary)}
                                                </td>
                                                <td>
                                                    {employee.issues.length ? (
                                                        <ul className="mudad-issues">
                                                            {employee.issues.map((code) => (
                                                                <li key={code}>
                                                                    <Badge tone="warning">{issueLabel(code)}</Badge>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        <span className="text-caption text-muted">—</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <Badge tone={employee.ready ? 'success' : 'danger'}>
                                                        {employee.ready ? 'جاهز' : 'غير جاهز'}
                                                    </Badge>
                                                </td>
                                                {canWrite ? (
                                                    <td>
                                                        <button
                                                            type="button"
                                                            onClick={() => startEditing(employee)}
                                                            className="mudad-btn mudad-btn--small"
                                                        >
                                                            تعديل بيانات الصرف
                                                        </button>
                                                    </td>
                                                ) : null}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        </div>
                    ) : (
                        <StateEmpty
                            title={search ? 'لا موظفون مطابقون' : 'لا موظفون نشطون'}
                            hint={search ? 'امسح البحث أو غيّر كلماته.' : 'يظهر الموظفون النشطون فقط في هذا الملف.'}
                        />
                    )}
                </div>
            </Card>

            <Card className="mudad-section">
                <SectionHead
                    kicker="04 · Review sheet"
                    title="كشف أجور للمراجعة البشرية"
                    description="CSV ببصمة SHA-256 — للمراجعة والرفع اليدوي. ليس SIF، ولا يُرفع إلى مدد."
                >
                    <button
                        type="button"
                        disabled={!canExport}
                        onClick={() => {
                            exportMutation.mutate({ month });
                        }}
                        className="mudad-btn mudad-btn--primary"
                    >
                        {exportMutation.isPending ? 'جارٍ التوليد…' : 'توليد وتنزيل الكشف'}
                    </button>
                </SectionHead>
                <div className="mudad-section__body">
                    {!canWrite ? (
                        <p className="mudad-hint">
                            توليد الكشف يحتاج صلاحية <span dir="ltr">admin</span> (compliance.submit).
                        </p>
                    ) : null}
                    {canWrite && readiness && !readiness.export_ready ? (
                        <div className="mudad-callout" data-tone="warning">
                            <h3 className="mudad-callout__title">التوليد محجوب مؤقتًا</h3>
                            <p>الموانع أعلاه تمنع التوليد — يعيد الخادم 409 حتى تُستكمل كل البيانات ويُقفل المسير.</p>
                        </div>
                    ) : null}
                    {exportError ? (
                        <p role="alert" className="mudad-form__error">
                            {exportError}
                        </p>
                    ) : null}
                    {exportInfo ? (
                        <div className="mudad-result">
                            <div className="mudad-result__head">
                                <span className="mudad-result__icon" aria-hidden="true">
                                    ✓
                                </span>
                                <div>
                                    <p className="mudad-result__title">الكشف جاهز للمراجعة</p>
                                    <p className="mudad-result__sub">بدأ تنزيل الملف — احتفظ بالبصمة لتدقيق الرفع اليدوي.</p>
                                </div>
                            </div>
                            <dl className="mudad-result__grid">
                                <div>
                                    <dt>الملف</dt>
                                    <dd className="mudad-mono" dir="ltr">
                                        {exportInfo.filename}
                                    </dd>
                                </div>
                                <div>
                                    <dt>عدد الصفوف</dt>
                                    <dd className="erp-numeric" dir="ltr">
                                        {formatInt(exportInfo.rows)}
                                    </dd>
                                </div>
                                <div className="mudad-result__wide">
                                    <dt>بصمة SHA-256</dt>
                                    <dd>
                                        <span className="mudad-hash" dir="ltr">
                                            {exportInfo.sha256}
                                        </span>
                                    </dd>
                                </div>
                                {exportInfo.note ? (
                                    <div className="mudad-result__wide">
                                        <dt>ملاحظة الخادم</dt>
                                        <dd className="text-muted">{exportInfo.note}</dd>
                                    </div>
                                ) : null}
                            </dl>
                            <div className="mudad-result__actions">
                                <button
                                    type="button"
                                    onClick={() => {
                                        void copyChecksum(exportInfo.sha256);
                                    }}
                                    className="mudad-btn mudad-btn--small"
                                >
                                    نسخ البصمة
                                </button>
                                {copiedChecksum ? (
                                    <span className="text-caption text-success-text" role="status">
                                        نُسخت البصمة إلى الحافظة.
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                </div>
            </Card>

            <Card className="mudad-section">
                <SectionHead
                    kicker="05 · GOSI preview"
                    title="التأمينات الاجتماعية"
                    description="مجموعات النسب غير موثّقة داخل النظام؛ تُختار صراحةً ولا تُطبَّق على أي قيد."
                />
                <div className="mudad-section__body">
                    {ratesQuery.isError ? (
                        <StateError
                            message={ratesQuery.error instanceof Error ? ratesQuery.error.message : 'تعذّر تحميل نسب التأمينات'}
                            onRetry={() => {
                                void ratesQuery.refetch();
                            }}
                        />
                    ) : null}
                    {ratesQuery.isPending ? <TableSkeleton rows={3} columns={5} /> : null}
                    {rates.length ? (
                        <fieldset className="mudad-rates">
                            <legend className="mudad-rates__legend">اختر مجموعة النسب صراحةً — لا افتراض تلقائي</legend>
                            <div className="mudad-rates__grid">
                                {rates.map((rate) => (
                                    <label key={rate.id} className="mudad-rate" data-active={rateSet === rate.id ? 'true' : 'false'}>
                                        <input
                                            type="radio"
                                            name="mudad-gosi-rate-set"
                                            value={rate.id}
                                            checked={rateSet === rate.id}
                                            onChange={() => setRateSet(rate.id)}
                                            className="mudad-rate__input"
                                        />
                                        <span className="mudad-rate__dot" aria-hidden="true" />
                                        <span className="mudad-rate__body">
                                            <span className="mudad-rate__title">{rate.label_ar}</span>
                                            <span className="mudad-rate__grid">
                                                <span className="mudad-rate__pair">
                                                    <span className="mudad-rate__pair-label">سعودي — موظف / صاحب العمل</span>
                                                    <span className="mudad-rate__pair-value" dir="ltr">
                                                        {ratePercent(rate.saudi.employee_bp)} / {ratePercent(rate.saudi.employer_bp)}
                                                    </span>
                                                </span>
                                                <span className="mudad-rate__pair">
                                                    <span className="mudad-rate__pair-label">وافد — موظف / صاحب العمل</span>
                                                    <span className="mudad-rate__pair-value" dir="ltr">
                                                        {ratePercent(rate.expat.employee_bp)} / {ratePercent(rate.expat.employer_bp)}
                                                    </span>
                                                </span>
                                            </span>
                                            {rate.note ? <span className="mudad-rate__note">{rate.note}</span> : null}
                                            <span>
                                                <Badge tone={rate.verified ? 'success' : 'warning'}>
                                                    {rate.verified ? 'موثّقة' : 'غير موثّقة'}
                                                </Badge>
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    ) : null}
                    {ratesQuery.data?.note ? <p className="mudad-footnote">{ratesQuery.data.note}</p> : null}
                    {ratesQuery.data?.minimum_contributory_wage_note ? (
                        <p className="mudad-hint text-warning-text">{ratesQuery.data.minimum_contributory_wage_note}</p>
                    ) : null}

                    {!rateSet ? (
                        <StateEmpty title="لم تُختر مجموعة نسب" hint="لا افتراض تلقائي للنسب — اختر مجموعة صراحةً لعرض الحساب التقديري." />
                    ) : null}
                    {previewQuery.isPending && rateSet ? <TableSkeleton rows={4} columns={6} /> : null}
                    {previewQuery.isError ? (
                        <StateError
                            message={previewQuery.error instanceof Error ? previewQuery.error.message : 'تعذّر حساب معاينة التأمينات'}
                            onRetry={() => {
                                void previewQuery.refetch();
                            }}
                        />
                    ) : null}
                    {preview ? (
                        <>
                            <div className="mudad-inline-status">
                                <span>
                                    الأساس: <strong>{gosiBasisLabel(preview.basis)}</strong>
                                </span>
                                <Badge tone={preview.estimate ? 'warning' : 'success'}>
                                    {preview.estimate ? 'تقديري — المسير غير مُقفل' : 'من وعاء المسير'}
                                </Badge>
                                <Badge tone={preview.rate_set.verified ? 'success' : 'warning'}>
                                    {preview.rate_set.verified ? 'نسب موثّقة' : 'نسب غير موثّقة'}
                                </Badge>
                                <span className="text-muted">{preview.rate_set.label_ar}</span>
                            </div>
                            <ul className="mudad-metrics" aria-label="إجماليات معاينة التأمينات">
                                <Metric
                                    label="حصة الموظف"
                                    english="Employee"
                                    value={moneyText(preview.totals.employee)}
                                    hint="عرض فقط — لا خصم ولا قيد"
                                />
                                <Metric
                                    label="حصة صاحب العمل"
                                    english="Employer"
                                    value={moneyText(preview.totals.employer)}
                                    hint="عرض فقط — لا قيد"
                                />
                                <Metric
                                    label="الإجمالي"
                                    english="Total"
                                    value={moneyText(preview.totals.total)}
                                    hint={`${formatInt(preview.lines.length)} صفًا محسوبًا`}
                                    tone="warning"
                                />
                            </ul>
                            {preview.lines.length ? (
                                <div className="mudad-table">
                                    <TableScroll label="معاينة اشتراكات التأمينات">
                                        <table className="w-full border-collapse">
                                            <caption className="sr-only">حساب عرض لاشتراكات التأمينات لكل موظف</caption>
                                            <thead>
                                                <tr>
                                                    <th scope="col">الموظف</th>
                                                    <th scope="col">التصنيف</th>
                                                    <th scope="col">الأجر</th>
                                                    <th scope="col">الأساس</th>
                                                    <th scope="col">الموظف</th>
                                                    <th scope="col">صاحب العمل</th>
                                                    <th scope="col">الإجمالي</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {preview.lines.map((line) => (
                                                    <tr key={line.employee_id}>
                                                        <th scope="row">
                                                            <span className="mudad-person__name">{line.name ?? '—'}</span>
                                                            <span className="mudad-person__id" dir="ltr">
                                                                #{line.employee_id}
                                                            </span>
                                                        </th>
                                                        <td>
                                                            {
                                                                NATIONALITY_CATEGORY_LABELS[
                                                                    line.category === 'saudi'
                                                                        ? 'saudi'
                                                                        : line.category === 'expat'
                                                                          ? 'expat'
                                                                          : 'unknown'
                                                                ]
                                                            }
                                                            {line.below_minimum ? (
                                                                <span className="mt-xxs block">
                                                                    <Badge tone="warning">أقل من الحد الأدنى</Badge>
                                                                </span>
                                                            ) : null}
                                                        </td>
                                                        <td className="erp-numeric" dir="ltr">
                                                            {moneyText(line.wage)}
                                                        </td>
                                                        <td className="text-muted">{gosiBasisLabel(line.basis)}</td>
                                                        <td className="erp-numeric" dir="ltr">
                                                            {moneyText(line.employee)}
                                                        </td>
                                                        <td className="erp-numeric" dir="ltr">
                                                            {moneyText(line.employer)}
                                                        </td>
                                                        <td className="erp-numeric font-semibold" dir="ltr">
                                                            {moneyText(line.total)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </TableScroll>
                                </div>
                            ) : (
                                <StateEmpty title="لا صفوف محسوبة" hint="راجع الجنسية والأجر الأساسي لكل موظف ثم أعد المحاولة." />
                            )}
                            {preview.unclassified.length ? (
                                <div className="mudad-callout" data-tone="warning">
                                    <h3 className="mudad-callout__title">لم يُصنَّف تأمينيًا</h3>
                                    <ul className="mudad-callout__list">
                                        {preview.unclassified.map((entry) => (
                                            <li key={entry.employee_id}>
                                                {entry.name ?? `#${entry.employee_id}`} — {gosiReasonLabel(entry.reason)}
                                                <span className="mudad-callout__code" dir="ltr">
                                                    {entry.reason}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                            {preview.warnings.length ? (
                                <ul className="mudad-notes">
                                    {preview.warnings.map((warning) => (
                                        <li key={warning}>{warning}</li>
                                    ))}
                                </ul>
                            ) : null}
                            <p className="mudad-footnote">
                                آخر تحديث:{' '}
                                <span className="erp-numeric" dir="ltr">
                                    {generatedAtText(preview.generated_at)}
                                </span>
                            </p>
                        </>
                    ) : null}
                </div>
            </Card>

            <Card className="mudad-section">
                <SectionHead
                    kicker="06 · Qiwa readiness"
                    title="جاهزية قوى"
                    description="فحص بيانات محلي فقط — لا ربط API مع قوى ولا إرسال."
                />
                <div className="mudad-section__body">
                    {qiwaQuery.isError ? (
                        <StateError
                            message={qiwaQuery.error instanceof Error ? qiwaQuery.error.message : 'تعذّر قراءة جاهزية قوى'}
                            onRetry={() => {
                                void qiwaQuery.refetch();
                            }}
                        />
                    ) : qiwaQuery.isPending ? (
                        <TableSkeleton rows={4} columns={3} />
                    ) : qiwa ? (
                        <>
                            <p className="mudad-inline-status">
                                <span>النتيجة:</span>
                                <Badge tone={qiwa.ready ? 'success' : 'warning'}>
                                    {qiwa.ready ? 'جاهزية بيانات محلية كاملة' : 'نواقص تحتاج استكمالًا'}
                                </Badge>
                                <span className="mudad-mono text-muted" dir="ltr">
                                    {qiwa.provider.code} · {qiwa.provider.verification}
                                </span>
                            </p>
                            <ul className="mudad-checks">
                                {qiwa.checks.map((check) => (
                                    <li key={check.id}>
                                        <span className="mudad-checks__label">
                                            {check.label_ar}
                                            <span className="mudad-checks__id" dir="ltr">
                                                {check.id}
                                            </span>
                                        </span>
                                        <Badge tone={check.ok ? 'success' : 'danger'}>{check.ok ? 'مستوفى' : 'ناقص'}</Badge>
                                        <span className="mudad-checks__detail">{check.detail}</span>
                                    </li>
                                ))}
                            </ul>
                            {qiwa.note ? <p className="mudad-footnote">{qiwa.note}</p> : null}
                            <p className="mudad-footnote">
                                آخر تحديث:{' '}
                                <span className="erp-numeric" dir="ltr">
                                    {generatedAtText(qiwa.generated_at)}
                                </span>
                            </p>
                        </>
                    ) : null}
                </div>
            </Card>

            <MudadDelivery writable={canWrite} />

            {canWrite ? <MudadCredentials /> : null}

            <Card className="mudad-section">
                <SectionHead
                    kicker="07 · Official portals"
                    title="البوابات الرسمية"
                    description="روابط للفتح اليدوي فقط — لا اتصال برمجي ولا رفع تلقائي من النظام."
                />
                <div className="mudad-section__body">
                    <ul className="mudad-portals">
                        {OFFICIAL_PORTALS.map((portal) => (
                            <li key={portal.id}>
                                <a href={portal.url} target="_blank" rel="noopener noreferrer" className="mudad-portal">
                                    <span className="mudad-portal__text">
                                        <span className="mudad-portal__label">{portal.label}</span>
                                        <span className="mudad-portal__url" dir="ltr">
                                            {hostOf(portal.url)}
                                        </span>
                                    </span>
                                    <span className="mudad-portal__arrow" aria-hidden="true">
                                        ↗
                                    </span>
                                </a>
                            </li>
                        ))}
                    </ul>
                    <p className="mudad-footnote">
                        ADR-008: مدد <span dir="ltr">BLOCKED</span> — لا عميل HTTP حكومي ولا رفع تلقائي؛ الكشف الناتج أداة مراجعة بشرية فقط.
                    </p>
                </div>
            </Card>
        </div>
    );
}
