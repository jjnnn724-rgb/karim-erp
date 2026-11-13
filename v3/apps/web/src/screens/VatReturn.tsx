import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { StateError, StateLoading } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchCurrency } from '../lib/finance';
import { openBlankTab, writeHtmlDocument } from '../lib/print-document';
import { errorMessage, intOf, moneyOf, num, presetRange, rangeProblem } from '../lib/reporting';
import {
    applyVatSettlement,
    fetchVatReturn,
    fetchVatSettlementPreview,
    isFullMonth,
    VAT_RATE_LABELS,
    VAT_SETTLEMENT_WRITE_ROLES,
    type VatRateRow,
    type VatSettlement,
    type VatWorksheetRow,
    type VatWorksheetStatus,
    vatBalanceReconciliation,
    vatFilingDeadline,
    vatMonthRange,
    vatPeriodMonth,
    vatRateNeedsReview,
    vatRateRows,
    vatRateSummary,
    vatWorksheet,
} from '../lib/vat-return';
import { vatReviewCsv, vatReviewFilename, vatReviewPrintHtml } from '../lib/vat-return-print';
import { isWriteRole, useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';

type DateRange = { from: string; to: string };

/** تسميات نوع المستند في جدول تصنيف المعدلات. */
const KIND_LABELS: Record<VatRateRow['kind'], string> = {
    sale: 'بيع',
    void: 'إلغاء',
    purchase: 'شراء',
};

/** حالة خانة الإقرار — اللون يفرّق بين «جاهزة» و«غير مسجّلة» لا بين أرقام. */
const WORKSHEET_STATUS: Record<VatWorksheetStatus, { label: string; className: string }> = {
    ready: { label: 'جاهزة', className: 'border-success text-success-text' },
    review: { label: 'تحتاج مراجعة', className: 'border-warning text-warning-text' },
    missing: { label: 'بيانات ناقصة', className: 'border-danger text-danger-text' },
    unavailable: { label: 'غير مسجّلة', className: 'border-hairline-strong text-muted' },
};

function WorksheetStatusBadge({ status, note }: { status: VatWorksheetStatus; note: string }) {
    const meta = WORKSHEET_STATUS[status];
    return (
        <span
            title={note}
            className={`inline-flex whitespace-nowrap rounded-full border px-sm py-xxs text-body-sm font-medium ${meta.className}`}
        >
            {meta.label}
        </span>
    );
}

/**
 * جدول خانات الإقرار — الرقم `null` يُعرض «—» لأنه «غير مسجّل في النظام»،
 * وليس صفرًا. الخلط بينهما هو أخطر خطأ في إقرار ضريبي.
 */
function WorksheetTable({
    title,
    caption,
    rows,
    total,
    totalLabel,
    available,
}: {
    title: string;
    caption: string;
    rows: readonly VatWorksheetRow[];
    total: { base: number; vat: number; documents: number };
    totalLabel: string;
    available: boolean;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-xs">
            <h3 className="text-label-md font-medium text-ink-secondary">{title}</h3>
            <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                    <caption className="sr-only">{caption}</caption>
                    <thead>
                        <tr>
                            {['الخانة', 'البند', 'الوعاء الضريبي', 'الضريبة', 'المستندات', 'الحالة'].map((label, index) => (
                                <th
                                    key={label}
                                    scope="col"
                                    className={`border-b border-hairline bg-surface-sunken px-sm py-xs text-label-md font-medium text-ink-secondary ${
                                        index >= 2 && index <= 4 ? 'text-end' : 'text-start'
                                    }`}
                                >
                                    {label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.key}>
                                <td dir="ltr" className="border-b border-hairline px-sm py-xxs text-start text-ink erp-numeric">
                                    {row.box === null ? '—' : String(row.box)}
                                </td>
                                <td className="border-b border-hairline px-sm py-xxs text-ink">
                                    {row.label}
                                    {row.status !== 'ready' ? (
                                        <span className="mt-xxs block text-body-sm text-muted">{row.note}</span>
                                    ) : null}
                                </td>
                                <td dir="ltr" className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric">
                                    {row.base === null ? '—' : moneyOf(row.base)}
                                </td>
                                <td dir="ltr" className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric">
                                    {row.vat === null ? '—' : moneyOf(row.vat)}
                                </td>
                                <td dir="ltr" className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric">
                                    {available ? String(row.documents) : '—'}
                                </td>
                                <td className="border-b border-hairline px-sm py-xxs">
                                    <WorksheetStatusBadge status={row.status} note={row.note} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            <th scope="row" colSpan={2} className="px-sm py-xs text-start text-label-md text-ink">
                                {totalLabel}
                            </th>
                            <td dir="ltr" className="px-sm py-xs text-end text-ink erp-numeric">
                                {available ? moneyOf(total.base) : '—'}
                            </td>
                            <td dir="ltr" className="px-sm py-xs text-end text-ink erp-numeric">
                                {available ? moneyOf(total.vat) : '—'}
                            </td>
                            <td dir="ltr" className="px-sm py-xs text-end text-ink erp-numeric">
                                {available ? String(total.documents) : '—'}
                            </td>
                            <td className="px-sm py-xs">
                                <span className={`text-body-sm ${available ? 'text-muted' : 'text-warning-text'}`}>
                                    {available ? 'مجموع الخانات المسجّلة' : 'الكشف غير متاح'}
                                </span>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}

/** مطابقة رصيد واحد: افتتاحي + حركة متوقعة من القيود = ختامي، والفرق يُبرز. */
function ReconciliationRow({
    label,
    opening,
    expected,
    actual,
    gap,
    closing,
    asOf,
}: {
    label: string;
    opening: number;
    expected: number;
    actual: number;
    gap: number;
    closing: number;
    asOf: string;
}) {
    const mismatch = Math.abs(gap) > 0.01;
    return (
        <div className="flex min-w-0 flex-col gap-xs rounded-lg border border-hairline bg-surface p-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-sm">
                <h3 className="text-label-md font-medium text-ink">{label}</h3>
                <span className="text-body-sm text-muted">
                    افتتاحي حتى <span dir="ltr">{asOf}</span>
                </span>
            </div>
            <dl className="flex flex-col gap-xxs text-body-sm">
                <div className="flex items-center justify-between gap-sm">
                    <dt className="text-muted">الرصيد الافتتاحي</dt>
                    <dd dir="ltr" className="erp-numeric text-ink">
                        {moneyOf(opening)}
                    </dd>
                </div>
                <div className="flex items-center justify-between gap-sm">
                    <dt className="text-muted">حركة الفترة المتوقعة من القيود</dt>
                    <dd dir="ltr" className="erp-numeric text-ink">
                        {moneyOf(expected)}
                    </dd>
                </div>
                <div className="flex items-center justify-between gap-sm">
                    <dt className="text-muted">حركة الفترة في الأستاذ</dt>
                    <dd dir="ltr" className="erp-numeric text-ink">
                        {moneyOf(actual)}
                    </dd>
                </div>
                <div className="flex items-center justify-between gap-sm">
                    <dt className={mismatch ? 'font-medium text-danger-text' : 'text-muted'}>الفرق</dt>
                    <dd dir="ltr" className={`erp-numeric ${mismatch ? 'font-medium text-danger-text' : 'text-ink'}`}>
                        {moneyOf(gap)}
                    </dd>
                </div>
                <div className="flex items-center justify-between gap-sm border-t border-hairline pt-xxs">
                    <dt className="text-ink">الرصيد الختامي</dt>
                    <dd dir="ltr" className="erp-numeric font-medium text-ink">
                        {moneyOf(closing)}
                    </dd>
                </div>
            </dl>
            {mismatch ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    الحركة الفعلية لا تطابق القيود المرحّلة — راجع رصيد ما قبل الفترة أو حركات خارج الفترة قبل الاعتماد.
                </p>
            ) : (
                <p className="text-body-sm text-success-text">الأرصدة مطابقة للقيود المرحّلة.</p>
            )}
        </div>
    );
}

/** حالة التسجيل والاستحقاق — تُقرأ في سطر واحد قبل أي رقم. */
function FilingChip({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: ReactNode }) {
    const className =
        tone === 'ok'
            ? 'border-success text-success-text'
            : tone === 'warn'
              ? 'border-warning text-warning-text'
              : 'border-hairline-strong text-muted';
    return (
        <span className={`inline-flex items-center gap-xs rounded-full border px-sm py-xxs text-body-sm font-medium ${className}`}>
            {children}
        </span>
    );
}

/**
 * مسودة مراجعة ضريبة القيمة المضافة — قراءة من القيود المرحّلة، وتصفية
 * الضريبة بخطةٍ تُعاين قبل الترحيل.
 *
 * الأرقام من `GET /api/accounting/vat-return` (قراءة) و
 * `POST /api/accounting/vat-settlement` (معاينة/ترحيل — أدمن ومحاسب فقط
 * حسب `WRITE_ROLES` في `backend/accounting-routes.js:27`).
 * لا تُرسل إلى زاتكا ولا تُعدّ إقرارًا رسميًا؛ الشاشة تبرز الفروق
 * والحركات غير المصنّفة قبل أي استخدام محاسبي.
 */
export function VatReturn() {
    const [draft, setDraft] = useState<DateRange>(() => {
        const preset = presetRange('month');
        return { from: preset.from, to: preset.to };
    });
    const [range, setRange] = useState<DateRange>(draft);
    const [problem, setProblem] = useState('');
    const [month, setMonth] = useState(() => vatPeriodMonth(draft.from));
    const [applyError, setApplyError] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const auth = useAuthState();
    const canSettle = isWriteRole(auth.user?.role, VAT_SETTLEMENT_WRITE_ROLES);
    const { toast } = useToast();

    const reportQuery = useQuery({
        queryKey: ['accounting', 'vat-return', range.from, range.to],
        queryFn: ({ signal }) => fetchVatReturn(range.from, range.to, signal),
    });
    const currencyQuery = useQuery({
        queryKey: ['finance', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });

    const report = reportQuery.data;
    const currency = String(currencyQuery.data ?? '');
    const monthValid = /^\d{4}-\d{2}$/.test(month);
    const aligned = isFullMonth(month, range.from, range.to);

    // شهر التصفية يتبع أول يوم في فترة المراجعة — فلا ينفصل الرقمان.
    useEffect(() => {
        setMonth(vatPeriodMonth(range.from));
    }, [range.from]);

    const settlementQuery = useQuery({
        queryKey: ['accounting', 'vat-settlement', month],
        queryFn: ({ signal }) => fetchVatSettlementPreview(month, signal),
        enabled: canSettle && monthValid && aligned,
        refetchOnWindowFocus: false,
        retry: false,
    });
    const settlement = settlementQuery.data ?? null;

    const applyMutation = useWriteMutation<string, VatSettlement>({
        mutationFn: (value) => applyVatSettlement(value),
        successTitle: 'تم ترحيل تصفية الضريبة',
        successDescription: (value) => `قيد تصفية ${value} مُرحَّل في الأستاذ.`,
        silentError: true,
        invalidate: [
            ['accounting', 'vat-return'],
            ['accounting', 'vat-settlement'],
        ],
        onError: (error) => {
            setApplyError(writeErrorMessage(error));
        },
    });

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 366);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    /** اختيار شهر التصفية يُراجع الفترة معه — شهر كامل لا فترة مقطوعة. */
    function changeMonth(value: string) {
        setMonth(value);
        setApplyError('');
        const bounds = vatMonthRange(value);
        if (!bounds) {
            return;
        }
        setDraft((current) => ({ ...current, ...bounds }));
        setRange(bounds);
        setProblem('');
    }

    function printReview() {
        if (!report) {
            return;
        }
        const win = openBlankTab('مراجعة ضريبة القيمة المضافة');
        if (!win) {
            toast({
                title: 'تعذّر فتح نافذة الطباعة',
                description: 'اسمح بالنوافذ المنبثقة ثم أعد المحاولة.',
                variant: 'error',
            });
            return;
        }
        writeHtmlDocument(
            win,
            vatReviewPrintHtml(report, {
                byName: auth.user?.name ?? '—',
                currency,
                settlement,
            }),
        );
        win.document.querySelector('[data-vat-print]')?.addEventListener('click', () => win.print());
        win.document.querySelector('[data-vat-close]')?.addEventListener('click', () => win.close());
    }

    function exportCsv() {
        if (!report) {
            return;
        }
        const filename = vatReviewFilename(report.from, report.to);
        const blob = new Blob([vatReviewCsv(report, settlement)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        toast({ title: 'تم تصدير ملخص المراجعة', description: filename, variant: 'success' });
    }

    const unclassifiedOutputDebits = num(report?.unclassified_vat_movements.output_debits);
    const unclassifiedInputCredits = num(report?.unclassified_vat_movements.input_credits);
    const purchaseVatDifference = num(report?.purchases_crosscheck.vat) - num(report?.input_vat);
    const rateRows = report ? vatRateRows(report) : [];
    const rateSummary = vatRateSummary(rateRows);
    const readiness = report?.filing_readiness;
    const taxpayer = report?.taxpayer_profile;
    const frequency = report?.filing_period_validation;
    const unpostedSales = num(report?.sales_source_counts?.unposted_sales);
    const unpostedVoids = num(report?.sales_source_counts?.unposted_voids);
    const unpostedPurchases = num(report?.purchases_crosscheck.unposted_count);
    const worksheet = report ? vatWorksheet(report) : null;
    const reconciliation = report ? vatBalanceReconciliation(report) : null;
    const filingDeadline = report ? vatFilingDeadline(frequency?.frequency ?? '', report.to) : null;
    const registrationOk = Boolean(taxpayer?.number_configured && taxpayer?.registration_verified);
    const legacyRevenue = report?.legacy_revenue_crosscheck;
    const cancelledWithoutVoidDate = num(report?.cancelled_without_void_date);

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-lg">
            <ReportHeader
                title="مسودة مراجعة ضريبة القيمة المضافة"
                english="VAT Return Review"
                description="ملخص داخلي مبني على القيود المحاسبية المرحّلة فقط؛ لا يقدّم أو يرسل إقرارًا رسميًا."
                pending={reportQuery.isFetching}
                onRefresh={() => {
                    void reportQuery.refetch();
                }}
            />
            <div data-erp-print-hide className="flex flex-wrap items-center gap-sm">
                <PrintActions title="مسودة مراجعة ضريبة القيمة المضافة" />
                <Button variant="secondary" onClick={printReview} disabled={!report}>
                    طباعة ورقة المراجعة
                </Button>
                <Button variant="secondary" onClick={exportCsv} disabled={!report}>
                    تصدير CSV
                </Button>
            </div>

            <SectionCard title="فترة المراجعة" english="Review period">
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
                        pending={reportQuery.isFetching}
                    />
                    {problem ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {reportQuery.isPending ? <StateLoading label="جارٍ تجميع قيود الضريبة المرحّلة…" /> : null}
            {reportQuery.isError ? (
                <StateError
                    message={errorMessage(reportQuery.error)}
                    onRetry={() => {
                        void reportQuery.refetch();
                    }}
                />
            ) : null}

            {report ? (
                <>
                    <p className="text-body-sm text-muted">
                        الفترة: <span dir="ltr">{report.from}</span> — <span dir="ltr">{report.to}</span>
                    </p>

                    <SectionCard title="الوضع الضريبي للفترة" english="Filing position">
                        <div className="flex flex-col gap-sm p-sm">
                            <div className="flex flex-wrap items-center gap-sm">
                                <FilingChip tone={readiness?.can_file ? 'ok' : 'warn'}>
                                    {readiness ? (readiness.can_file ? 'جاهز للتقديم' : 'غير جاهز للتقديم') : 'حالة الجاهزية غير محددة'}
                                </FilingChip>
                                <FilingChip tone="muted">
                                    الدورية:{' '}
                                    {frequency?.frequency === 'monthly'
                                        ? 'شهرية'
                                        : frequency?.frequency === 'quarterly'
                                          ? 'ربع سنوية'
                                          : 'غير مضبوطة'}
                                </FilingChip>
                                <FilingChip tone={frequency?.matches_frequency ? 'ok' : 'warn'}>
                                    {frequency?.matches_frequency ? 'الفترة مطابقة للدورية' : 'الفترة غير مطابقة للدورية'}
                                </FilingChip>
                                <FilingChip tone={registrationOk ? 'ok' : 'warn'}>
                                    {registrationOk
                                        ? `المكلف مسجّل — ${taxpayer?.vat_number ?? 'رقم غير معروض'}`
                                        : taxpayer?.number_configured
                                          ? 'الرقم الضريبي مضبوط — التحقق النظامي غير مؤكد'
                                          : 'بيانات المكلف غير مضبوطة'}
                                </FilingChip>
                                <FilingChip tone={filingDeadline ? 'muted' : 'warn'}>
                                    آخر موعد إرشادي:{' '}
                                    {filingDeadline ? (
                                        <span dir="ltr" className="erp-numeric">
                                            {filingDeadline}
                                        </span>
                                    ) : (
                                        'غير محدد'
                                    )}
                                </FilingChip>
                            </div>
                            <p className="text-body-sm text-muted">
                                الموعد إرشادي من دورية الإقرار المسجّلة، وليس تأكيدًا من بوابة زاتكا. التحقق من التسجيل والإقرار السابق يظل
                                خارج النظام حتى ربطهما رسميًا.
                            </p>
                        </div>
                    </SectionCard>

                    {unclassifiedOutputDebits > 0 || unclassifiedInputCredits > 0 || Math.abs(purchaseVatDifference) > 0.01 ? (
                        <aside role="alert" className="rounded-lg border border-warning bg-surface p-sm text-body-sm text-warning-text">
                            <strong>توجد حركات ضريبية غير مصنّفة وتحتاج مراجعة قبل اعتماد الأرقام.</strong>
                            <div className="mt-xs flex flex-wrap gap-md">
                                <span>مدين غير مصنّف على ضريبة المخرجات: {moneyOf(unclassifiedOutputDebits)}</span>
                                <span>دائن غير مصنّف على ضريبة المدخلات: {moneyOf(unclassifiedInputCredits)}</span>
                                {Math.abs(purchaseVatDifference) > 0.01 ? (
                                    <span>فرق ضريبة فواتير الشراء عن الأستاذ: {moneyOf(purchaseVatDifference)}</span>
                                ) : null}
                            </div>
                        </aside>
                    ) : null}

                    <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-5">
                        <KpiCard
                            label="ضريبة المخرجات المرحّلة"
                            english="Posted output VAT"
                            value={moneyOf(report.output_vat)}
                            hint="ائتمانات حساب ضريبة المخرجات"
                        />
                        <KpiCard
                            label="عكس مبيعات ملغاة"
                            english="POS void reversals"
                            value={moneyOf(report.output_vat_reversals)}
                            hint="مدين قيود إلغاء الكاشير المرحّلة"
                        />
                        <KpiCard
                            label="ضريبة المدخلات المرحّلة"
                            english="Posted input VAT"
                            value={moneyOf(report.input_vat)}
                            hint="مدين حساب ضريبة المدخلات"
                        />
                        <KpiCard
                            label="تعديلات ضريبة المدخلات"
                            english="Input VAT adjustments"
                            value={moneyOf(report.input_vat_adjustments)}
                            hint="إشعارات المورد المصنّفة"
                        />
                        <KpiCard
                            label={report.net_payable > 0 ? 'صافي مستحق مبدئي' : 'رصيد دائن مبدئي'}
                            english="Preliminary net"
                            value={moneyOf(report.net_payable > 0 ? report.net_payable : report.carry_forward_credit)}
                            hint="للمراجعة فقط — ليس إقرارًا معتمدًا"
                        />
                    </div>

                    {worksheet ? (
                        <SectionCard title="ورقة عمل الإقرار الضريبي" english="VAT return worksheet">
                            <div className="flex flex-col gap-md p-sm">
                                <p className="text-body-sm text-muted">
                                    خانات النموذج مجمّعة من المستندات المرحّلة: البيع ناقص الإلغاء لنفس التصنيف، والمشتريات من فواتير الشراء
                                    المرتبطة بقيود. «—» تعني أن النظام لا يسجّل هذه الخانة، وليست صفرًا.
                                </p>
                                {worksheet.reviewDocuments > 0 ? (
                                    <p
                                        role="status"
                                        className="rounded-lg border border-warning bg-surface p-sm text-body-sm text-warning-text"
                                    >
                                        {intOf(worksheet.reviewDocuments)} مستندًا بمعدل غير قياسي أو مفقود يحتاج تصنيفًا يدويًا قبل إسناده إلى
                                        خانة نظامية.
                                    </p>
                                ) : null}
                                <WorksheetTable
                                    title="المبيعات — ضريبة المخرجات"
                                    caption="خانات ضريبة المخرجات في الإقرار مع الوعاء والضريبة وعدد المستندات"
                                    rows={worksheet.sales}
                                    total={worksheet.salesTotal}
                                    totalLabel="إجمالي الخانات المسجّلة"
                                    available={worksheet.hasSalesDetail}
                                />
                                <WorksheetTable
                                    title="المشتريات — ضريبة المدخلات"
                                    caption="خانات ضريبة المدخلات في الإقرار مع الوعاء والضريبة وعدد المستندات"
                                    rows={worksheet.purchases}
                                    total={worksheet.purchasesTotal}
                                    totalLabel="إجمالي الخانات المسجّلة"
                                    available={worksheet.hasPurchaseDetail}
                                />
                                <div className="grid gap-sm sm:grid-cols-3">
                                    <KpiCard
                                        label="ضريبة المخرجات المسجّلة"
                                        english="Recorded output VAT"
                                        value={worksheet.hasSalesDetail ? moneyOf(worksheet.salesTotal.vat) : '—'}
                                        hint="بيع ناقص إلغاء، بكل التصنيفات المسجّلة"
                                        tone={worksheet.hasSalesDetail ? 'neutral' : 'warning'}
                                    />
                                    <KpiCard
                                        label="ضريبة المدخلات المسجّلة"
                                        english="Recorded input VAT"
                                        value={worksheet.hasPurchaseDetail ? moneyOf(worksheet.purchasesTotal.vat) : '—'}
                                        hint="من فواتير الشراء المرحّلة بكل التصنيفات"
                                        tone={worksheet.hasPurchaseDetail ? 'neutral' : 'warning'}
                                    />
                                    <KpiCard
                                        label="صافي المستندات قبل التسويات"
                                        english="Document net before adjustments"
                                        value={worksheet.hasSalesDetail && worksheet.hasPurchaseDetail ? moneyOf(worksheet.net) : '—'}
                                        hint="مخرجات − مدخلات؛ لا يشمل عكس الإلغاء أو التعديلات اليدوية"
                                        tone={worksheet.net > 0 ? 'neutral' : worksheet.net < 0 ? 'success' : 'neutral'}
                                    />
                                </div>
                                {worksheet.salesComplete && worksheet.purchasesComplete ? (
                                    <p className="text-body-sm text-success-text">كل مستندات الفترة مصنّفة بمعدل قياسي — لا خانات معلّقة.</p>
                                ) : (
                                    <p className="text-body-sm text-warning-text">
                                        الخانات المعلّقة أو غير المسجّلة أعلاه تمنع مطابقة الإقرار كاملًا؛ أكمل التصنيف أو سجّل البيانات الناقصة
                                        قبل التقديم.
                                    </p>
                                )}
                            </div>
                        </SectionCard>
                    ) : null}

                    {reconciliation ? (
                        <SectionCard title="مطابقة أرصدة الضريبة" english="VAT balance reconciliation">
                            <div className="flex flex-col gap-sm p-sm">
                                <p className="text-body-sm text-muted">
                                    الرصيد الافتتاحي + حركة الفترة من القيود = الرصيد الختامي. أي فرق يعني رصيدًا افتتاحيًا غير مطابق أو حركة
                                    خارج الفترة، ولا يجوز اعتماد الإقرار قبله.
                                </p>
                                <div className="grid gap-sm lg:grid-cols-2">
                                    <ReconciliationRow
                                        label="حساب ضريبة المخرجات (2100)"
                                        asOf={reconciliation.asOf}
                                        opening={reconciliation.openingPayable}
                                        expected={reconciliation.expectedPayableMovement}
                                        actual={reconciliation.payableMovement}
                                        gap={reconciliation.payableGap}
                                        closing={reconciliation.closingPayable}
                                    />
                                    <ReconciliationRow
                                        label="حساب ضريبة المدخلات (1150)"
                                        asOf={reconciliation.asOf}
                                        opening={reconciliation.openingRecoverable}
                                        expected={reconciliation.expectedRecoverableMovement}
                                        actual={reconciliation.recoverableMovement}
                                        gap={reconciliation.recoverableGap}
                                        closing={reconciliation.closingRecoverable}
                                    />
                                </div>
                            </div>
                        </SectionCard>
                    ) : null}

                    <SectionCard title="تغطية المصادر قبل التقديم" english="Source coverage">
                        <div className="flex flex-col gap-sm p-sm">
                            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                                <KpiCard
                                    label="مستندات مبيعات غير مرحّلة"
                                    english="Unposted sales"
                                    value={intOf(unpostedSales + unpostedVoids)}
                                    hint={`مبيعات ${intOf(unpostedSales)} · إلغاءات ${intOf(unpostedVoids)}`}
                                    tone={unpostedSales + unpostedVoids > 0 ? 'warning' : 'neutral'}
                                />
                                <KpiCard
                                    label="فواتير شراء غير مرحّلة"
                                    english="Unposted purchases"
                                    value={intOf(unpostedPurchases)}
                                    hint="لا تدخل ضريبة المدخلات قبل الترحيل"
                                    tone={unpostedPurchases > 0 ? 'warning' : 'neutral'}
                                />
                                <KpiCard
                                    label="إلغاءات بلا تاريخ إلغاء"
                                    english="Cancelled without void date"
                                    value={intOf(cancelledWithoutVoidDate)}
                                    hint="لا يمكن إثبات عكس ضريبتها بلا تاريخ"
                                    tone={cancelledWithoutVoidDate > 0 ? 'danger' : 'neutral'}
                                />
                                <KpiCard
                                    label="إيرادات قديمة بلا فاتورة"
                                    english="Legacy revenue without invoice"
                                    value={intOf(legacyRevenue?.count)}
                                    hint={`بقيمة ${moneyOf(legacyRevenue?.amount)} — تحتاج مطابقة خارج النظام`}
                                    tone={num(legacyRevenue?.count) > 0 ? 'warning' : 'neutral'}
                                />
                            </div>
                            {legacyRevenue?.by_source?.length ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full border-collapse">
                                        <caption className="sr-only">تفصيل الإيرادات القديمة بلا فاتورة حسب المصدر</caption>
                                        <thead>
                                            <tr>
                                                {['المصدر', 'عدد السجلات', 'المبلغ'].map((label, index) => (
                                                    <th
                                                        key={label}
                                                        scope="col"
                                                        className={`border-b border-hairline bg-surface-sunken px-sm py-xs text-label-md font-medium text-ink-secondary ${
                                                            index === 0 ? 'text-start' : 'text-end'
                                                        }`}
                                                    >
                                                        {label}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {legacyRevenue.by_source.map((row) => (
                                                <tr key={row.source}>
                                                    <td className="border-b border-hairline px-sm py-xxs text-ink">{row.source}</td>
                                                    <td
                                                        dir="ltr"
                                                        className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric"
                                                    >
                                                        {intOf(row.count)}
                                                    </td>
                                                    <td
                                                        dir="ltr"
                                                        className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric"
                                                    >
                                                        {moneyOf(row.amount)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : null}
                            <KpiCard
                                label="نواقص مستندات الشراء"
                                english="Purchase document gaps"
                                value={intOf(report?.purchases_crosscheck.missing_tax_rate_count)}
                                hint={`معدل ${intOf(report?.purchases_crosscheck.missing_tax_rate_count)} · رقم ضريبي ${intOf(report?.purchases_crosscheck.missing_supplier_vat_count)} · حالة تسجيل ${intOf(report?.purchases_crosscheck.missing_supplier_tax_status_count)} · قاعدة ${intOf(report?.purchases_crosscheck.missing_tax_rule_count)}`}
                                tone={num(report?.purchases_crosscheck.missing_tax_rate_count) > 0 ? 'warning' : 'neutral'}
                            />
                        </div>
                    </SectionCard>

                    <SectionCard title="مطابقة فواتير الشراء" english="Posted purchase cross-check">
                        <div className="grid gap-sm p-sm sm:grid-cols-3">
                            <KpiCard
                                label="الفواتير المرتبطة بقيود مرحّلة"
                                english="Posted invoices"
                                value={String(report.purchases_crosscheck.count)}
                                hint="استُبعدت الفواتير الافتتاحية وغير المرحّلة"
                            />
                            <KpiCard
                                label="صافي المشتريات"
                                english="Net purchases"
                                value={moneyOf(report.purchases_crosscheck.net)}
                                hint="من سجل الفواتير التي لها قيد مرحّل"
                            />
                            <KpiCard
                                label="فرق ضريبة الفواتير عن الأستاذ"
                                english="Invoice-to-ledger difference"
                                value={moneyOf(purchaseVatDifference)}
                                hint="المشتريات المسجلة ناقص مدخلات الأستاذ"
                            />
                        </div>
                    </SectionCard>

                    <SectionCard title="تصنيف معدلات الضريبة" english="VAT rate classification">
                        <div className="flex flex-col gap-sm p-sm">
                            <p className="text-body-sm text-muted">
                                كل صف يجمع مستندات الفترة المرحّلة بمعدل واحد. المعدل الصفري أو المختلف عن المعدل القياسي لا يُسند آليًا إلى
                                خانة إقرار نظامية؛ يلزم تصنيف التوريد يدويًا قبل الاعتماد.
                            </p>
                            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                                <KpiCard
                                    label="مجموعات المعدلات"
                                    english="Rate groups"
                                    value={String(rateRows.length)}
                                    hint="بيع + إلغاء + شراء"
                                />
                                <KpiCard
                                    label="مجموعات تحتاج مراجعة"
                                    english="Groups needing review"
                                    value={String(rateSummary.reviewDocuments)}
                                    hint="مستندات بمعدل غير قياسي أو مفقود"
                                />
                                <KpiCard
                                    label="إجمالي الوعاء الضريبي"
                                    english="Taxable base"
                                    value={moneyOf(rateSummary.taxableBase)}
                                    hint="مجموع المستندات بكل المعدلات"
                                />
                                <KpiCard
                                    label="الضريبة على المستندات"
                                    english="Document VAT"
                                    value={moneyOf(rateSummary.vat)}
                                    hint="بيع − إلغاء + شراء"
                                />
                            </div>
                            {rateRows.length ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full border-collapse">
                                        <caption className="sr-only">تصنيف معدلات ضريبة القيمة المضافة في الفترة</caption>
                                        <thead>
                                            <tr>
                                                {[
                                                    'النوع',
                                                    'المعدل',
                                                    'المعدل القياسي',
                                                    'التصنيف',
                                                    'الوعاء الضريبي',
                                                    'الضريبة',
                                                    'المستندات',
                                                    'غير مرحّلة',
                                                ].map((label, index) => (
                                                    <th
                                                        key={label}
                                                        scope="col"
                                                        className={`border-b border-hairline bg-surface-sunken px-sm py-xs text-label-md font-medium text-ink-secondary ${
                                                            index >= 4 ? 'text-end' : 'text-start'
                                                        }`}
                                                    >
                                                        {label}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rateRows.map((row) => {
                                                const review = vatRateNeedsReview(row);
                                                return (
                                                    <tr key={`${row.kind}-${String(row.rate)}-${row.classification}`}>
                                                        <td className="border-b border-hairline px-sm py-xxs text-ink">
                                                            {KIND_LABELS[row.kind]}
                                                        </td>
                                                        <td
                                                            dir="ltr"
                                                            className="border-b border-hairline px-sm py-xxs text-ink erp-numeric"
                                                        >
                                                            {row.rate === null ? '—' : `${row.rate}%`}
                                                        </td>
                                                        <td
                                                            dir="ltr"
                                                            className="border-b border-hairline px-sm py-xxs text-ink erp-numeric"
                                                        >
                                                            {row.applicable_standard_rate === null
                                                                ? '—'
                                                                : `${row.applicable_standard_rate}%`}
                                                        </td>
                                                        <td
                                                            className={`border-b border-hairline px-sm py-xxs ${
                                                                review ? 'font-medium text-warning-text' : 'text-ink'
                                                            }`}
                                                        >
                                                            {VAT_RATE_LABELS[row.classification]}
                                                        </td>
                                                        <td
                                                            dir="ltr"
                                                            className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric"
                                                        >
                                                            {moneyOf(row.taxable_base)}
                                                        </td>
                                                        <td
                                                            dir="ltr"
                                                            className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric"
                                                        >
                                                            {moneyOf(row.vat)}
                                                        </td>
                                                        <td
                                                            dir="ltr"
                                                            className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric"
                                                        >
                                                            {String(row.document_count)}
                                                        </td>
                                                        <td
                                                            dir="ltr"
                                                            className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric"
                                                        >
                                                            {String(row.unposted_document_count)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="text-body-sm text-muted">لا مستندات بمعدلات ضريبة في هذه الفترة.</p>
                            )}
                        </div>
                    </SectionCard>

                    <SectionCard title="جاهزية تقديم الإقرار" english="Filing readiness">
                        <div className="flex flex-col gap-sm p-sm">
                            <div className="flex flex-wrap items-center gap-sm">
                                <span
                                    className={`rounded-full border px-sm py-xxs text-body-sm font-medium ${
                                        readiness?.can_file ? 'border-success text-success-text' : 'border-warning text-warning-text'
                                    }`}
                                >
                                    {readiness ? (readiness.can_file ? 'جاهز للتقديم' : 'غير جاهز للتقديم') : 'غير محدد'}
                                </span>
                                <span className="text-body-sm text-muted">
                                    المكلف: {taxpayer?.number_configured ? taxpayer.seller_name || 'مضبوط' : 'رقم التسجيل غير مضبوط'}
                                </span>
                                <span className="text-body-sm text-muted">موانع التقديم المرصودة: {intOf(readiness?.blockers.length)}</span>
                            </div>
                            {readiness?.blockers?.length ? (
                                <ol className="flex list-decimal flex-col gap-xxs ps-md text-body-sm text-ink">
                                    {readiness.blockers.map((blocker) => (
                                        <li key={blocker.code}>{blocker.message}</li>
                                    ))}
                                </ol>
                            ) : (
                                <p className="text-body-sm text-muted">لا موانع مسجّلة في هذه الفترة.</p>
                            )}
                        </div>
                    </SectionCard>

                    <SectionCard title="أرصدة حسابات الضريبة" english="Posted control-account balances">
                        <div className="grid gap-sm p-sm sm:grid-cols-2">
                            <KpiCard
                                label="رصيد حساب ضريبة المخرجات"
                                english="Output VAT balance"
                                value={moneyOf(report.payable_balance)}
                                hint="الرصيد المرحّل حتى نهاية الفترة"
                            />
                            <KpiCard
                                label="رصيد حساب ضريبة المدخلات"
                                english="Input VAT balance"
                                value={moneyOf(report.recoverable_balance)}
                                hint="الرصيد المرحّل حتى نهاية الفترة"
                            />
                        </div>
                    </SectionCard>

                    <SectionCard title="تصفية ضريبة القيمة المضافة" english="VAT settlement">
                        <div className="flex flex-col gap-sm p-sm">
                            <p className="text-body-sm text-muted">
                                الإطفاء = الحد الأدنى بين رصيد المخرجات المستحق (2100) ورصيد المدخلات القابل للاسترداد (1150)؛ قيد واحد مدين
                                2100 ودائن 1150، بلا سطر لصافي المستحق. لا يُصفَّف الشهر الجاري، والخادم يمنع تكرار الشهر.
                            </p>
                            <div className="flex flex-wrap items-end gap-sm">
                                <Input
                                    label="شهر التصفية"
                                    type="month"
                                    value={month}
                                    onChange={(event) => {
                                        changeMonth(event.target.value);
                                    }}
                                    containerClassName="w-52"
                                    hint="YYYY-MM"
                                />
                                <Button
                                    variant="secondary"
                                    loading={settlementQuery.isFetching}
                                    disabled={!canSettle || !monthValid || !aligned}
                                    onClick={() => {
                                        void settlementQuery.refetch();
                                    }}
                                >
                                    معاينة الخطة
                                </Button>
                                <Button
                                    disabled={!canSettle || !settlement || settlement.clearing <= 0 || Boolean(settlement.settled)}
                                    onClick={() => {
                                        setApplyError('');
                                        setConfirmOpen(true);
                                    }}
                                >
                                    ترحيل التصفية
                                </Button>
                            </div>
                            {!canSettle ? <p className="text-body-sm text-muted">الترحيل متاح لأدمن والمحاسب فقط.</p> : null}
                            {canSettle && !aligned ? (
                                <p className="text-body-sm text-muted">اختر شهر التصفية ليُراجَع مع الشهر كاملًا.</p>
                            ) : null}
                            {settlementQuery.isPending ? <StateLoading label="جارٍ حساب خطة التصفية…" /> : null}
                            {settlementQuery.isError ? (
                                <StateError
                                    message={errorMessage(settlementQuery.error)}
                                    onRetry={() => {
                                        void settlementQuery.refetch();
                                    }}
                                />
                            ) : null}
                            {settlement ? (
                                <>
                                    <div className="grid gap-sm sm:grid-cols-3">
                                        <KpiCard
                                            label="قيمة التصفية"
                                            english="Clearing amount"
                                            value={moneyOf(settlement.clearing)}
                                            hint="مدين 2100 / دائن 1150"
                                        />
                                        <KpiCard
                                            label="المستحق بعد التصفية"
                                            english="Net payable after"
                                            value={moneyOf(settlement.net_payable_after)}
                                            hint="يبقى رصيد 2100"
                                        />
                                        <KpiCard
                                            label="الرصيد المُرحَّل"
                                            english="Carry forward after"
                                            value={moneyOf(settlement.carry_forward_after)}
                                            hint="يبقى رصيد 1150"
                                        />
                                    </div>
                                    {settlement.lines.length ? (
                                        <table className="w-full border-collapse">
                                            <caption className="sr-only">سطور قيد تصفية ضريبة القيمة المضافة</caption>
                                            <thead>
                                                <tr>
                                                    <th
                                                        scope="col"
                                                        className="border-b border-hairline bg-surface-sunken px-sm py-xs text-start text-label-md font-medium text-ink-secondary"
                                                    >
                                                        الحساب
                                                    </th>
                                                    <th
                                                        scope="col"
                                                        className="border-b border-hairline bg-surface-sunken px-sm py-xs text-start text-label-md font-medium text-ink-secondary"
                                                    >
                                                        البيان
                                                    </th>
                                                    <th
                                                        scope="col"
                                                        className="border-b border-hairline bg-surface-sunken px-sm py-xs text-end text-label-md font-medium text-ink-secondary"
                                                    >
                                                        مدين
                                                    </th>
                                                    <th
                                                        scope="col"
                                                        className="border-b border-hairline bg-surface-sunken px-sm py-xs text-end text-label-md font-medium text-ink-secondary"
                                                    >
                                                        دائن
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {settlement.lines.map((line) => (
                                                    <tr key={line.account_code}>
                                                        <td
                                                            dir="ltr"
                                                            className="border-b border-hairline px-sm py-xxs text-ink erp-numeric"
                                                        >
                                                            {line.account_code}
                                                        </td>
                                                        <td className="border-b border-hairline px-sm py-xxs text-ink">{line.memo}</td>
                                                        <td
                                                            dir="ltr"
                                                            className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric"
                                                        >
                                                            {moneyOf(line.debit)}
                                                        </td>
                                                        <td
                                                            dir="ltr"
                                                            className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric"
                                                        >
                                                            {moneyOf(line.credit)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <p className="text-body-sm text-muted">لا رصيد يستحق الإقفال في هذا الشهر.</p>
                                    )}
                                    {settlement.settled ? (
                                        <p className="rounded-lg border border-success bg-surface p-sm text-body-sm text-success-text">
                                            هذا الشهر مُصفّى بالقيد {settlement.settled.entry_no} بتاريخ {settlement.settled.date}.
                                        </p>
                                    ) : null}
                                </>
                            ) : null}
                            {applyError ? (
                                <p role="alert" className="text-body-sm text-danger-text">
                                    {applyError}
                                </p>
                            ) : null}
                        </div>
                    </SectionCard>

                    <p className="rounded-lg border border-hairline bg-surface p-sm text-body-sm text-muted">
                        هذه الشاشة للمراجعة الداخلية فقط. لا تتضمن إرسالًا إلى زاتكا، ولا تثبت الامتثال النظامي؛ راجع الإشعارات الدائنة
                        والمدينة والحركات غير المصنّفة والمستندات الأصلية قبل استخدام الأرقام رسميًا.
                    </p>
                </>
            ) : null}

            <Dialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title="ترحيل تصفية ضريبة القيمة المضافة"
                description={month}
                size="sm"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
                            إلغاء
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            loading={applyMutation.isPending}
                            onClick={() => {
                                setConfirmOpen(false);
                                applyMutation.mutate(month);
                            }}
                        >
                            ترحيل القيد
                        </Button>
                    </>
                }
            >
                <p>
                    سيُرحَّل قيد تصفية بقيمة {moneyOf(settlement?.clearing ?? 0)} — مدين ضريبة المخرجات (2100) ودائن ضريبة المدخلات (1150) —
                    بتاريخ آخر يوم في {month}.
                </p>
            </Dialog>
        </div>
    );
}
