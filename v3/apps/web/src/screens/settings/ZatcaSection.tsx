import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useConfirm } from '../../components/ConfirmProvider';
import { TableScroll } from '../../components/TableState';
import { fetchJson } from '../../lib/api';
import { getAccessToken, useAuthState } from '../../lib/auth';
import {
    type ZatcaConfig,
    type ZatcaQueueRow,
    type ZatcaQueueStats,
    type ZatcaSettingsResponse,
    type ZatcaTestResult,
    zatcaQueueSchema,
    zatcaSettingsSchema,
} from '../../lib/settings';
import {
    SETTINGS_TEXT,
    saveZatcaSettings,
    zatcaApplyVat,
    zatcaGenerateCsr,
    zatcaManualCsid,
    zatcaRequestCsid,
    zatcaRetryQueue,
    zatcaTest,
    zatcaToggle,
    zatcaWriteVisible,
} from '../../lib/settings-write';
import { useWriteMutation, writeErrorMessage } from '../../lib/write';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Dialog } from '../../ui/Dialog';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { Textarea } from '../../ui/Textarea';
import { useToast } from '../../ui/Toast';
import { FieldGrid, formatNumber, formatStamp, QueryBoundary, ReadOnlyBadge, SaveBar, SectionCard, useDraftForm } from './shared';

interface ZatcaForm {
    seller_name: string;
    vat_number: string;
    crn: string;
    address: string;
    branch_name: string;
    eid: string;
    solution_name: string;
    environment: string;
    api_base: string;
    max_attempts: string;
    poll_in_server: boolean;
}

const STATUS_LABEL: Record<string, string> = {
    queued: 'بانتظار الإرسال',
    processing: 'قيد الإرسال',
    reported: 'مُبلّغ',
    failed: 'فشل',
    dead_letter: 'فشل نهائي',
    skipped_cancelled: 'متجاوز (ملغى)',
    skipped_disabled: 'متجاوز (موقوف)',
};

const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
    reported: 'success',
    failed: 'danger',
    dead_letter: 'danger',
    processing: 'warning',
};

function toForm(config: ZatcaConfig): ZatcaForm {
    return {
        seller_name: config.seller_name,
        vat_number: config.vat_number,
        crn: config.crn,
        address: config.address,
        branch_name: config.branch_name,
        eid: '',
        solution_name: config.solution_name,
        environment: config.environment,
        api_base: config.api_base,
        max_attempts: String(config.max_attempts || 10),
        poll_in_server: config.poll_in_server,
    };
}

function statsChips(stats: ZatcaQueueStats) {
    return [
        { key: 'queued', label: 'بالانتظار', value: stats.queued, tone: 'neutral' as const },
        { key: 'reported', label: 'مُبلّغة', value: stats.reported, tone: 'success' as const },
        { key: 'failed', label: 'فاشلة', value: stats.failed + stats.dead_letter, tone: 'danger' as const },
        { key: 'processing', label: 'قيد الإرسال', value: stats.processing, tone: 'warning' as const },
    ];
}

