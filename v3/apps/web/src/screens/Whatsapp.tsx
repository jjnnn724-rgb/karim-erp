import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card } from '../components/TableState';
import { WhatsappWorkbench } from '../components/WhatsappWorkbench';
import { formatInt } from '../lib/format';
import {
    resolveWhatsappStateAr,
    type WhatsappStatus,
    whatsappEngineState,
    whatsappIsConnected,
    whatsappTemplateRows,
} from '../lib/whatsapp';
import { fetchWhatsappMessages, fetchWhatsappOutbox, fetchWhatsappStatus, fetchWhatsappTemplates } from '../lib/whatsapp-write';

function Kpi({ label, english, value, hint }: { label: string; english: string; value: string; hint: string }) {
    return (
        <li className="rounded-lg border border-hairline bg-surface p-md shadow-card">
            <p className="text-label-md text-muted">
                {label}{' '}
                <span className="text-caption text-faint" dir="ltr" lang="en">
                    {english}
                </span>
            </p>
            <p className="erp-numeric mt-xs text-heading-lg text-ink" dir="ltr">
                {value}
            </p>
            <p className="mt-xxs text-caption text-muted">{hint}</p>
        </li>
    );
}

export function Whatsapp() {
    const statusQuery = useQuery({
        queryKey: ['whatsapp', 'status'],
        queryFn: ({ signal }) => fetchWhatsappStatus(signal),
        refetchInterval: 15_000,
    });

    const messagesQuery = useQuery({
        queryKey: ['whatsapp', 'messages'],
        queryFn: ({ signal }) => fetchWhatsappMessages(50, signal),
    });

    const outboxQuery = useQuery({
        queryKey: ['whatsapp', 'outbox'],
        queryFn: ({ signal }) => fetchWhatsappOutbox(signal),
    });

    const templatesQuery = useQuery({
        queryKey: ['whatsapp', 'templates'],
        queryFn: ({ signal }) => fetchWhatsappTemplates(signal),
    });

    const status: WhatsappStatus = statusQuery.data || { status: 'DISCONNECTED', connected: false };
    const messages = messagesQuery.data?.rows || [];
    const outbox = outboxQuery.data?.rows || [];
    const templates = useMemo(() => whatsappTemplateRows(templatesQuery.data), [templatesQuery.data]);

    const stateDisplay = useMemo(() => resolveWhatsappStateAr(whatsappEngineState(status), whatsappIsConnected(status)), [status]);

    const statusError = statusQuery.isError ? statusQuery.error?.message || 'تعذّر جلب حالة واتساب' : '';

    return (
        <div className="flex flex-col gap-lg">
            <header className="flex flex-wrap items-end justify-between gap-md border-b border-hairline pb-md">
                <div>
                    <h1 className="text-display-lg text-ink">
                        واتساب والتنبيهات{' '}
                        <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                            WhatsApp
                        </span>
                    </h1>
                    <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                        حالة اتصال محرك واتساب، سجل الرسائل الواردة، صندوق الصادر، وقوالب الإشعارات التلقائية.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-xs">
                    <PrintActions title="واتساب والتنبيهات" />
                    <span
                        className={`rounded-full px-sm py-xs text-label-md font-medium ${
                            stateDisplay.tone === 'success'
                                ? 'bg-success/15 text-success'
                                : stateDisplay.tone === 'warn'
                                  ? 'bg-warn/15 text-warn'
                                  : stateDisplay.tone === 'danger'
                                    ? 'bg-danger/15 text-danger'
                                    : 'bg-surface-sunken text-muted'
                        }`}
                    >
                        {stateDisplay.label}
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            void statusQuery.refetch();
                            void messagesQuery.refetch();
                            void outboxQuery.refetch();
                            void templatesQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات واتساب">
                <Kpi
                    label="حالة المحرك"
                    english="Connection state"
                    value={stateDisplay.label}
                    hint={status.phone ? `الرقم: ${status.phone}` : status.connection?.lastError || 'الاتصال المباشر'}
                />
                <Kpi
                    label="سجل الرسائل"
                    english="Recent messages"
                    value={formatInt(messagesQuery.data?.total ?? messages.length)}
                    hint="عدد المحادثات المسجلة في صندوق الوارد"
                />
                <Kpi label="صندوق الصادر" english="Outbox items" value={formatInt(outbox.length)} hint="الرسائل الصادرة وقيد الإرسال" />
                <Kpi label="قوالب التنبيه" english="Templates" value={formatInt(templates.length)} hint="القوالب الجاهزة للإرسال الآلي" />
            </ul>

            <Card>
                <WhatsappWorkbench
                    status={statusQuery.data}
                    statusPending={statusQuery.isPending}
                    statusError={statusError}
                    onRefreshStatus={() => void statusQuery.refetch()}
                />
            </Card>
        </div>
    );
}
