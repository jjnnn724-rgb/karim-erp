import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useAuthState } from '../lib/auth';
import { formatInt } from '../lib/format';
import {
    resolveWhatsappStateAr,
    type WhatsappAutomationSettings,
    type WhatsappCampaign,
    type WhatsappStatus,
    whatsappEngineState,
    whatsappIsConnected,
    whatsappMessagePeer,
    whatsappOutboxPeer,
    whatsappOutboxPreview,
    whatsappTemplateRows,
    whatsappTemplateText,
} from '../lib/whatsapp';
import {
    AUTOMATION_TOGGLES,
    actOnWhatsappCampaign,
    addWhatsappManager,
    askWhatsappQuery,
    CAMPAIGN_STATUS_AR,
    type CampaignAction,
    CHAT_PRIORITY_OPTIONS,
    CHAT_STATUS_OPTIONS,
    campaignFormError,
    canManageWhatsapp,
    consentedCampaignRecipients,
    createWhatsappCampaign,
    deleteWhatsappManager,
    deleteWhatsappRule,
    fetchWhatsappAutomation,
    fetchWhatsappCampaigns,
    fetchWhatsappHealth,
    fetchWhatsappLogs,
    fetchWhatsappManagers,
    fetchWhatsappMessages,
    fetchWhatsappOutbox,
    fetchWhatsappQr,
    fetchWhatsappQueryCategories,
    fetchWhatsappRules,
    fetchWhatsappTemplates,
    isWhatsappAdmin,
    logoutWhatsapp,
    managerNumberError,
    messageFormError,
    pairingPhoneError,
    RULE_MATCH_OPTIONS,
    refreshWhatsappQr,
    requestWhatsappPairing,
    ruleFormError,
    saveWhatsappAutomation,
    saveWhatsappRule,
    saveWhatsappTemplate,
    sendWhatsappMessage,
    sendWhatsappTemplate,
    startWhatsapp,
    stopWhatsapp,
    templateFormError,
    testWhatsappAutomation,
    updateWhatsappChatMeta,
    WA_TEXT,
    type WhatsappRuleForm,
    waAnswerText,
    whatsappQrDataUrl,
} from '../lib/whatsapp-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/Toast';
import { useConfirm } from './ConfirmProvider';
import { StateEmpty, StateError, StateLoading, TableScroll } from './TableState';

/**
 * واتساب — كل تبويبات V2 (`frontend/app/js/v2/screens/whatsapp.js`) في V3:
 * الربط وQR، الوارد وحالة المحادثة، الصادر والإرسال، القوالب حفظًا وإرسالًا،
 * الحملات اعتمادًا وإلغاءً، قواعد الرد، أرقام الإدارة، التنبيهات، سجل
 * الأحداث، واسأل النظام.
 *
 * كل نداء يذهب لعقد الخادم حرفيًّا (`whatsapp-write.ts`)، والأدوار تُحجب
 * محليًّا كما V2 — والخادم يبقى الفاصل: `admin|manager` يكتبان، و`admin`
 * وحده لمسح الجلسة/القوالب/الحملات/أرقام الإدارة/التنبيهات.
 */

const WA_KEYS = {
    status: ['whatsapp', 'status'],
    health: ['whatsapp', 'health'],
    qr: ['whatsapp', 'qr'],
    messages: ['whatsapp', 'messages'],
    outbox: ['whatsapp', 'outbox'],
    templates: ['whatsapp', 'templates'],
    rules: ['whatsapp', 'rules'],
    managers: ['whatsapp', 'managers'],
    automation: ['whatsapp', 'automation'],
    campaigns: ['whatsapp', 'campaigns'],
    logs: ['whatsapp', 'logs'],
    queryCategories: ['whatsapp', 'query-categories'],
} as const;

type TabKey = 'connection' | 'inbox' | 'outbox' | 'templates' | 'campaigns' | 'rules' | 'managers' | 'automation' | 'logs' | 'query';

const TABS: readonly { key: TabKey; label: string; adminOnly?: boolean }[] = [
    { key: 'connection', label: 'الربط وQR' },
    { key: 'inbox', label: 'الوارد' },
    { key: 'outbox', label: 'صندوق الصادر' },
    { key: 'templates', label: 'القوالب' },
    { key: 'campaigns', label: 'الحملات' },
    { key: 'rules', label: 'قواعد الرد' },
    { key: 'managers', label: 'أرقام الإدارة', adminOnly: true },
    { key: 'automation', label: 'التنبيهات', adminOnly: true },
    { key: 'logs', label: 'سجل الأحداث' },
    { key: 'query', label: 'اسأل النظام' },
];

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-lg border border-hairline bg-surface-sunken p-sm">
            <p className="text-label-md text-muted">{label}</p>
            <p className="erp-numeric mt-xxs text-heading-md text-ink">{value}</p>
            {hint ? <p className="mt-xxs text-caption text-muted">{hint}</p> : null}
        </div>
    );
}

function FormError({ message }: { message: string }) {
    if (!message) {
        return null;
    }
    return (
        <p role="alert" className="text-body-sm text-danger-text">
            {message}
        </p>
    );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="border-t border-hairline">
            <header className="flex flex-wrap items-center justify-between gap-xs px-sm py-xs">
                <h3 className="text-heading-sm text-ink">{title}</h3>
                {action}
            </header>
            <div className="flex flex-col gap-sm px-sm pb-sm">{children}</div>
        </section>
    );
}

function useRole() {
    const auth = useAuthState();
    const role = auth.user?.role;
    return { role, canWrite: canManageWhatsapp(role), isAdmin: isWhatsappAdmin(role) };
}

/* ─── الربط وQR ─────────────────────────────────────────────────────────── */

type EngineAction = 'start' | 'stop' | 'logout' | 'qrRefresh';

