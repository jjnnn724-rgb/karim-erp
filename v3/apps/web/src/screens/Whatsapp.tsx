import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Card, StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { PrintActions } from '../components/PrintActions';
import { fetchJson } from '../lib/api';
import { getAccessToken } from '../lib/auth';
import { formatInt } from '../lib/format';
import {
    resolveWhatsappStateAr,
    type WhatsappMessage,
    type WhatsappOutbox,
    type WhatsappStatus,
    type WhatsappTemplate,
    whatsappMessagesResponseSchema,
    whatsappOutboxResponseSchema,
    whatsappStatusSchema,
    whatsappTemplatesResponseSchema,
} from '../lib/whatsapp';

function Kpi({
    label,
    english,
    value,
    hint,
}: {
    label: string;
    english: string;
    value: string;
    hint: string;
}) {
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
    const [tab, setTab] = useState<'messages' | 'outbox' | 'templates'>('messages');
    const [search, setSearch] = useState('');

    const statusQuery = useQuery({
        queryKey: ['whatsapp', 'status'],
        queryFn: () => fetchJson(whatsappStatusSchema, '/api/whatsapp/status', getAccessToken()),
    });

    const messagesQuery = useQuery({
        queryKey: ['whatsapp', 'messages'],
        queryFn: () => fetchJson(whatsappMessagesResponseSchema, '/api/whatsapp/messages?limit=50', getAccessToken()),
    });

    const outboxQuery = useQuery({
        queryKey: ['whatsapp', 'outbox'],
        queryFn: () => fetchJson(whatsappOutboxResponseSchema, '/api/whatsapp/outbox', getAccessToken()),
    });

    const templatesQuery = useQuery({
        queryKey: ['whatsapp', 'templates'],
        queryFn: () => fetchJson(whatsappTemplatesResponseSchema, '/api/whatsapp/templates', getAccessToken()),
    });

    const status: WhatsappStatus = statusQuery.data || { status: 'DISCONNECTED', connected: false };
    const messages: WhatsappMessage[] = messagesQuery.data?.rows || [];
    const outbox: WhatsappOutbox[] = outboxQuery.data?.rows || [];
    const templates: WhatsappTemplate[] = templatesQuery.data?.rows || [];

    const stateDisplay = useMemo(
        () => resolveWhatsappStateAr(status.status, status.connected),
        [status.status, status.connected],
    );

    const filteredMessages = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return messages;
        return messages.filter(
            (m) =>
                m.body.toLowerCase().includes(q) ||
                (m.from && m.from.toLowerCase().includes(q)) ||
                (m.to && m.to.toLowerCase().includes(q)),
        );
    }, [messages, search]);

    const filteredOutbox = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return outbox;
        return outbox.filter((o) => o.body.toLowerCase().includes(q) || o.to.toLowerCase().includes(q));
    }, [outbox, search]);

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
                    hint={status.phone ? `الرقم: ${status.phone}` : 'الاتصال المباشر'}
                />
                <Kpi
                    label="سجل الرسائل"
                    english="Recent messages"
                    value={formatInt(messages.length)}
                    hint="آخر الرسائل الواردة/المستلمة"
                />
                <Kpi
                    label="صندوق الصادر"
                    english="Outbox items"
                    value={formatInt(outbox.length)}
                    hint="الرسائل الصادرة وقيد الإرسال"
                />
                <Kpi
                    label="قوالب التنبيه"
                    english="Templates"
                    value={formatInt(templates.length)}
                    hint="القوالب الجاهزة للإرسال الآلي"
                />
            </ul>

            <Card>
                <div className="flex flex-col items-stretch justify-between gap-sm overflow-x-auto border-b border-hairline px-sm py-xs sm:flex-row sm:items-center">
                    <div className="flex min-w-max gap-xs">
                        <button
                            type="button"
                            onClick={() => setTab('messages')}
                            className={`rounded-md px-md py-xs text-button-md ${
                                tab === 'messages'
                                    ? 'bg-primary text-on-primary'
                                    : 'bg-surface text-ink hover:bg-surface-hover'
                            }`}
                        >
                            سجل الرسائل ({formatInt(messages.length)})
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab('outbox')}
                            className={`rounded-md px-md py-xs text-button-md ${
                                tab === 'outbox'
                                    ? 'bg-primary text-on-primary'
                                    : 'bg-surface text-ink hover:bg-surface-hover'
                            }`}
                        >
                            صندوق الصادر ({formatInt(outbox.length)})
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab('templates')}
                            className={`rounded-md px-md py-xs text-button-md ${
                                tab === 'templates'
                                    ? 'bg-primary text-on-primary'
                                    : 'bg-surface text-ink hover:bg-surface-hover'
                            }`}
                        >
                            القوالب ({formatInt(templates.length)})
                        </button>
                    </div>
                    {tab !== 'templates' && (
                        <input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="ابحث بالنص أو الرقم…"
                            className="h-10 w-full rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-64"
                        />
                    )}
                </div>

                {tab === 'messages' && (
                    <>
                        {messagesQuery.isPending ? (
                            <StateLoading label="جارٍ تحميل سجل الرسائل…" />
                        ) : messagesQuery.isError ? (
                            <StateError
                                message={messagesQuery.error?.message || 'تعذّر جلب الرسائل'}
                                onRetry={() => void messagesQuery.refetch()}
                            />
                        ) : filteredMessages.length === 0 ? (
                            <StateEmpty title="لا توجد رسائل" hint="لم يتم العثور على رسائل واردة مسجلة في النظام." />
                        ) : (
                            <TableScroll label="سجل رسائل واتساب">
                                <table className="w-full min-w-[680px] border-collapse text-body-md">
                                    <caption className="sr-only">سجل رسائل واتساب الواردة والصادرة</caption>
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الطرف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                نص الرسالة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                التاريخ والوقت
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الحالة
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredMessages.map((m) => (
                                            <tr key={m.id} className="border-b border-hairline hover:bg-surface-hover">
                                                <td className="erp-numeric px-sm py-xs text-ink font-medium" dir="ltr">
                                                    {m.from || m.to || '—'}
                                                </td>
                                                <td className="px-sm py-xs text-ink">{m.body}</td>
                                                <td className="erp-numeric px-sm py-xs text-muted" dir="ltr">
                                                    {m.timestamp || m.created_at || '—'}
                                                </td>
                                                <td className="px-sm py-xs text-start">
                                                    <span className="rounded-full bg-surface-sunken px-xs py-xxs text-caption text-muted">
                                                        {m.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </>
                )}

                {tab === 'outbox' && (
                    <>
                        {outboxQuery.isPending ? (
                            <StateLoading label="جارٍ تحميل صندوق الصادر…" />
                        ) : outboxQuery.isError ? (
                            <StateError
                                message={outboxQuery.error?.message || 'تعذّر جلب صندوق الصادر'}
                                onRetry={() => void outboxQuery.refetch()}
                            />
                        ) : filteredOutbox.length === 0 ? (
                            <StateEmpty title="صندوق الصادر فارغ" hint="لا توجد رسائل معلقة أو في انتظار الإرسال." />
                        ) : (
                            <TableScroll label="صندوق الصادر لواتساب">
                                <table className="w-full min-w-[680px] border-collapse text-body-md">
                                    <caption className="sr-only">سجل رسائل صندوق الصادر</caption>
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start">
                                                المستلم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                النص
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                تاريخ الإنشاء
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الحالة
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredOutbox.map((o) => (
                                            <tr key={o.id} className="border-b border-hairline hover:bg-surface-hover">
                                                <td className="erp-numeric px-sm py-xs text-ink font-medium" dir="ltr">
                                                    {o.to}
                                                </td>
                                                <td className="px-sm py-xs text-ink">{o.body}</td>
                                                <td className="erp-numeric px-sm py-xs text-muted" dir="ltr">
                                                    {o.created_at || '—'}
                                                </td>
                                                <td className="px-sm py-xs text-start">
                                                    <span className="rounded-full bg-surface-sunken px-xs py-xxs text-caption text-muted">
                                                        {o.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </>
                )}

                {tab === 'templates' && (
                    <>
                        {templatesQuery.isPending ? (
                            <StateLoading label="جارٍ تحميل القوالب…" />
                        ) : templatesQuery.isError ? (
                            <StateError
                                message={templatesQuery.error?.message || 'تعذّر جلب القوالب'}
                                onRetry={() => void templatesQuery.refetch()}
                            />
                        ) : templates.length === 0 ? (
                            <StateEmpty title="لا توجد قوالب" hint="لم يتم إعداد قوالب رسائل مسبقة." />
                        ) : (
                            <ul className="grid list-none gap-sm p-sm sm:grid-cols-2" aria-label="قوالب واتساب">
                                {templates.map((tpl) => (
                                    <li
                                        key={tpl.name}
                                        className="rounded-lg border border-hairline bg-surface-sunken p-md"
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-xs">
                                            <h3 className="text-heading-sm text-ink">{tpl.name}</h3>
                                            <span className="rounded-full bg-surface px-xs py-xxs text-caption text-muted border border-hairline">
                                                {tpl.category}
                                            </span>
                                        </div>
                                        <p className="mt-xs text-body-md text-ink whitespace-pre-wrap">{tpl.body}</p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </Card>
        </div>
    );
}