export function ZatcaSection() {
    const auth = useAuthState();
    const canWrite = zatcaWriteVisible(auth.user?.role);
    const { toast } = useToast();
    const confirm = useConfirm();

    const [error, setError] = useState('');
    const [testResult, setTestResult] = useState<ZatcaTestResult | null>(null);
    const [testError, setTestError] = useState('');
    const [testing, setTesting] = useState(false);

    const [csrOpen, setCsrOpen] = useState(false);
    const [csrText, setCsrText] = useState('');
    const [csidOpen, setCsidOpen] = useState(false);
    const [otp, setOtp] = useState('');
    const [manualOpen, setManualOpen] = useState(false);
    const [manualCsid, setManualCsid] = useState('');
    const [manualVat, setManualVat] = useState('');
    const [actionError, setActionError] = useState('');

    const query = useQuery({
        queryKey: ['settings', 'zatca'],
        queryFn: ({ signal }) => fetchJson(zatcaSettingsSchema, '/api/zatca/settings', getAccessToken(), { signal }),
        refetchOnWindowFocus: false,
    });
    const queueQuery = useQuery({
        queryKey: ['settings', 'zatca-queue'],
        queryFn: ({ signal }) => fetchJson(zatcaQueueSchema, '/api/zatca/queue?limit=20', getAccessToken(), { signal }),
        refetchOnWindowFocus: false,
    });

    const data: ZatcaSettingsResponse | null = query.data ?? null;
    const signature = data ? JSON.stringify(data.config) : '';
    const draft = useDraftForm<ZatcaForm>(data ? toForm(data.config) : null, signature);
    const config = data?.config ?? null;

    const invalidate = [
        ['settings', 'zatca'],
        ['settings', 'zatca-queue'],
    ] as const;

    const save = useWriteMutation<ZatcaForm, void>({
        mutationFn: (form) =>
            saveZatcaSettings({
                seller_name: form.seller_name.trim(),
                vat_number: form.vat_number.replace(/\D/g, ''),
                crn: form.crn.trim(),
                address: form.address.trim(),
                branch_name: form.branch_name.trim(),
                eid: form.eid.trim(),
                solution_name: form.solution_name.trim(),
                environment: form.environment,
                api_base: form.api_base.trim(),
                max_attempts: Number(form.max_attempts),
                poll_in_server: form.poll_in_server,
            }),
        successTitle: () => 'تم حفظ بيانات ربط ZATCA',
        invalidate,
        silentError: true,
        onSuccess: () => {
            setError('');
            draft?.commit();
        },
        onError: (cause) => {
            setError(writeErrorMessage(cause, SETTINGS_TEXT.saveFailed));
        },
    });

    const toggle = useWriteMutation<boolean, void>({
        mutationFn: (enabled) => zatcaToggle(enabled),
        successTitle: (enabled) => (enabled ? 'تم تفعيل الربط' : 'تم إيقاف الربط'),
        invalidate,
        silentError: true,
        onError: (cause) => {
            toast({ title: 'تعذّر تغيير حالة الربط', description: writeErrorMessage(cause), variant: 'error' });
        },
    });

    const csr = useWriteMutation<void, void>({
        mutationFn: async () => {
            const result = await zatcaGenerateCsr();
            setCsrText(result.csr_pem);
            setCsrOpen(true);
        },
        invalidate,
        silentError: true,
        onError: (cause) => {
            toast({ title: 'تعذّر توليد CSR', description: writeErrorMessage(cause), variant: 'error' });
        },
    });

    const requestCsid = useWriteMutation<void, void>({
        mutationFn: async () => {
            await zatcaRequestCsid(otp.trim());
            setCsidOpen(false);
            setOtp('');
        },
        successTitle: () => 'تم استلام شهادة CSID',
        invalidate,
        silentError: true,
        onError: (cause) => {
            setActionError(writeErrorMessage(cause, 'فشل طلب الشهادة'));
        },
    });

    const saveManual = useWriteMutation<void, void>({
        mutationFn: async () => {
            await zatcaManualCsid({
                csid: manualCsid.trim(),
                ...(manualVat.trim() ? { vat_number: manualVat.replace(/\D/g, '') } : {}),
            });
            setManualOpen(false);
            setManualCsid('');
            setManualVat('');
        },
        successTitle: () => 'تم حفظ شهادة CSID',
        invalidate,
        silentError: true,
        onError: (cause) => {
            setActionError(writeErrorMessage(cause, 'تعذّر حفظ الشهادة'));
        },
    });

    const clearCsid = useWriteMutation<void, void>({
        mutationFn: () => zatcaManualCsid({ clear: true }),
        successTitle: () => 'تم حذف الشهادة',
        invalidate,
        silentError: true,
        onError: (cause) => {
            toast({ title: 'تعذّر حذف الشهادة', description: writeErrorMessage(cause), variant: 'error' });
        },
    });

    const applyVat = useWriteMutation<void, void>({
        mutationFn: async () => {
            const result = await zatcaApplyVat(draft?.value.vat_number);
            toast({
                title: 'تم تطبيق الرقم الضريبي',
                description: `تحديث ${formatNumber(result.updated)} قسمًا`,
                variant: 'success',
            });
        },
        invalidate,
        silentError: true,
        onError: (cause) => {
            toast({ title: 'تعذّر تطبيق الرقم', description: writeErrorMessage(cause), variant: 'error' });
        },
    });

    const retry = useWriteMutation<'failed' | 'all', void>({
        mutationFn: async (scope) => {
            const result = await zatcaRetryQueue(scope);
            toast({
                title: 'تمت إعادة الجدولة',
                description: `${formatNumber(result.requeued)} فاتورة`,
                variant: 'success',
            });
        },
        invalidate,
        silentError: true,
        onError: (cause) => {
            toast({ title: 'تعذّرت إعادة الجدولة', description: writeErrorMessage(cause), variant: 'error' });
        },
    });

    if (!draft || !data || !config) {
        return (
            <QueryBoundary pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
                <span />
            </QueryBoundary>
        );
    }

    const value = draft.value;
    const environments = config.environments.length
        ? config.environments
        : [
              { value: 'developer_portal', label: 'بوابة المطوّر', api_base: '' },
              { value: 'simulation', label: 'المحاكاة', api_base: '' },
              { value: 'production', label: 'الإنتاج', api_base: '' },
          ];
    const queueRows: ZatcaQueueRow[] = queueQuery.data?.rows ?? [];
    const stats = queueQuery.data?.stats ?? data.queue;

    const submit = () => {
        const vat = value.vat_number.replace(/\D/g, '');
        if (vat && !/^\d{15}$/.test(vat)) {
            setError('الرقم الضريبي يجب أن يكون 15 رقمًا');
            return;
        }
        if (value.api_base.trim() && !/^https:\/\//i.test(value.api_base.trim())) {
            setError('عنوان API يجب أن يبدأ بـ https://');
            return;
        }
        const attempts = Number(value.max_attempts);
        if (!Number.isInteger(attempts) || attempts < 1 || attempts > 50) {
            setError('عدد المحاولات بين 1 و50');
            return;
        }
        setError('');
        save.mutate(value);
    };

    const runTest = async () => {
        setTesting(true);
        setTestError('');
        setTestResult(null);
        try {
            const result = await zatcaTest(value.api_base.trim() || undefined);
            if (result.ok) {
                setTestResult(result);
            } else {
                setTestError(result.message || `HTTP ${String(result.http_status)}`);
            }
        } catch (cause) {
            setTestError(writeErrorMessage(cause, 'فشل اختبار الاتصال'));
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="flex flex-col gap-lg">
            <SectionCard
                title="الربط الضريبي"
                english="ZATCA Integration"
                badge={
                    <Badge variant={config.enabled ? 'success' : 'danger'} dot>
                        {config.enabled ? 'مفعّل' : 'موقوف'}
                    </Badge>
                }
                actions={<ReadOnlyBadge visible={canWrite} />}
            >
                <div className="flex flex-wrap items-center gap-xs">
                    <Badge variant="info">{config.environment_label || config.environment}</Badge>
                    <Badge variant={config.has_csid ? 'success' : 'warning'}>{config.has_csid ? 'CSID جاهزة' : 'بلا CSID'}</Badge>
                    <Badge variant="neutral">{config.poll_in_server ? 'مزامنة من الخادم' : 'مزامنة من العميل'}</Badge>
                    {config.enabled ? (
                        <Button
                            variant="danger"
                            size="sm"
                            loading={toggle.isPending}
                            disabled={!canWrite || toggle.isPending}
                            onClick={async () => {
                                const ok = await confirm(
                                    'إيقاف الربط يجمّد الإبلاغ الضريبي مؤقتًا — الفواتير تبقى محفوظة وتُرسل عند إعادة التفعيل.',
                                );
                                if (ok) {
                                    toggle.mutate(false);
                                }
                            }}
                        >
                            إيقاف الربط
                        </Button>
                    ) : (
                        <Button
                            variant="primary"
                            size="sm"
                            loading={toggle.isPending}
                            disabled={!canWrite || toggle.isPending}
                            onClick={() => {
                                toggle.mutate(true);
                            }}
                        >
                            تفعيل الربط
                        </Button>
                    )}
                    <Button variant="secondary" size="sm" loading={testing} disabled={testing} onClick={() => void runTest()}>
                        اختبار الاتصال
                    </Button>
                </div>
                {testResult ? (
                    <p className="text-body-sm text-success-text">
                        تستجيب HTTP {String(testResult.http_status)} — {String(testResult.latency_ms)}ms
                    </p>
                ) : null}
                {testError ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {testError}
                    </p>
                ) : null}
                <FieldGrid columns={3}>
                    {statsChips(stats).map((chip) => (
                        <div key={chip.key} className="rounded-lg border border-hairline bg-surface-sunken p-sm">
                            <p className="text-caption text-muted">{chip.label}</p>
                            <p className="erp-numeric text-heading-lg text-ink" dir="ltr">
                                {formatNumber(chip.value)}
                            </p>
                        </div>
                    ))}
                </FieldGrid>
            </SectionCard>

            <SectionCard title="بيانات المكلف" english="Taxpayer" badge={<ReadOnlyBadge visible={canWrite} />}>
                <FieldGrid columns={3}>
                    <Input
                        label="اسم المنشأة"
                        value={value.seller_name}
                        maxLength={500}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('seller_name', event.target.value);
                        }}
                    />
                    <Input
                        label="الرقم الضريبي"
                        value={value.vat_number}
                        maxLength={15}
                        inputMode="numeric"
                        dir="ltr"
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('vat_number', event.target.value);
                        }}
                    />
                    <Input
                        label="السجل التجاري"
                        value={value.crn}
                        maxLength={500}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('crn', event.target.value);
                        }}
                    />
                    <Input
                        label="الفرع"
                        value={value.branch_name}
                        maxLength={500}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('branch_name', event.target.value);
                        }}
                    />
                    <Input
                        label="العنوان"
                        value={value.address}
                        maxLength={500}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('address', event.target.value);
                        }}
                    />
                    <Input
                        label="الحل البرمجي"
                        value={value.solution_name}
                        maxLength={500}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('solution_name', event.target.value);
                        }}
                    />
                    <Select
                        label="البيئة"
                        options={environments.map((env) => ({ value: env.value, label: env.label }))}
                        value={value.environment}
                        disabled={!canWrite}
                        onValueChange={(next) => {
                            draft.set('environment', next);
                        }}
                    />
                    <Input
                        label="عنوان API"
                        placeholder={config.default_api_base}
                        dir="ltr"
                        maxLength={500}
                        value={value.api_base}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('api_base', event.target.value);
                        }}
                    />
                    <Input
                        label="الهوية"
                        value={value.eid}
                        dir="ltr"
                        maxLength={500}
                        placeholder={config.eid_masked}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('eid', event.target.value);
                        }}
                    />
                    <Input
                        label="أقصى محاولات"
                        type="number"
                        min={1}
                        max={50}
                        dir="ltr"
                        value={value.max_attempts}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('max_attempts', event.target.value);
                        }}
                    />
                </FieldGrid>
                <Checkbox
                    label="مزامنة تلقائية من الخادم"
                    checked={value.poll_in_server}
                    disabled={!canWrite}
                    onCheckedChange={(checked) => {
                        draft.set('poll_in_server', checked === true);
                    }}
                />
            </SectionCard>

            <SectionCard title="الشهادة والإعدادات" english="Credentials" badge={<ReadOnlyBadge visible={canWrite} />}>
                <div className="flex flex-wrap items-center gap-xs">
                    <Button
                        variant="secondary"
                        size="sm"
                        loading={csr.isPending}
                        disabled={!canWrite || csr.isPending}
                        onClick={() => csr.mutate()}
                    >
                        {config.has_csr ? 'إعادة توليد CSR' : 'توليد CSR'}
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={!canWrite}
                        onClick={() => {
                            setActionError('');
                            setCsidOpen(true);
                        }}
                    >
                        {config.has_csid ? 'إعادة طلب CSID' : 'طلب CSID برمز OTP'}
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={!canWrite}
                        onClick={() => {
                            setActionError('');
                            setManualOpen(true);
                        }}
                    >
                        إدخال شهادة يدويًا
                    </Button>
                    {config.has_csid ? (
                        <Button
                            variant="danger"
                            size="sm"
                            loading={clearCsid.isPending}
                            disabled={!canWrite}
                            onClick={async () => {
                                const ok = await confirm('حذف شهادة CSID المحفوظة؟ سيتوقف الإبلاغ للهيئة حتى تُدخل شهادة جديدة.');
                                if (ok) {
                                    clearCsid.mutate();
                                }
                            }}
                        >
                            حذف الشهادة
                        </Button>
                    ) : null}
                    <Button
                        variant="secondary"
                        size="sm"
                        loading={applyVat.isPending}
                        disabled={!canWrite || applyVat.isPending}
                        onClick={async () => {
                            const vat = value.vat_number.replace(/\D/g, '');
                            if (!/^\d{15}$/.test(vat)) {
                                toast({ title: 'احفظ رقمًا ضريبيًا من 15 رقمًا أولًا', variant: 'error' });
                                return;
                            }
                            const ok = await confirm(`سيتم تطبيق الرقم الضريبي ${vat} على جميع الأقسام/الفروع. متابعة؟`);
                            if (ok) {
                                applyVat.mutate();
                            }
                        }}
                    >
                        تطبيق الرقم على الأقسام
                    </Button>
                </div>
                <div className="flex flex-wrap gap-md text-body-sm text-muted">
                    <span>CSR: {config.has_csr ? 'موجود' : 'غير موجود'}</span>
                    <span>المفتاح الخاص: {config.has_private_key ? 'موجود' : 'غير موجود'}</span>
                    <span>
                        CSID: {config.csid_masked || '—'} · {formatStamp(config.csid_obtained_at)}
                    </span>
                </div>
            </SectionCard>

            <SaveBar
                dirty={draft.dirty}
                saving={save.isPending}
                {...(error ? { error } : {})}
                onSave={submit}
                onReset={() => {
                    setError('');
                    draft.reset();
                }}
                disabled={!canWrite}
            />

            <SectionCard
                title="طابور الإبلاغ"
                english="Reporting Queue"
                badge={<Badge variant="neutral">{formatNumber(queueRows.length)} صف</Badge>}
                actions={
                    <>
                        <Button variant="ghost" size="sm" loading={queueQuery.isFetching} onClick={() => void queueQuery.refetch()}>
                            تحديث
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            loading={retry.isPending}
                            disabled={!canWrite || retry.isPending}
                            onClick={async () => {
                                const ok = await confirm('إعادة محاولة الفواتير الفاشلة فقط؟');
                                if (ok) {
                                    retry.mutate('failed');
                                }
                            }}
                        >
                            إعادة الفاشلة
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            loading={retry.isPending}
                            disabled={!canWrite || retry.isPending}
                            onClick={async () => {
                                const ok = await confirm('إعادة جدولة كل الفواتير الفاشلة والنهائية للإرسال من جديد؟');
                                if (ok) {
                                    retry.mutate('all');
                                }
                            }}
                        >
                            إعادة الكل
                        </Button>
                    </>
                }
            >
                {queueQuery.isPending ? (
                    <p className="text-body-sm text-muted">جارٍ تحميل الطابور…</p>
                ) : queueQuery.error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {writeErrorMessage(queueQuery.error, 'تعذّر تحميل الطابور')}
                    </p>
                ) : queueRows.length === 0 ? (
                    <p className="text-body-sm text-muted">لا مهام في الطابور.</p>
                ) : (
                    <TableScroll label="طابور فواتير ZATCA">
                        <table className="erp-table__grid">
                            <thead>
                                <tr>
                                    <th scope="col">الفاتورة</th>
                                    <th scope="col">القسم</th>
                                    <th scope="col">الإجمالي</th>
                                    <th scope="col">الحالة</th>
                                    <th scope="col">المحاولات</th>
                                    <th scope="col">آخر خطأ</th>
                                    <th scope="col">أُبلغت</th>
                                </tr>
                            </thead>
                            <tbody>
                                {queueRows.map((row) => (
                                    <tr key={row.id}>
                                        <td>
                                            <span className="erp-numeric" dir="ltr">
                                                {row.invoice_number}
                                            </span>
                                        </td>
                                        <td>{row.department_name || '—'}</td>
                                        <td>
                                            <span className="erp-numeric" dir="ltr">
                                                {formatNumber(row.total_amount)}
                                            </span>
                                        </td>
                                        <td>
                                            <Badge variant={STATUS_TONE[row.status] ?? 'neutral'}>
                                                {STATUS_LABEL[row.status] ?? row.status}
                                            </Badge>
                                        </td>
                                        <td>
                                            <span className="erp-numeric" dir="ltr">
                                                {String(row.attempts)}/{String(row.max_attempts)}
                                            </span>
                                        </td>
                                        <td className="text-muted">{row.last_error.slice(0, 80) || '—'}</td>
                                        <td>{formatStamp(row.reported_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                )}
            </SectionCard>

            <Dialog
                open={csrOpen}
                onOpenChange={setCsrOpen}
                title="CSR"
                size="lg"
                footer={
                    <>
                        <Button variant="secondary" size="sm" onClick={() => setCsrOpen(false)}>
                            إغلاق
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={!csrText}
                            onClick={() => {
                                void navigator.clipboard?.writeText(csrText);
                            }}
                        >
                            نسخ
                        </Button>
                    </>
                }
            >
                <Textarea label="محتوى CSR" value={csrText} readOnly rows={10} dir="ltr" />
            </Dialog>

            <Dialog
                open={csidOpen}
                onOpenChange={setCsidOpen}
                title="طلب CSID"
                footer={
                    <>
                        <Button variant="secondary" size="sm" onClick={() => setCsidOpen(false)}>
                            إغلاق
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            loading={requestCsid.isPending}
                            disabled={requestCsid.isPending || !/^\d{6}$/.test(otp.trim())}
                            onClick={() => requestCsid.mutate()}
                        >
                            إرسال الطلب
                        </Button>
                    </>
                }
            >
                <Input
                    label="رمز OTP"
                    value={otp}
                    maxLength={6}
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="######"
                    autoComplete="one-time-code"
                    onChange={(event) => {
                        setOtp(event.target.value.replace(/\D/g, ''));
                    }}
                />
                {actionError ? (
                    <p role="alert" className="mt-sm text-body-sm text-danger-text">
                        {actionError}
                    </p>
                ) : null}
            </Dialog>

            <Dialog
                open={manualOpen}
                onOpenChange={setManualOpen}
                title="إدخال شهادة يدويًا"
                size="lg"
                footer={
                    <>
                        <Button variant="secondary" size="sm" onClick={() => setManualOpen(false)}>
                            إغلاق
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            loading={saveManual.isPending}
                            disabled={saveManual.isPending || !manualCsid.trim()}
                            onClick={() => saveManual.mutate()}
                        >
                            حفظ الشهادة
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Textarea
                        label="رمز الشهادة"
                        value={manualCsid}
                        rows={5}
                        dir="ltr"
                        placeholder="MIIC…"
                        onChange={(event) => {
                            setManualCsid(event.target.value);
                        }}
                    />
                    <Input
                        label="الرقم الضريبي (اختياري)"
                        value={manualVat}
                        maxLength={20}
                        inputMode="numeric"
                        dir="ltr"
                        onChange={(event) => {
                            setManualVat(event.target.value);
                        }}
                    />
                    {actionError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {actionError}
                        </p>
                    ) : null}
                </div>
            </Dialog>
        </div>
    );
}