function ConnectionPanel({
    status,
    statusPending,
    statusError,
    onRefreshStatus,
}: {
    status: WhatsappStatus | undefined;
    statusPending: boolean;
    statusError: string;
    onRefreshStatus: () => void;
}) {
    const { canWrite, isAdmin } = useRole();
    const confirm = useConfirm();
    const health = useQuery({
        queryKey: WA_KEYS.health,
        queryFn: ({ signal }) => fetchWhatsappHealth(signal),
        refetchInterval: 30_000,
    });
    const state = whatsappEngineState(status);
    const stateDisplay = resolveWhatsappStateAr(state, whatsappIsConnected(status));
    const [qrWanted, setQrWanted] = useState(false);
    const [qrImage, setQrImage] = useState<string | null>(null);
    const [phone, setPhone] = useState('');
    const [pairingCode, setPairingCode] = useState('');
    const [formError, setFormError] = useState('');

    useEffect(() => {
        if (state === 'QR_REQUIRED') {
            setQrWanted(true);
        }
        if (state === 'CONNECTED') {
            setQrWanted(false);
        }
    }, [state]);

    const qrQuery = useQuery({
        queryKey: WA_KEYS.qr,
        queryFn: ({ signal }) => fetchWhatsappQr(signal),
        enabled: qrWanted && !whatsappIsConnected(status),
        retry: false,
        refetchInterval: 15_000,
    });

    const qrPayload = qrQuery.data?.qr ?? '';
    useEffect(() => {
        if (!qrPayload) {
            setQrImage(null);
            return;
        }
        let alive = true;
        void whatsappQrDataUrl(qrPayload).then((url) => {
            if (alive) {
                setQrImage(url);
            }
        });
        return () => {
            alive = false;
        };
    }, [qrPayload]);

    const action = useWriteMutation<EngineAction, void>({
        mutationFn: async (kind) => {
            if (kind === 'start') {
                await startWhatsapp();
            } else if (kind === 'stop') {
                await stopWhatsapp();
            } else if (kind === 'logout') {
                await logoutWhatsapp();
            } else {
                await refreshWhatsappQr();
            }
        },
        successTitle: (kind) =>
            kind === 'start'
                ? WA_TEXT.started
                : kind === 'stop'
                  ? WA_TEXT.stopped
                  : kind === 'logout'
                    ? WA_TEXT.loggedOut
                    : WA_TEXT.qrRefreshed,
        invalidate: [WA_KEYS.status, WA_KEYS.health],
        onSuccess: (_data, kind) => {
            onRefreshStatus();
            if (kind === 'qrRefresh') {
                setQrWanted(true);
                window.setTimeout(onRefreshStatus, 1500);
            }
            if (kind === 'logout') {
                setQrWanted(false);
                setPairingCode('');
            }
        },
    });

    const pairing = useWriteMutation<string, void>({
        mutationFn: async (value) => {
            const data = await requestWhatsappPairing(value);
            setPairingCode(data.code ?? '');
        },
        successTitle: WA_TEXT.pairRequested,
        silentError: true,
        onError: (cause) => setFormError(writeErrorMessage(cause)),
        onSuccess: () => setFormError(''),
    });

    const requestLogout = async () => {
        if (!(await confirm('سيتم تسجيل خروج WhatsApp وإبطال الجلسة الحالية. هل تريد المتابعة؟', { confirmLabel: 'تسجيل الخروج' }))) {
            return;
        }
        action.mutate('logout');
    };

    const requestPairing = () => {
        const error = pairingPhoneError(phone);
        if (error) {
            setFormError(error);
            return;
        }
        pairing.mutate(phone);
    };

    return (
        <>
            {statusError ? <FormError message={statusError} /> : null}
            <div className="grid gap-sm p-sm sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                    label="حالة الاتصال"
                    value={stateDisplay.label}
                    hint={status?.connection?.lastError || (statusPending ? 'جارٍ جلب الحالة…' : 'لا توجد أخطاء مسجلة')}
                />
                <Metric label="آخر اتصال ناجح" value={status?.connection?.lastOkAt || '—'} hint="توقيت الخادم" />
                <Metric label="وارد معلق" value={formatInt(health.data?.inboxPending ?? 0)} hint="رسائل لم تعالج بعد" />
                <Metric
                    label="صادر مستحق"
                    value={formatInt(health.data?.queueDue ?? 0)}
                    hint={`ردود تلقائية: ${formatInt(status?.metrics?.replied ?? 0)}`}
                />
            </div>

            <Section title="إدارة الاتصال">
                {canWrite ? (
                    <>
                        <div className="flex flex-wrap gap-xs">
                            <Button
                                size="sm"
                                onClick={() => action.mutate('start')}
                                loading={action.isPending && action.variables === 'start'}
                            >
                                بدء المحرك
                            </Button>
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => action.mutate('stop')}
                                loading={action.isPending && action.variables === 'stop'}
                            >
                                إيقاف المحرك
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setQrWanted(true)}>
                                جلب QR
                            </Button>
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => action.mutate('qrRefresh')}
                                loading={action.isPending && action.variables === 'qrRefresh'}
                            >
                                إنشاء QR جديد
                            </Button>
                            {isAdmin ? (
                                <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={() => void requestLogout()}
                                    loading={action.isPending && action.variables === 'logout'}
                                >
                                    مسح جلسة الربط
                                </Button>
                            ) : null}
                        </div>
                        <div className="flex flex-wrap items-end gap-sm">
                            <Input
                                label="رقم دولي لرمز الربط"
                                hint="مثال: 9665XXXXXXXX — دون +"
                                dir="ltr"
                                className="erp-numeric"
                                inputMode="tel"
                                autoComplete="tel"
                                value={phone}
                                onChange={(event) => setPhone(event.target.value)}
                                containerClassName="w-full sm:w-64"
                            />
                            <Button size="sm" variant="secondary" onClick={requestPairing} loading={pairing.isPending}>
                                طلب رمز الهاتف
                            </Button>
                        </div>
                        {pairingCode ? (
                            <p className="rounded-md bg-success/10 px-sm py-xs text-body-md text-success">
                                رمز الربط:{' '}
                                <b className="erp-numeric" dir="ltr">
                                    {pairingCode}
                                </b>
                            </p>
                        ) : null}
                        <FormError message={formError} />
                    </>
                ) : (
                    <p className="text-body-sm text-muted">المشاهدة متاحة لهذا الدور؛ إدارة الربط تتطلب صلاحية مدير.</p>
                )}

                <div className="rounded-lg border border-hairline bg-surface-sunken p-sm text-center" aria-live="polite">
                    {whatsappIsConnected(status) ? (
                        <p className="text-body-md text-success">الجهاز متصل — لا حاجة إلى QR</p>
                    ) : !qrWanted ? (
                        <p className="text-body-sm text-muted">اطلب QR لبدء الربط.</p>
                    ) : qrQuery.fetchStatus === 'fetching' ? (
                        <p role="status" className="text-body-sm text-muted">
                            جارٍ طلب رمز الربط…
                        </p>
                    ) : qrQuery.isError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {writeErrorMessage(qrQuery.error, 'تعذّر جلب QR')}
                        </p>
                    ) : qrImage ? (
                        <div className="flex flex-col items-center gap-xs">
                            <img src={qrImage} alt="رمز ربط واتساب مؤقت" className="size-60 rounded-md bg-white p-xs" />
                            <p className="text-body-sm text-muted">امسح الرمز من واتساب ← الأجهزة المرتبطة. الرمز مؤقت ويتجدد تلقائيًا.</p>
                            {qrQuery.data?.at ? (
                                <time className="erp-numeric text-caption text-muted" dir="ltr">
                                    {qrQuery.data.at}
                                </time>
                            ) : null}
                        </div>
                    ) : (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {WA_TEXT.qrUnavailable}
                        </p>
                    )}
                </div>
            </Section>
            <div className="px-sm pb-sm">
                <Button size="sm" variant="ghost" onClick={onRefreshStatus}>
                    تحديث الحالة
                </Button>
            </div>
        </>
    );
}

