import './WarehouseGov.premium.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchCurrency } from '../lib/finance';
import { formatMoney } from '../lib/format';
import { formatInt, formatQty } from '../lib/inventory-register';
import {
    closeFiscalYear,
    createFiscalYear,
    createNextFiscalYear,
    FISCAL_CLOSE_ROLES,
    FISCAL_CREATE_ROLES,
    FISCAL_READ_ROLES,
    fetchFiscalYears,
    fetchOpeningBalanceReport,
    fetchSystemHealth,
    fiscalSummary,
    fiscalWriteEnabled,
    HEALTH_READ_ROLES,
    normalizeFiscalYearForm,
    OPENING_READ_ROLES,
    openingTotals,
    validateFiscalYearForm,
} from '../lib/warehouse-gov';

function hasRole(role: string, roles: readonly string[]): boolean {
    return roles.includes(role);
}

function money(value: string, currency: string): string {
    const formatted = formatMoney(value);
    return currency ? `${formatted} ${currency}` : formatted;
}

function statusName(status: string): string {
    if (status === 'open') {
        return 'مفتوحة';
    }
    if (status === 'closed') {
        return 'مغلقة';
    }
    return status || 'غير محددة';
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-lg border border-hairline bg-surface p-md shadow-card">
            <p className="text-label-md text-muted">{label}</p>
            <p className="erp-numeric mt-xs text-heading-lg text-ink" dir="ltr">
                {value}
            </p>
            {hint ? <p className="mt-xxs text-caption text-muted">{hint}</p> : null}
        </div>
    );
}

