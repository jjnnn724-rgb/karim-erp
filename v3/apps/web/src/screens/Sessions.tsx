import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Card, StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { PrintActions } from '../components/PrintActions';
import { fetchJson } from '../lib/api';
import { getAccessToken } from '../lib/auth';
import { formatInt } from '../lib/format';
import {
    computeSessionsSummary,
    formatSessionMoment,
    type SessionRow,
    type SessionsResponse,
    sessionsResponseSchema,
} from '../lib/sessions';

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

export function Sessions() {
    const [filter, setFilter] = useState('');
    const [actionMsg, setActionMsg] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const sessionsQuery = useQuery({
        queryKey: ['sessions'],
        queryFn: () => fetchJson(sessionsResponseSchema, '/api/auth/sessions', getAccessToken()),
    });

    const revokeMutation = useMutation({
        mutationFn: async (id: string) => {
            return fetchJson(sessionsResponseSchema, `/api/auth/sessions/${encodeURIComponent(id)}`, getAccessToken(), {
                method: 'DELETE',
            });
        },
        onSuccess: () => {
            setActionMsg('تم إبطال الجلسة بنجاح.');
            void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        },
        onError: (err: Error) => {
            setActionMsg(`تعذّر إبطال الجلسة: ${err.message}`);
        },
    });

    const revokeOthersMutation = useMutation({
        mutationFn: async () => {
            return fetchJson(sessionsResponseSchema, '/api/auth/sessions/revoke-others', getAccessToken(), {
                method: 'POST',
            });
        },
        onSuccess: () => {
            setActionMsg('تم إبطال جميع الجلسات الأخرى بنجاح.');
            void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        },
        onError: (err: Error) => {
            setActionMsg(`تعذّر إبطال الجلسات: ${err.message}`);
        },
    });

    const data: SessionsResponse = sessionsQuery.data || { ok: true, current_session_id: null, sessions: [] };
    const summary = useMemo(
        () => computeSessionsSummary(data.sessions, data.current_session_id),
        [data.sessions, data.current_session_id],
    );

    const filteredSessions = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return data.sessions;
        return data.sessions.filter(
            (s) =>
                s.device.toLowerCase().includes(q) ||
                (s.ip && s.ip.toLowerCase().includes(q)) ||
                s.id.toLowerCase().includes(q),
        );
    }, [data.sessions, filter]);

    const handleRevoke = (session: SessionRow) => {
        const isCurrent = session.current || session.id === data.current_session_id;
        const msg = isCurrent
            ? 'هل أنت متأكد من إبطال هذه الجلسة الحالية؟ سيتم تسجيل خروجك فورًا.'
            : `هل أنت متأكد من إبطال جلسة (${session.device})؟`;
        if (window.confirm(msg)) {
            revokeMutation.mutate(session.id);
        }
    };

    const handleRevokeOthers = () => {
        if (window.confirm('هل أنت متأكد من إبطال جميع الجلسات الأخرى المفتوحة على الأجهزة المختلفة؟')) {
            revokeOthersMutation.mutate();
        }
    };

    return (
        <div className="flex flex-col gap-lg">
            <header className="flex flex-wrap items-end justify-between gap-md border-b border-hairline pb-md">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الأجهزة والجلسات{' '}
                        <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                            Sessions
                        </span>
                    </h1>
                    <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                        عرض الجلسات النشطة والأجهزة المتصلة بحسابك، وإبطال أي جهاز غير موثوق به فورًا.
                    </p>
                </div>
                <div className="flex flex-wrap gap-xs">
                    <button
                        type="button"
                        onClick={() => void sessionsQuery.refetch()}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                    {summary.otherSessionsCount > 0 && (
                        <button
                            type="button"
                            onClick={handleRevokeOthers}
                            disabled={revokeOthersMutation.isPending}
                            className="rounded-md border border-warn bg-warn/10 px-md py-xs text-button-md text-warn hover:bg-warn/20"
                        >
                            {revokeOthersMutation.isPending ? 'جارٍ الإبطال…' : 'إبطال الجلسات الأخرى'}
                        </button>
                    )}
                    <PrintActions title="الجلسات" />
                </div>
            </header>

            {actionMsg && (
                <div className="rounded-md bg-surface-sunken p-sm text-body-sm text-ink" role="status">
                    {actionMsg}
                </div>
            )}

            <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات الجلسات">
                <Kpi
                    label="الجلسات النشطة"
                    english="Active sessions"
                    value={formatInt(summary.total)}
                    hint="إجمالي الأجهزة المسجلة للدخول"
                />
                <Kpi
                    label="جلسة هذا الجهاز"
                    english="Current device"
                    value={summary.currentDevice}
                    hint="الجهاز الحالي المستخدم للتصفح"
                />
                <Kpi
                    label="عنوان IP الحالي"
                    english="Current IP"
                    value={summary.currentIp}
                    hint="العنوان الصادر منه اتصالك"
                />
                <Kpi
                    label="الجلسات الأخرى"
                    english="Other devices"
                    value={formatInt(summary.otherSessionsCount)}
                    hint="أجهزة أخرى قد تظل مفتوحة"
                />
            </ul>

            <Card>
                <div className="flex flex-wrap items-center justify-between gap-sm px-sm py-xs">
                    <div>
                        <h2 className="text-heading-md text-ink">
                            سجل الجلسات والأجهزة{' '}
                            <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                                Devices list
                            </span>
                        </h2>
                        <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">قائمة مفصلة بكل جلسة مع توقيت بدء الاتصال وآخر ظهور.</p>
                    </div>
                    <label className="flex w-full flex-col items-stretch gap-xs text-label-md text-ink-secondary sm:w-auto sm:flex-row sm:items-center">
                        البحث
                        <input
                            type="search"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            placeholder="ابحث بالجهاز أو الـ IP…"
                            className="h-10 w-full rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-64"
                        />
                    </label>
                </div>

                {sessionsQuery.isPending ? (
                    <StateLoading label="جارٍ تحميل سجل الجلسات…" />
                ) : sessionsQuery.isError ? (
                    <StateError
                        message={sessionsQuery.error?.message || 'تعذّر جلب الجلسات'}
                        onRetry={() => void sessionsQuery.refetch()}
                    />
                ) : filteredSessions.length === 0 ? (
                    <StateEmpty title="لا توجد جلسات مطابقة" hint="لم يُعثر على جلسات توافق معيار البحث المدخل." />
                ) : (
                    <TableScroll label="سجل الجلسات النشطة">
                        <table className="w-full min-w-[760px] border-collapse text-body-md">
                            <caption className="sr-only">سجل الجلسات النشطة للأجهزة</caption>
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start">
                                        الجهاز
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start">
                                        عنوان IP
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start">
                                        بدأت في
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start">
                                        آخر نشاط
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start">
                                        تنتهي في
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start">
                                        الإجراءات
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredSessions.map((session) => {
                                    const isCurrent = session.current || session.id === data.current_session_id;
                                    return (
                                        <tr key={session.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xs text-ink font-medium">
                                                <div className="flex items-center gap-xs">
                                                    <span>{session.device}</span>
                                                    {isCurrent && (
                                                        <span className="rounded-full bg-primary/10 px-xs py-xxs text-caption text-primary">
                                                            الجلسة الحالية
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="erp-numeric px-sm py-xs text-muted" dir="ltr">
                                                {session.ip || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xs text-muted" dir="ltr">
                                                {formatSessionMoment(session.started_at)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xs text-ink" dir="ltr">
                                                {formatSessionMoment(session.last_seen_at)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xs text-muted" dir="ltr">
                                                {formatSessionMoment(session.expires_at)}
                                            </td>
                                            <td className="px-sm py-xs text-start">
                                                <button
                                                    type="button"
                                                    onClick={() => handleRevoke(session)}
                                                    disabled={revokeMutation.isPending}
                                                    className="rounded border border-hairline-strong px-xs py-xxs text-caption text-danger hover:bg-danger/10"
                                                >
                                                    إبطال الجلسة
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TableScroll>
                )}
            </Card>
        </div>
    );
}