/* ─── الوارد وحالة المحادثة ─────────────────────────────────────────────── */

function InboxPanel() {
    const { canWrite } = useRole();
    const [search, setSearch] = useState('');
    const [target, setTarget] = useState<{ jid: string; status: string; priority: string } | null>(null);
    const [error, setError] = useState('');
    const query = useQuery({
        queryKey: WA_KEYS.messages,
        queryFn: ({ signal }) => fetchWhatsappMessages(50, signal),
    });
    const rows = query.data?.rows ?? [];
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) {
            return rows;
        }
        return rows.filter((row) => {
            const peer = whatsappMessagePeer(row).toLowerCase();
            return row.body.toLowerCase().includes(q) || peer.includes(q) || row.status.toLowerCase().includes(q);
        });
    }, [rows, search]);

    const saveMeta = useWriteMutation<{ jid: string; status: string; priority: string }, void>({
        mutationFn: async (meta) => {
            await updateWhatsappChatMeta(meta.jid, { status: meta.status, priority: meta.priority });
        },
        successTitle: WA_TEXT.chatSaved,
        invalidate: [WA_KEYS.messages],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause)),
        onSuccess: () => {
            setTarget(null);
            setError('');
        },
    });

    if (query.isPending) {
        return <StateLoading label="جارٍ تحميل سجل الرسائل…" />;
    }
    if (query.isError) {
        return <StateError message={query.error?.message || 'تعذّر جلب الرسائل'} onRetry={() => void query.refetch()} />;
    }

    return (
        <>
            <div className="flex flex-col items-stretch justify-between gap-sm border-b border-hairline px-sm py-xs sm:flex-row sm:items-center">
                <p className="text-body-sm text-muted">
                    آخر {formatInt(rows.length)} رسالة
                    {typeof query.data?.total === 'number' ? ` من ${formatInt(query.data.total)}` : ''}
                </p>
                <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="ابحث بالنص أو الرقم…"
                    className="h-10 w-full rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-64"
                />
            </div>
            {filtered.length === 0 ? (
                <StateEmpty title="لا توجد رسائل" hint="لم يتم العثور على رسائل واردة مسجلة في النظام." />
            ) : (
                <TableScroll label="سجل رسائل واتساب">
                    <table className="w-full min-w-[820px] border-collapse text-body-md">
                        <caption className="sr-only">سجل رسائل واتساب الواردة</caption>
                        <thead>
                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                <th scope="col" className="px-sm py-xs text-start">
                                    الوقت
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    المحادثة
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    الرسالة
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    المعالجة
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    حالة المحادثة
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    الأولوية
                                </th>
                                {canWrite ? (
                                    <th scope="col" className="px-sm py-xs text-start">
                                        إجراء
                                    </th>
                                ) : null}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((message) => (
                                <tr key={message.id} className="border-b border-hairline hover:bg-surface-hover">
                                    <td className="erp-numeric px-sm py-xs text-muted" dir="ltr">
                                        {message.created_at || message.timestamp || '—'}
                                    </td>
                                    <td className="erp-numeric px-sm py-xs font-medium text-ink" dir="ltr">
                                        {whatsappMessagePeer(message)}
                                    </td>
                                    <td className="px-sm py-xs text-ink">{message.body || '—'}</td>
                                    <td className="px-sm py-xs text-start">
                                        <span className="rounded-full bg-surface-sunken px-xs py-xxs text-caption text-muted">
                                            {message.status}
                                        </span>
                                    </td>
                                    <td className="px-sm py-xs text-muted">
                                        {CHAT_STATUS_OPTIONS.find((option) => option.value === message.chat_status)?.label ?? '—'}
                                    </td>
                                    <td className="px-sm py-xs text-muted">
                                        {CHAT_PRIORITY_OPTIONS.find((option) => option.value === message.chat_priority)?.label ?? '—'}
                                    </td>
                                    {canWrite ? (
                                        <td className="px-sm py-xs text-start">
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => {
                                                    setError('');
                                                    setTarget({
                                                        jid: whatsappMessagePeer(message),
                                                        status: message.chat_status || 'open',
                                                        priority: message.chat_priority || 'normal',
                                                    });
                                                }}
                                                disabled={whatsappMessagePeer(message) === '—'}
                                            >
                                                المحادثة
                                            </Button>
                                        </td>
                                    ) : null}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableScroll>
            )}

            <Dialog
                open={target !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setTarget(null);
                        setError('');
                    }
                }}
                title="حالة المحادثة"
                {...(target?.jid ? { description: target.jid } : {})}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setTarget(null)}>
                            إلغاء
                        </Button>
                        <Button onClick={() => target && saveMeta.mutate(target)} loading={saveMeta.isPending}>
                            حفظ
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Select
                        label="حالة المحادثة"
                        options={CHAT_STATUS_OPTIONS}
                        value={target?.status ?? 'open'}
                        onValueChange={(value) => setTarget((current) => (current ? { ...current, status: value } : current))}
                    />
                    <Select
                        label="الأولوية"
                        options={CHAT_PRIORITY_OPTIONS}
                        value={target?.priority ?? 'normal'}
                        onValueChange={(value) => setTarget((current) => (current ? { ...current, priority: value } : current))}
                    />
                    <FormError message={error} />
                </div>
            </Dialog>
        </>
    );
}

/* ─── الصادر والإرسال ──────────────────────────────────────────────────── */