export function WarehouseGov() {
    const auth = useAuthState();
    const role = auth.user?.role ?? '';
    const canReadFiscal = hasRole(role, FISCAL_READ_ROLES);
    const canCreateFiscal = hasRole(role, FISCAL_CREATE_ROLES) && fiscalWriteEnabled();
    const canCloseFiscal = hasRole(role, FISCAL_CLOSE_ROLES) && fiscalWriteEnabled();
    const canReadOpening = hasRole(role, OPENING_READ_ROLES);
    const canReadHealth = hasRole(role, HEALTH_READ_ROLES);
    const canReadAny = canReadFiscal || canReadOpening || canReadHealth;
    const queryClient = useQueryClient();
    const [status, setStatus] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [formError, setFormError] = useState('');
    const [form, setForm] = useState({ startDate: '', endDate: '', yearCode: '', name: '', notes: '' });

    const fiscalQuery = useQuery({
        queryKey: ['warehouse-gov', 'fiscal-years'],
        queryFn: ({ signal }) => fetchFiscalYears(signal),
        enabled: canReadFiscal,
    });
    const openingQuery = useQuery({
        queryKey: ['warehouse-gov', 'opening-balance'],
        queryFn: ({ signal }) => fetchOpeningBalanceReport(signal),
        enabled: canReadOpening,
    });
    const healthQuery = useQuery({
        queryKey: ['warehouse-gov', 'system-health'],
        queryFn: ({ signal }) => fetchSystemHealth(signal),
        enabled: canReadHealth,
    });
    const currencyQuery = useQuery({
        queryKey: ['settings', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        enabled: canReadFiscal || canReadOpening,
        staleTime: 10 * 60 * 1000,
    });

    const writeMutation = useMutation({
        mutationFn: async (
            action: { kind: 'create'; payload: ReturnType<typeof normalizeFiscalYearForm> } | { kind: 'close' | 'next'; id: string },
        ) => {
            if (action.kind === 'create') {
                return createFiscalYear(action.payload);
            }
            if (action.kind === 'close') {
                return closeFiscalYear(action.id);
            }
            return createNextFiscalYear(action.id);
        },
        onSuccess: async (_result, action) => {
            setStatus(
                action.kind === 'create'
                    ? 'تم إنشاء السنة المالية.'
                    : action.kind === 'close'
                      ? 'تم إقفال السنة وحفظ لقطة الإقفال.'
                      : 'تم إنشاء السنة التالية وترحيل الأرصدة الافتتاحية.',
            );
            setFormOpen(false);
            setFormError('');
            await queryClient.invalidateQueries({ queryKey: ['warehouse-gov', 'fiscal-years'] });
        },
        onError: (error) => {
            setStatus(`تعذّر تنفيذ العملية: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
        },
    });

    function submitFiscalForm(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const errors = validateFiscalYearForm(form);
        if (errors.length) {
            setFormError(errors[0]?.message ?? 'راجع بيانات السنة المالية.');
            return;
        }
        writeMutation.mutate({ kind: 'create', payload: normalizeFiscalYearForm(form) });
    }

    function confirmFiscalAction(kind: 'close' | 'next', id: string, name: string) {
        const message =
            kind === 'close'
                ? `سيتم إقفال السنة المالية «${name}» بعد تحقق الخادم من الورديات والجرد. الإقفال غير قابل للتكرار. هل تريد المتابعة؟`
                : 'سيتم إنشاء السنة التالية وترحيل أرصدة المخزون الافتتاحية. هل تريد المتابعة؟';
        if (window.confirm(message)) {
            writeMutation.mutate({ kind, id });
        }
    }

    if (!canReadAny) {
        return (
            <div className="flex flex-col gap-md erp-premium-WarehouseGov">
                <header>
                    <h1 className="text-display-lg text-ink">حوكمة المخزن</h1>
                    <p className="text-body-sm text-muted">السنوات المالية والرصيد الافتتاحي وفحص النظام.</p>
                </header>
                <Card>
                    <StateEmpty
                        title="لا توجد بطاقة متاحة لهذا الحساب"
                        hint="السنوات المالية للإدارة والمدير والمحاسب، والرصيد الافتتاحي للإدارة والمدير والمخزن، وفحص النظام للإدارة فقط. لم يُرسل أي طلب."
                    />
                </Card>
            </div>
        );
    }

    const years = fiscalQuery.data ?? [];
    const fiscalTotals = fiscalSummary(years);
    const invoices = openingQuery.data ?? [];
    const opening = openingTotals(invoices);
    const currency = currencyQuery.data ?? '';

    return (
        <div className="flex flex-col gap-md erp-premium-WarehouseGov">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        حوكمة المخزن{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Warehouse Governance
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">
                        دورة السنوات المالية وتقارير الأرصدة وفحص اتساق النظام — الصلاحية النهائية للخادم.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    <PrintActions title="حوكمة المخزن" />
                    <button
                        type="button"
                        onClick={() => {
                            void queryClient.invalidateQueries({ queryKey: ['warehouse-gov'] });
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            {status ? (
                <p role="status" aria-live="polite" className="text-body-sm text-muted">
                    {status}
                </p>
            ) : null}

            {canReadFiscal ? (
                <Card className="flex flex-col gap-md p-md">
                    <div className="flex flex-wrap items-center justify-between gap-sm">
                        <div>
                            <h2 className="text-heading-md text-ink">السنوات المالية</h2>
                            <p className="text-caption text-muted">Fiscal years · {formatInt(fiscalTotals.total)} سنة</p>
                        </div>
                        {canCreateFiscal ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setFormOpen((open) => !open);
                                    setFormError('');
                                }}
                                className="rounded-md bg-primary px-md py-xs text-button-md text-on-primary"
                            >
                                {formOpen ? 'إغلاق النموذج' : 'سنة مالية جديدة'}
                            </button>
                        ) : (
                            <span className="rounded-full border border-hairline px-sm py-xxs text-caption text-muted">الكتابة مغلقة</span>
                        )}
                    </div>
                    <p className="text-body-sm text-muted">
                        الإقفال لا يحذف المبيعات أو المصروفات؛ يحفظ لقطة ويمنع الخادم تكرار الإقفال، ثم تُرحّل الأرصدة إلى السنة التالية.{' '}
                        {fiscalTotals.open} مفتوحة · {fiscalTotals.closed} مغلقة.
                    </p>
                    {formOpen && canCreateFiscal ? (
                        <form onSubmit={submitFiscalForm} className="flex flex-col gap-sm rounded-md border border-hairline p-md">
                            <div className="grid gap-sm sm:grid-cols-2">
                                <label className="flex flex-col gap-xxs text-label-md text-ink">
                                    تاريخ البداية
                                    <input
                                        type="date"
                                        required
                                        value={form.startDate}
                                        onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xs"
                                    />
                                </label>
                                <label className="flex flex-col gap-xxs text-label-md text-ink">
                                    تاريخ النهاية
                                    <input
                                        type="date"
                                        required
                                        value={form.endDate}
                                        onChange={(event) => setForm({ ...form, endDate: event.target.value })}
                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xs"
                                    />
                                </label>
                                <label className="flex flex-col gap-xxs text-label-md text-ink">
                                    كود السنة
                                    <input
                                        maxLength={20}
                                        value={form.yearCode}
                                        onChange={(event) => setForm({ ...form, yearCode: event.target.value })}
                                        placeholder="افتراضي: سنة البداية"
                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xs"
                                    />
                                </label>
                                <label className="flex flex-col gap-xxs text-label-md text-ink">
                                    الاسم
                                    <input
                                        maxLength={120}
                                        value={form.name}
                                        onChange={(event) => setForm({ ...form, name: event.target.value })}
                                        placeholder="السنة المالية …"
                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xs"
                                    />
                                </label>
                            </div>
                            <label className="flex flex-col gap-xxs text-label-md text-ink">
                                ملاحظات
                                <input
                                    maxLength={500}
                                    value={form.notes}
                                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xs"
                                />
                            </label>
                            {formError ? (
                                <p role="alert" className="text-body-sm text-danger-text">
                                    {formError}
                                </p>
                            ) : null}
                            <button
                                type="submit"
                                disabled={writeMutation.isPending}
                                className="self-start rounded-md bg-primary px-md py-xs text-button-md text-on-primary disabled:opacity-50"
                            >
                                {writeMutation.isPending ? 'جارٍ الحفظ…' : 'حفظ السنة المالية'}
                            </button>
                        </form>
                    ) : null}
                    {fiscalQuery.isError ? (
                        <StateError
                            message={fiscalQuery.error instanceof Error ? fiscalQuery.error.message : 'تعذّر جلب السنوات'}
                            onRetry={() => void fiscalQuery.refetch()}
                        />
                    ) : fiscalQuery.isLoading ? (
                        <TableSkeleton rows={4} columns={4} />
                    ) : years.length ? (
                        <TableScroll label="السنوات المالية">
                            <table className="erp-table w-full min-w-[760px]">
                                <caption className="sr-only">السنة المالية والفترة والحالة وملخص الإقفال</caption>
                                <thead>
                                    <tr>
                                        <th scope="col">السنة</th>
                                        <th scope="col">الفترة</th>
                                        <th scope="col">الحالة</th>
                                        <th scope="col">ملخص الإقفال</th>
                                        {canCloseFiscal ? <th scope="col">إجراء</th> : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {years.map((year) => (
                                        <tr key={year.id}>
                                            <th scope="row">
                                                {year.name || year.yearCode || '—'}
                                                <span className="me-xs text-caption text-muted" dir="ltr">
                                                    {year.yearCode}
                                                </span>
                                            </th>
                                            <td dir="ltr">
                                                {year.startDate || '—'} → {year.endDate || '—'}
                                            </td>
                                            <td>
                                                <span className="rounded-full border border-hairline px-sm py-xxs text-caption">
                                                    {statusName(year.status)}
                                                </span>
                                            </td>
                                            <td className="min-w-64">
                                                {year.status !== 'closed' ? (
                                                    <span className="text-body-sm text-muted">
                                                        {year.openingCount
                                                            ? `افتتاحي مرحّل: ${formatInt(year.openingCount)} صنفًا`
                                                            : 'بانتظار الإقفال'}
                                                    </span>
                                                ) : year.hasSnapshot ? (
                                                    <div className="flex flex-col text-body-sm">
                                                        <span>
                                                            إيراد: {money(year.snapshot.revenueTotal, currency)} (
                                                            {formatInt(year.snapshot.revenueCount)})
                                                        </span>
                                                        <span>
                                                            مصروف: {money(year.snapshot.expenseTotal, currency)} (
                                                            {formatInt(year.snapshot.expenseCount)})
                                                        </span>
                                                        <span>صافي: {money(year.snapshot.netResult, currency)}</span>
                                                        <span>
                                                            مخزون: {money(year.snapshot.inventoryValue, currency)} (
                                                            {formatInt(year.snapshot.inventoryCount)} صنفًا)
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span className="text-body-sm text-muted">مغلقة — بلا لقطة محفوظة</span>
                                                )}
                                            </td>
                                            {canCloseFiscal ? (
                                                <td>
                                                    <button
                                                        type="button"
                                                        disabled={writeMutation.isPending}
                                                        onClick={() =>
                                                            confirmFiscalAction(
                                                                year.status === 'closed' ? 'next' : 'close',
                                                                year.id,
                                                                year.name,
                                                            )
                                                        }
                                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink disabled:opacity-50"
                                                    >
                                                        {year.status === 'closed' ? 'السنة التالية' : 'إقفال السنة'}
                                                    </button>
                                                </td>
                                            ) : null}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    ) : (
                        <StateEmpty
                            title="لا سنوات مالية مسجلة"
                            hint={canCreateFiscal ? 'أنشئ السنة الأولى من النموذج أعلاه.' : 'لا توجد بيانات لعرضها.'}
                        />
                    )}
                    {currencyQuery.isError ? (
                        <p role="status" className="text-caption text-warning-text">
                            إعداد العملة غير متاح؛ عُرضت المبالغ دون رمز عملة.
                        </p>
                    ) : null}
                </Card>
            ) : null}

            {canReadOpening ? (
                <Card className="flex flex-col gap-md p-md">
                    <div>
                        <h2 className="text-heading-md text-ink">الرصيد الافتتاحي</h2>
                        <p className="text-caption text-muted">Opening balance · قراءة من فواتير OPEN-*</p>
                    </div>
                    {openingQuery.isError ? (
                        <StateError
                            message={openingQuery.error instanceof Error ? openingQuery.error.message : 'تعذّر جلب التقرير'}
                            onRetry={() => void openingQuery.refetch()}
                        />
                    ) : openingQuery.isLoading ? (
                        <TableSkeleton rows={4} columns={5} />
                    ) : (
                        <>
                            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                                <Metric label="فواتير افتتاحية" value={formatInt(opening.invoices)} />
                                <Metric label="بنود مسجلة" value={formatInt(opening.lines)} />
                                <Metric
                                    label="كمية افتتاحية"
                                    value={formatQty(opening.qty)}
                                    hint={`منصرف منذ الافتتاح: ${formatQty(opening.issuedSince)}`}
                                />
                                <Metric
                                    label="إجمالي الفواتير"
                                    value={money(opening.totalAmount, currency)}
                                    {...(opening.missing ? { hint: `${formatInt(opening.missing)} بندًا لصنف غير موجود` } : {})}
                                />
                            </div>
                            {invoices.length ? (
                                <TableScroll label="فواتير الرصيد الافتتاحي">
                                    <table className="erp-table w-full min-w-[780px]">
                                        <caption className="sr-only">بنود فواتير الرصيد الافتتاحي وحالتها في سجل المخزون</caption>
                                        <thead>
                                            <tr>
                                                <th scope="col">الصنف</th>
                                                <th scope="col">الفئة</th>
                                                <th scope="col">الكمية</th>
                                                <th scope="col">منصرف</th>
                                                <th scope="col">الرصيد الحالي</th>
                                                <th scope="col">السعر</th>
                                                <th scope="col">الحالة</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {invoices.flatMap((invoice) =>
                                                invoice.items.map((item, index) => (
                                                    <tr key={`${invoice.id}-${item.itemId ?? item.name}-${String(index)}`}>
                                                        <th scope="row">
                                                            {item.name || (item.itemId ? `#${item.itemId}` : '—')}
                                                            <span className="block text-caption text-muted">
                                                                {invoice.number} · {invoice.date}
                                                            </span>
                                                        </th>
                                                        <td>{item.category || 'بلا فئة'}</td>
                                                        <td dir="ltr">
                                                            {formatQty(item.qty)} {item.unit}
                                                        </td>
                                                        <td dir="ltr">
                                                            {formatQty(item.issuedSince)} {item.unit}
                                                        </td>
                                                        <td dir="ltr">
                                                            {item.currentQty === null ? '—' : `${formatQty(item.currentQty)} ${item.unit}`}
                                                        </td>
                                                        <td dir="ltr">{money(item.price, currency)}</td>
                                                        <td>{item.itemExists ? 'في السجل' : 'محذوف من السجل'}</td>
                                                    </tr>
                                                )),
                                            )}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            ) : (
                                <StateEmpty title="لا فواتير رصيد افتتاحي" hint="لا توجد فواتير OPEN-* في التقرير." />
                            )}
                        </>
                    )}
                </Card>
            ) : null}

            {canReadHealth ? (
                <Card className="flex flex-col gap-md p-md">
                    <div>
                        <h2 className="text-heading-md text-ink">فحص النظام</h2>
                        <p className="text-caption text-muted">System health · المؤشرات والملاحظات التي أعادها الخادم</p>
                    </div>
                    {healthQuery.isError ? (
                        <StateError
                            message={healthQuery.error instanceof Error ? healthQuery.error.message : 'تعذّر فحص النظام'}
                            onRetry={() => void healthQuery.refetch()}
                        />
                    ) : healthQuery.isLoading ? (
                        <TableSkeleton rows={3} columns={4} />
                    ) : healthQuery.data ? (
                        <>
                            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                                <Metric label="أصناف السجل" value={formatInt(healthQuery.data.itemsTotal)} />
                                <Metric label="متسقة" value={formatInt(healthQuery.data.consistent)} />
                                <Metric label="نفد رصيدها" value={formatInt(healthQuery.data.zeroStock)} />
                                <Metric label="تحت الحد" value={formatInt(healthQuery.data.lowStock)} />
                            </div>
                            <p
                                role={healthQuery.data.ok && healthQuery.data.anomaliesCount === 0 ? 'status' : 'alert'}
                                className={
                                    healthQuery.data.ok && healthQuery.data.anomaliesCount === 0
                                        ? 'text-body-sm text-success-text'
                                        : 'text-body-sm text-warning-text'
                                }
                            >
                                {healthQuery.data.ok
                                    ? `فحص الخادم اكتمل — ${formatInt(healthQuery.data.anomaliesCount)} ملاحظة من إجمالي الفحص.`
                                    : `فحص الخادم أبلغ عن ${formatInt(healthQuery.data.anomaliesCount)} ملاحظة.`}
                                {healthQuery.data.anomalies.length < healthQuery.data.anomaliesCount
                                    ? ` عُرضت أول ${formatInt(healthQuery.data.anomalies.length)} فقط.`
                                    : ''}
                            </p>
                            {healthQuery.data.anomalies.length ? (
                                <ul className="flex flex-col gap-xs">
                                    {healthQuery.data.anomalies.map((anomaly, index) => (
                                        <li key={`${anomaly.name}-${String(index)}`} className="rounded-md border border-hairline p-sm">
                                            <strong className="text-body-md text-ink">{anomaly.name || 'صنف بلا اسم'}</strong>
                                            <span className="ms-sm text-body-sm text-muted">{anomaly.issue || 'ملاحظة بلا وصف'}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-body-sm text-muted">لا توجد ملاحظات ضمن النتائج التي أعادها الخادم.</p>
                            )}
                        </>
                    ) : null}
                </Card>
            ) : null}
        </div>
    );
}