function OutboxPanel() {
    const { canWrite } = useRole();
    const [to, setTo] = useState('');
    const [body, setBody] = useState('');
    const [error, setError] = useState('');
    const query = useQuery({
        queryKey: WA_KEYS.outbox,
        queryFn: ({ signal }) => fetchWhatsappOutbox(signal),
    });
    const send = useWriteMutation<void, void>({
        mutationFn: async () => {
            await sendWhatsappMessage(to, body);
        },
        successTitle: WA_TEXT.sent,
        invalidate: [WA_KEYS.outbox],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause)),
        onSuccess: () => {
            setBody('');
            setError('');
        },
    });

    const submit = () => {
        const invalid = messageFormError(to, body);
        if (invalid) {
            setError(invalid);
            return;
        }
        send.mutate();
    };

    const rows = query.data?.rows ?? [];

    return (
        <>
            {query.isPending ? (
                <StateLoading label="جارٍ تحميل صندوق الصادر…" />
            ) : query.isError ? (
                <StateError message={query.error?.message || 'تعذّر جلب صندوق الصادر'} onRetry={() => void query.refetch()} />
            ) : rows.length === 0 ? (
                <StateEmpty title="صندوق الصادر فارغ" hint="لا توجد رسائل معلقة أو في انتظار الإرسال." />
            ) : (
                <TableScroll label="صندوق الصادر لواتساب">
                    <table className="w-full min-w-[760px] border-collapse text-body-md">
                        <caption className="sr-only">سجل رسائل صندوق الصادر</caption>
                        <thead>
                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                <th scope="col" className="px-sm py-xs text-start">
                                    الوقت
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    إلى
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    الرسالة
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    الحالة والمحاولات
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    آخر خطأ
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                    <td className="erp-numeric px-sm py-xs text-muted" dir="ltr">
                                        {row.created_at || '—'}
                                    </td>
                                    <td className="erp-numeric px-sm py-xs font-medium text-ink" dir="ltr">
                                        {whatsappOutboxPeer(row)}
                                    </td>
                                    <td className="px-sm py-xs text-ink">{whatsappOutboxPreview(row)}</td>
                                    <td className="px-sm py-xs text-muted">
                                        {row.status} ({formatInt(row.attempts)})
                                    </td>
                                    <td className="px-sm py-xs text-muted">{row.last_error || row.error || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableScroll>
            )}

            {canWrite ? (
                <Section title="إرسال رسالة">
                    <Input
                        label="المستلم (JID)"
                        hint="مثال: 9665XXXXXXXX@s.whatsapp.net"
                        dir="ltr"
                        className="erp-numeric"
                        value={to}
                        onChange={(event) => setTo(event.target.value)}
                        containerClassName="w-full sm:w-80"
                    />
                    <Textarea label="نص الرسالة" rows={4} maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} />
                    <FormError message={error} />
                    <div>
                        <Button onClick={submit} loading={send.isPending}>
                            إرسال إلى الطابور
                        </Button>
                    </div>
                </Section>
            ) : null}
        </>
    );
}

/* ─── القوالب ──────────────────────────────────────────────────────────── */

function TemplatesPanel() {
    const { canWrite, isAdmin } = useRole();
    const [form, setForm] = useState({ name: '', category: 'general', variables: '0', ar: '', en: '' });
    const [formError, setFormError] = useState('');
    const [send, setSend] = useState({ name: '', to: '', lang: 'ar', vars: '' });
    const [sendError, setSendError] = useState('');
    const query = useQuery({
        queryKey: WA_KEYS.templates,
        queryFn: ({ signal }) => fetchWhatsappTemplates(signal),
    });
    const rows = whatsappTemplateRows(query.data);

    const save = useWriteMutation<void, void>({
        mutationFn: async () => {
            await saveWhatsappTemplate({
                name: form.name,
                category: form.category,
                ar: form.ar,
                en: form.en,
                variables: Number(form.variables),
            });
        },
        successTitle: WA_TEXT.templateSaved,
        invalidate: [WA_KEYS.templates],
        silentError: true,
        onError: (cause) => setFormError(writeErrorMessage(cause)),
        onSuccess: () => {
            setForm({ name: '', category: 'general', variables: '0', ar: '', en: '' });
            setFormError('');
        },
    });

    const sendMutation = useWriteMutation<void, void>({
        mutationFn: async () => {
            await sendWhatsappTemplate({
                to: send.to,
                name: send.name,
                lang: send.lang === 'en' ? 'en' : 'ar',
                vars: send.vars
                    .split(/\r?\n/)
                    .map((value) => value.trim())
                    .filter(Boolean),
            });
        },
        successTitle: WA_TEXT.templateSent,
        invalidate: [WA_KEYS.outbox],
        silentError: true,
        onError: (cause) => setSendError(writeErrorMessage(cause)),
        onSuccess: () => setSendError(''),
    });

    const submitTemplate = () => {
        const invalid = templateFormError({
            name: form.name,
            category: form.category,
            ar: form.ar,
            en: form.en,
            variables: Number(form.variables),
        });
        if (invalid) {
            setFormError(invalid);
            return;
        }
        save.mutate();
    };

    if (query.isPending) {
        return <StateLoading label="جارٍ تحميل القوالب…" />;
    }
    if (query.isError) {
        return <StateError message={query.error?.message || 'تعذّر جلب القوالب'} onRetry={() => void query.refetch()} />;
    }

    return (
        <>
            {rows.length === 0 ? (
                <StateEmpty title="لا توجد قوالب" hint="لم يتم إعداد قوالب رسائل مسبقة." />
            ) : (
                <ul className="grid list-none gap-sm p-sm sm:grid-cols-2" aria-label="قوالب واتساب">
                    {rows.map((tpl) => (
                        <li key={tpl.name} className="rounded-lg border border-hairline bg-surface-sunken p-md">
                            <div className="flex flex-wrap items-center justify-between gap-xs">
                                <h3 className="text-heading-sm text-ink">{tpl.name}</h3>
                                <span className="rounded-full border border-hairline bg-surface px-xs py-xxs text-caption text-muted">
                                    {tpl.category} · {formatInt(tpl.variables)} متغير
                                </span>
                            </div>
                            {whatsappTemplateText(tpl) ? (
                                <p className="mt-xs whitespace-pre-wrap text-body-md text-ink">{whatsappTemplateText(tpl)}</p>
                            ) : null}
                            {tpl.en ? (
                                <p className="mt-xs whitespace-pre-wrap text-body-sm text-muted" dir="ltr">
                                    {tpl.en}
                                </p>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}

            {isAdmin ? (
                <Section title="حفظ قالب">
                    <div className="grid gap-sm sm:grid-cols-3">
                        <Input
                            label="الاسم"
                            maxLength={120}
                            value={form.name}
                            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        />
                        <Input
                            label="الفئة"
                            maxLength={80}
                            value={form.category}
                            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                        />
                        <Input
                            label="عدد المتغيرات"
                            type="number"
                            min={0}
                            max={20}
                            value={form.variables}
                            onChange={(event) => setForm((current) => ({ ...current, variables: event.target.value }))}
                        />
                    </div>
                    <Textarea
                        label="النص العربي"
                        rows={3}
                        value={form.ar}
                        onChange={(event) => setForm((current) => ({ ...current, ar: event.target.value }))}
                    />
                    <Textarea
                        label="النص الإنجليزي"
                        rows={3}
                        dir="ltr"
                        value={form.en}
                        onChange={(event) => setForm((current) => ({ ...current, en: event.target.value }))}
                    />
                    <FormError message={formError} />
                    <div>
                        <Button onClick={submitTemplate} loading={save.isPending}>
                            حفظ القالب
                        </Button>
                    </div>
                </Section>
            ) : null}

            {canWrite ? (
                <Section title="إرسال قالب">
                    <div className="grid gap-sm sm:grid-cols-3">
                        <Select
                            label="القالب"
                            options={rows.map((tpl) => ({ value: tpl.name, label: tpl.name }))}
                            placeholder={rows.length ? 'اختر…' : 'لا توجد قوالب'}
                            {...(send.name ? { value: send.name } : {})}
                            onValueChange={(value) => setSend((current) => ({ ...current, name: value }))}
                            disabled={rows.length === 0}
                        />
                        <Input
                            label="المستلم (JID)"
                            dir="ltr"
                            className="erp-numeric"
                            placeholder="9665XXXXXXXX@s.whatsapp.net"
                            value={send.to}
                            onChange={(event) => setSend((current) => ({ ...current, to: event.target.value }))}
                        />
                        <Select
                            label="اللغة"
                            options={[
                                { value: 'ar', label: 'العربية' },
                                { value: 'en', label: 'English' },
                            ]}
                            value={send.lang}
                            onValueChange={(value) => setSend((current) => ({ ...current, lang: value }))}
                        />
                    </div>
                    <Textarea
                        label="المتغيرات — قيمة في كل سطر"
                        rows={3}
                        value={send.vars}
                        onChange={(event) => setSend((current) => ({ ...current, vars: event.target.value }))}
                    />
                    <FormError message={sendError} />
                    <div>
                        <Button
                            onClick={() => {
                                if (!send.name) {
                                    setSendError('اختر قالبًا');
                                    return;
                                }
                                if (!send.to.trim()) {
                                    setSendError('أدخل المستلم بصيغة 9665XXXXXXXX@s.whatsapp.net');
                                    return;
                                }
                                sendMutation.mutate();
                            }}
                            loading={sendMutation.isPending}
                            disabled={rows.length === 0}
                        >
                            إرسال إلى الطابور
                        </Button>
                    </div>
                </Section>
            ) : null}
        </>
    );
}

/* ─── الحملات ──────────────────────────────────────────────────────────── */

function CampaignsPanel() {
    const { isAdmin } = useRole();
    const confirm = useConfirm();
    const [form, setForm] = useState({ name: '', templateName: '', scheduledAt: '', recipients: '' });
    const [formError, setFormError] = useState('');
    const [actionError, setActionError] = useState('');
    const query = useQuery({
        queryKey: WA_KEYS.campaigns,
        queryFn: ({ signal }) => fetchWhatsappCampaigns(signal),
    });

    const create = useWriteMutation<void, void>({
        mutationFn: async () => {
            await createWhatsappCampaign({
                name: form.name,
                templateName: form.templateName,
                recipients: consentedCampaignRecipients(form.recipients),
                ...(form.scheduledAt ? { scheduledAt: form.scheduledAt } : {}),
            });
        },
        successTitle: WA_TEXT.campaignCreated,
        invalidate: [WA_KEYS.campaigns],
        silentError: true,
        onError: (cause) => setFormError(writeErrorMessage(cause)),
        onSuccess: () => {
            setForm({ name: '', templateName: '', scheduledAt: '', recipients: '' });
            setFormError('');
        },
    });

    const act = useWriteMutation<{ id: string; action: CampaignAction }, void>({
        mutationFn: async ({ id, action }) => {
            await actOnWhatsappCampaign(id, action);
        },
        successTitle: WA_TEXT.campaignUpdated,
        invalidate: [WA_KEYS.campaigns],
        silentError: true,
        onError: (cause) => setActionError(writeErrorMessage(cause)),
        onSuccess: () => setActionError(''),
    });

    const submit = () => {
        const invalid = campaignFormError({
            name: form.name,
            templateName: form.templateName,
            recipients: consentedCampaignRecipients(form.recipients),
            ...(form.scheduledAt ? { scheduledAt: form.scheduledAt } : {}),
        });
        if (invalid) {
            setFormError(invalid);
            return;
        }
        create.mutate();
    };

    const runAction = async (campaign: WhatsappCampaign, action: CampaignAction) => {
        const prompts: Record<CampaignAction, string> = {
            approve: 'اعتماد الحملة؟ سيبدأ إرسال الرسائل للمستلمين ذوي الموافقة فقط.',
            pause: 'إيقاف الحملة مؤقتاً؟',
            cancel: 'إلغاء الحملة نهائياً؟',
        };
        if (!(await confirm(prompts[action]))) {
            return;
        }
        act.mutate({ id: campaign.id, action });
    };

    if (query.isPending) {
        return <StateLoading label="جارٍ تحميل الحملات…" />;
    }
    if (query.isError) {
        return <StateError message={query.error?.message || 'تعذّر جلب الحملات'} onRetry={() => void query.refetch()} />;
    }
    const campaigns = query.data?.campaigns ?? [];

    return (
        <>
            {campaigns.length === 0 ? (
                <StateEmpty title="لا توجد حملات" hint="أنشئ مسودة حملة ثم اعتمدها للإرسال." />
            ) : (
                <TableScroll label="سجل حملات واتساب">
                    <table className="w-full min-w-[900px] border-collapse text-body-md">
                        <caption className="sr-only">سجل الحملات</caption>
                        <thead>
                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                <th scope="col" className="px-sm py-xs text-start">
                                    الحملة
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    القالب
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    الحالة
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    موافقون / مستلمون
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    مرسلة
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    الجدولة
                                </th>
                                {isAdmin ? (
                                    <th scope="col" className="px-sm py-xs text-start">
                                        إجراءات
                                    </th>
                                ) : null}
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.map((campaign) => (
                                <tr key={campaign.id} className="border-b border-hairline hover:bg-surface-hover">
                                    <td className="px-sm py-xs font-medium text-ink">{campaign.name || '—'}</td>
                                    <td className="erp-numeric px-sm py-xs text-ink" dir="ltr">
                                        {campaign.template_name || '—'}
                                    </td>
                                    <td className="px-sm py-xs text-muted">{CAMPAIGN_STATUS_AR[campaign.status] ?? campaign.status}</td>
                                    <td className="erp-numeric px-sm py-xs text-muted" dir="ltr">
                                        {formatInt(campaign.consented)} / {formatInt(campaign.recipients)}
                                    </td>
                                    <td className="erp-numeric px-sm py-xs text-muted">{formatInt(campaign.sent)}</td>
                                    <td className="erp-numeric px-sm py-xs text-muted" dir="ltr">
                                        {campaign.scheduled_at || 'فور الاعتماد'}
                                    </td>
                                    {isAdmin ? (
                                        <td className="px-sm py-xs text-start">
                                            <div className="flex flex-wrap gap-xxs">
                                                {campaign.status === 'draft' ? (
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        onClick={() => void runAction(campaign, 'approve')}
                                                    >
                                                        اعتماد
                                                    </Button>
                                                ) : null}
                                                {['approved', 'running'].includes(campaign.status) ? (
                                                    <Button size="sm" variant="secondary" onClick={() => void runAction(campaign, 'pause')}>
                                                        إيقاف
                                                    </Button>
                                                ) : null}
                                                {!['completed', 'cancelled'].includes(campaign.status) ? (
                                                    <Button size="sm" variant="danger" onClick={() => void runAction(campaign, 'cancel')}>
                                                        إلغاء
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </td>
                                    ) : null}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableScroll>
            )}
            <FormError message={actionError} />

            {isAdmin ? (
                <Section title="إنشاء حملة مسودة">
                    <div className="grid gap-sm sm:grid-cols-3">
                        <Input
                            label="اسم الحملة"
                            maxLength={160}
                            value={form.name}
                            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        />
                        <Input
                            label="اسم القالب"
                            maxLength={120}
                            value={form.templateName}
                            onChange={(event) => setForm((current) => ({ ...current, templateName: event.target.value }))}
                        />
                        <Input
                            label="موعد الإرسال (اختياري)"
                            type="datetime-local"
                            value={form.scheduledAt}
                            onChange={(event) => setForm((current) => ({ ...current, scheduledAt: event.target.value }))}
                        />
                    </div>
                    <Textarea
                        label="المستلمون — رقم|موافقة|المتغيرات (موافقة: yes)، سطر لكل مستلم"
                        rows={5}
                        dir="ltr"
                        placeholder="9665XXXXXXXX@s.whatsapp.net|yes|أحمد,123"
                        value={form.recipients}
                        onChange={(event) => setForm((current) => ({ ...current, recipients: event.target.value }))}
                    />
                    <p className="text-body-sm text-muted">
                        لا تُدرج إلا الأرقام المعلّمة بموافقة صريحة. إنشاء الحملة لا يرسلها؛ الإرسال يتطلب اعتمادًا منفصلًا.
                    </p>
                    <FormError message={formError} />
                    <div>
                        <Button onClick={submit} loading={create.isPending}>
                            إنشاء مسودة
                        </Button>
                    </div>
                </Section>
            ) : null}
        </>
    );
}

/* ─── قواعد الرد ───────────────────────────────────────────────────────── */

const EMPTY_RULE: WhatsappRuleForm = { name: '', match_type: 'exact', pattern: '', response: '', enabled: true };

function RulesPanel() {
    const { canWrite } = useRole();
    const confirm = useConfirm();
    const [form, setForm] = useState<WhatsappRuleForm>(EMPTY_RULE);
    const [error, setError] = useState('');
    const query = useQuery({
        queryKey: WA_KEYS.rules,
        queryFn: ({ signal }) => fetchWhatsappRules(signal),
    });
    const rows = query.data?.rows ?? [];

    const save = useWriteMutation<void, void>({
        mutationFn: async () => {
            await saveWhatsappRule(form);
        },
        successTitle: WA_TEXT.ruleSaved,
        invalidate: [WA_KEYS.rules],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause)),
        onSuccess: () => {
            setForm(EMPTY_RULE);
            setError('');
        },
    });

    const remove = useWriteMutation<string, void>({
        mutationFn: async (id) => {
            await deleteWhatsappRule(id);
        },
        successTitle: WA_TEXT.ruleDeleted,
        invalidate: [WA_KEYS.rules],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause)),
    });

    const submit = () => {
        const invalid = ruleFormError(form);
        if (invalid) {
            setError(invalid);
            return;
        }
        save.mutate();
    };

    if (query.isPending) {
        return <StateLoading label="جارٍ تحميل قواعد الرد…" />;
    }
    if (query.isError) {
        return <StateError message={query.error?.message || 'تعذّر جلب القواعد'} onRetry={() => void query.refetch()} />;
    }

    return (
        <>
            {rows.length === 0 ? (
                <StateEmpty title="لا توجد قواعد رد" hint="أضف قاعدة ليُجاب على الرسائل المتطابقة تلقائيًا." />
            ) : (
                <TableScroll label="قواعد الرد في واتساب">
                    <table className="w-full min-w-[760px] border-collapse text-body-md">
                        <caption className="sr-only">قواعد الرد</caption>
                        <thead>
                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                <th scope="col" className="px-sm py-xs text-start">
                                    الاسم
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    المطابقة
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    النمط
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    الرد
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    الحالة
                                </th>
                                {canWrite ? (
                                    <th scope="col" className="px-sm py-xs text-start">
                                        إجراءات
                                    </th>
                                ) : null}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((rule) => (
                                <tr key={rule.id} className="border-b border-hairline hover:bg-surface-hover">
                                    <td className="px-sm py-xs font-medium text-ink">{rule.name || '—'}</td>
                                    <td className="px-sm py-xs text-muted">
                                        {RULE_MATCH_OPTIONS.find((option) => option.value === rule.match_type)?.label ?? rule.match_type}
                                    </td>
                                    <td className="px-sm py-xs text-ink">{rule.pattern || '—'}</td>
                                    <td className="px-sm py-xs text-ink">{rule.response || '—'}</td>
                                    <td className="px-sm py-xs text-muted">{rule.enabled ? 'مفعّلة' : 'معطّلة'}</td>
                                    {canWrite ? (
                                        <td className="px-sm py-xs text-start">
                                            <div className="flex flex-wrap gap-xxs">
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => {
                                                        setError('');
                                                        setForm({
                                                            id: rule.id,
                                                            name: rule.name,
                                                            match_type: rule.match_type,
                                                            pattern: rule.pattern,
                                                            response: rule.response ?? '',
                                                            enabled: rule.enabled !== false,
                                                        });
                                                    }}
                                                >
                                                    تعديل
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="danger"
                                                    onClick={async () => {
                                                        if (await confirm('تعطيل قاعدة الرد هذه؟')) {
                                                            remove.mutate(rule.id);
                                                        }
                                                    }}
                                                >
                                                    تعطيل
                                                </Button>
                                            </div>
                                        </td>
                                    ) : null}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableScroll>
            )}

            {canWrite ? (
                <Section
                    title="إضافة أو تعديل قاعدة"
                    action={
                        <Button size="sm" variant="ghost" onClick={() => setForm(EMPTY_RULE)}>
                            مسح النموذج
                        </Button>
                    }
                >
                    <div className="grid gap-sm sm:grid-cols-2">
                        <Input
                            label="الاسم"
                            maxLength={120}
                            value={form.name}
                            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        />
                        <Select
                            label="نوع المطابقة"
                            options={RULE_MATCH_OPTIONS}
                            value={form.match_type}
                            onValueChange={(value) => setForm((current) => ({ ...current, match_type: value }))}
                        />
                    </div>
                    <Input
                        label="النمط"
                        maxLength={500}
                        value={form.pattern}
                        onChange={(event) => setForm((current) => ({ ...current, pattern: event.target.value }))}
                    />
                    <Textarea
                        label="الرد"
                        rows={3}
                        value={form.response}
                        onChange={(event) => setForm((current) => ({ ...current, response: event.target.value }))}
                    />
                    <Checkbox
                        label="مفعّلة"
                        checked={form.enabled}
                        onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked === true }))}
                    />
                    <FormError message={error} />
                    <div>
                        <Button onClick={submit} loading={save.isPending}>
                            {form.id ? 'تحديث القاعدة' : 'حفظ القاعدة'}
                        </Button>
                    </div>
                </Section>
            ) : null}
        </>
    );
}

/* ─── أرقام الإدارة (admin) ───────────────────────────────────────────── */

function ManagersPanel() {
    const confirm = useConfirm();
    const [number, setNumber] = useState('');
    const [error, setError] = useState('');
    const query = useQuery({
        queryKey: WA_KEYS.managers,
        queryFn: ({ signal }) => fetchWhatsappManagers(signal),
    });
    const numbers = query.data?.numbers ?? [];

    const add = useWriteMutation<string, void>({
        mutationFn: async (value) => {
            await addWhatsappManager(value);
        },
        successTitle: WA_TEXT.managerAdded,
        invalidate: [WA_KEYS.managers],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause)),
        onSuccess: () => {
            setNumber('');
            setError('');
        },
    });

    const remove = useWriteMutation<string, void>({
        mutationFn: async (value) => {
            await deleteWhatsappManager(value);
        },
        successTitle: WA_TEXT.managerDeleted,
        invalidate: [WA_KEYS.managers],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause)),
    });

    if (query.isPending) {
        return <StateLoading label="جارٍ تحميل أرقام الإدارة…" />;
    }
    if (query.isError) {
        return <StateError message={query.error?.message || 'تعذّر جلب أرقام الإدارة'} onRetry={() => void query.refetch()} />;
    }

    return (
        <Section title="أرقام الإدارة">
            <p className="text-body-sm text-muted">الأرقام المسجلة هنا مخولة باستخدام أوامر الإدارة عبر واتساب.</p>
            <div className="flex flex-wrap items-end gap-sm">
                <Input
                    label="رقم دولي (7 إلى 16 رقمًا)"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={16}
                    className="erp-numeric"
                    value={number}
                    onChange={(event) => setNumber(event.target.value)}
                    containerClassName="w-full sm:w-56"
                />
                <Button
                    onClick={() => {
                        const invalid = managerNumberError(number);
                        if (invalid) {
                            setError(invalid);
                            return;
                        }
                        add.mutate(number);
                    }}
                    loading={add.isPending}
                >
                    إضافة رقم
                </Button>
            </div>
            <FormError message={error} />
            {numbers.length === 0 ? (
                <StateEmpty title="لا توجد أرقام إدارة" hint="أضف رقمًا ليصل إليه تقرير التنبيهات وأوامر الإدارة." />
            ) : (
                <ul className="flex list-none flex-col gap-xxs">
                    {numbers.map((item) => (
                        <li key={item} className="flex items-center justify-between gap-sm rounded-md border border-hairline px-sm py-xs">
                            <span className="erp-numeric text-body-md text-ink" dir="ltr">
                                {item}
                            </span>
                            <Button
                                size="sm"
                                variant="danger"
                                onClick={async () => {
                                    if (await confirm(`حذف رقم الإدارة ${item}؟`)) {
                                        remove.mutate(item);
                                    }
                                }}
                            >
                                حذف
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}

/* ─── التنبيهات (admin) ────────────────────────────────────────────────── */

function AutomationPanel() {
    const confirm = useConfirm();
    const { toast } = useToast();
    const [draft, setDraft] = useState<WhatsappAutomationSettings>({ dailyTime: '23:30' });
    const [error, setError] = useState('');
    const query = useQuery({
        queryKey: WA_KEYS.automation,
        queryFn: ({ signal }) => fetchWhatsappAutomation(signal),
    });

    useEffect(() => {
        const settings = query.data?.settings;
        if (!settings) {
            return;
        }
        setDraft({
            dailyTime: settings.dailyTime || '23:30',
            dailyReport: settings.dailyReport !== false,
            alertDevice: settings.alertDevice !== false,
            alertUnmapped: settings.alertUnmapped !== false,
            alertFailed: settings.alertFailed !== false,
            alertDocs: settings.alertDocs !== false,
            alertShifts: settings.alertShifts !== false,
        });
    }, [query.data]);

    const save = useWriteMutation<void, void>({
        mutationFn: async () => {
            await saveWhatsappAutomation(draft);
        },
        successTitle: WA_TEXT.automationSaved,
        invalidate: [WA_KEYS.automation],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause)),
        onSuccess: () => setError(''),
    });

    const test = useWriteMutation<void, void>({
        mutationFn: async () => {
            const result = await testWhatsappAutomation();
            toast({
                title: `تم وضع التقرير التجريبي في الطابور (${formatInt(result.queued)} محادثة).`,
                variant: 'success',
            });
        },
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause)),
    });

    if (query.isPending) {
        return <StateLoading label="جارٍ تحميل إعدادات التنبيهات…" />;
    }
    if (query.isError) {
        return <StateError message={query.error?.message || 'تعذّر جلب التنبيهات'} onRetry={() => void query.refetch()} />;
    }

    return (
        <Section title="التقارير والتنبيهات المجدولة">
            <Input
                label="وقت التقرير اليومي"
                type="time"
                value={draft.dailyTime}
                onChange={(event) => setDraft((current) => ({ ...current, dailyTime: event.target.value }))}
                containerClassName="w-full sm:w-48"
            />
            <div className="flex flex-col gap-xs">
                {AUTOMATION_TOGGLES.map((toggle) => (
                    <Checkbox
                        key={toggle.key}
                        label={toggle.label}
                        checked={draft[toggle.key] !== false}
                        onCheckedChange={(checked) => setDraft((current) => ({ ...current, [toggle.key]: checked === true }))}
                    />
                ))}
            </div>
            <FormError message={error} />
            <div className="flex flex-wrap gap-xs">
                <Button
                    onClick={() => {
                        const invalid = /^\d{2}:\d{2}$/.test(draft.dailyTime) ? '' : 'وقت التقرير غير صالح';
                        if (invalid) {
                            setError(invalid);
                            return;
                        }
                        save.mutate();
                    }}
                    loading={save.isPending}
                >
                    حفظ الإعدادات
                </Button>
                <Button
                    variant="secondary"
                    loading={test.isPending}
                    onClick={async () => {
                        if (await confirm('إرسال التقرير التجريبي الآن إلى أرقام الإدارة المسجلة؟')) {
                            test.mutate();
                        }
                    }}
                >
                    إرسال تقرير تجريبي
                </Button>
            </div>
        </Section>
    );
}

/* ─── سجل الأحداث ─────────────────────────────────────────────────────── */

function LogsPanel() {
    const query = useQuery({
        queryKey: WA_KEYS.logs,
        queryFn: ({ signal }) => fetchWhatsappLogs(signal),
    });

    if (query.isPending) {
        return <StateLoading label="جارٍ تحميل سجل الأحداث…" />;
    }
    if (query.isError) {
        return <StateError message={query.error?.message || 'تعذّر جلب السجل'} onRetry={() => void query.refetch()} />;
    }
    const rows = query.data?.rows ?? [];
    if (rows.length === 0) {
        return <StateEmpty title="لا توجد أحداث" hint="لم تُسجَّل أحداث في محرك واتساب بعد." />;
    }

    return (
        <TableScroll label="سجل أحداث واتساب">
            <table className="w-full min-w-[720px] border-collapse text-body-md">
                <caption className="sr-only">سجل أحداث واتساب</caption>
                <thead>
                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                        <th scope="col" className="px-sm py-xs text-start">
                            الوقت
                        </th>
                        <th scope="col" className="px-sm py-xs text-start">
                            الحدث
                        </th>
                        <th scope="col" className="px-sm py-xs text-start">
                            المرجع
                        </th>
                        <th scope="col" className="px-sm py-xs text-start">
                            التفاصيل
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((entry, index) => (
                        <tr
                            key={entry.id ?? `${entry.created_at ?? ''}-${String(index)}`}
                            className="border-b border-hairline hover:bg-surface-hover"
                        >
                            <td className="erp-numeric px-sm py-xs text-muted" dir="ltr">
                                {entry.created_at || '—'}
                            </td>
                            <td className="px-sm py-xs text-ink">{entry.kind || '—'}</td>
                            <td className="erp-numeric px-sm py-xs text-muted" dir="ltr">
                                {entry.ref || '—'}
                            </td>
                            <td className="px-sm py-xs text-muted">{entry.detail || '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableScroll>
    );
}

/* ─── اسأل النظام ─────────────────────────────────────────────────────── */

function QueryPanel() {
    const [question, setQuestion] = useState('');
    const [answer, setAnswer] = useState('');
    const [error, setError] = useState('');
    const categories = useQuery({
        queryKey: WA_KEYS.queryCategories,
        queryFn: ({ signal }) => fetchWhatsappQueryCategories(signal),
    });
    const ask = useWriteMutation<string, void>({
        mutationFn: async (text) => {
            const result = await askWhatsappQuery(text);
            setAnswer(waAnswerText(result.result ?? ''));
        },
        silentError: true,
        onError: (cause) => {
            setAnswer('');
            setError(writeErrorMessage(cause));
        },
        onSuccess: () => setError(''),
    });

    const run = (text: string) => {
        if (!text.trim()) {
            setError('اكتب السؤال أولًا');
            return;
        }
        setError('');
        ask.mutate(text);
    };

    const chips = (categories.data?.categories ?? []).filter((category) => category.label);

    return (
        <Section title="اسأل النظام">
            <p className="text-body-sm text-muted">
                اكتب سؤالك في صندوق واحد، مثل: «مبيعات اليوم»، «أصناف تحت الحد»، «حضور الموظفين»، «ملخص مالي».
            </p>
            <div className="flex flex-wrap items-end gap-sm">
                <Input
                    label="سؤالك"
                    placeholder="مثال: مبيعات اليوم"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            run(question);
                        }
                    }}
                    containerClassName="w-full sm:w-96"
                />
                <Button onClick={() => run(question)} loading={ask.isPending}>
                    اسأل
                </Button>
            </div>
            {chips.length ? (
                <div className="flex flex-wrap gap-xs">
                    {chips.map((category) => (
                        <Button
                            key={category.key ?? category.label}
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                setQuestion(`${category.label} `);
                                run(String(category.label));
                            }}
                        >
                            {category.label}
                        </Button>
                    ))}
                </div>
            ) : null}
            <FormError message={error} />
            {ask.isPending ? (
                <p role="status" className="text-body-sm text-muted">
                    جارٍ تحليل السؤال…
                </p>
            ) : null}
            {answer ? (
                <div className="rounded-lg border border-hairline bg-surface-sunken p-sm">
                    <p className="text-label-md text-muted">الإجابة</p>
                    <p className="mt-xxs whitespace-pre-wrap text-body-md text-ink">{answer}</p>
                </div>
            ) : null}
        </Section>
    );
}

/* ─── الشاشة ──────────────────────────────────────────────────────────── */

export function WhatsappWorkbench({
    status,
    statusPending,
    statusError,
    onRefreshStatus,
}: {
    status: WhatsappStatus | undefined;
    statusPending: boolean;
    statusError: string;
    onRefreshStatus: () => void;
}) {
    const { isAdmin } = useRole();
    const [tab, setTab] = useState<TabKey>('inbox');
    const tabs = TABS.filter((item) => !item.adminOnly || isAdmin);

    return (
        <>
            <div role="tablist" aria-label="أقسام واتساب" className="flex overflow-x-auto border-b border-hairline px-sm py-xs">
                <div className="flex min-w-max gap-xs">
                    {tabs.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            role="tab"
                            aria-selected={tab === item.key}
                            onClick={() => setTab(item.key)}
                            className={`rounded-md px-md py-xs text-button-md ${
                                tab === item.key ? 'bg-primary text-on-primary' : 'bg-surface text-ink hover:bg-surface-hover'
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </div>

            {tab === 'connection' ? (
                <ConnectionPanel
                    status={status}
                    statusPending={statusPending}
                    statusError={statusError}
                    onRefreshStatus={onRefreshStatus}
                />
            ) : tab === 'inbox' ? (
                <InboxPanel />
            ) : tab === 'outbox' ? (
                <OutboxPanel />
            ) : tab === 'templates' ? (
                <TemplatesPanel />
            ) : tab === 'campaigns' ? (
                <CampaignsPanel />
            ) : tab === 'rules' ? (
                <RulesPanel />
            ) : tab === 'managers' ? (
                <ManagersPanel />
            ) : tab === 'automation' ? (
                <AutomationPanel />
            ) : tab === 'logs' ? (
                <LogsPanel />
            ) : (
                <QueryPanel />
            )}
        </>
    );
}
