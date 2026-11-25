import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ScreenHero } from '../ui';
import './Zkteco.premium.css';
import { AttendanceFixPanel } from '../components/AttendanceFixPanel';
import { SectionCard } from '../components/Reports';
import { StateError, StateLoading } from '../components/TableState';
import { ZktecoAdmin } from '../components/ZktecoAdmin';
import { ZktecoControl } from '../components/ZktecoControl';
import { ZktecoWorkbench } from '../components/ZktecoWorkbench';
import { fetchJson } from '../lib/api';
import { getAccessToken } from '../lib/auth';
import { errorMessage, intOf, num } from '../lib/reporting';
import { punchAttemptsSchema } from '../lib/settings';
import { deviceToRow, fetchZkStatus, summarizeDevices } from '../lib/zkteco';
import { PunchSection } from './settings/PunchSection';

/**
 * مركز التحكم بالبصمة والحضور — كل أدوات التحكم في مصدر واحد:
 *  • أجهزة ZKTeco (إضافة/تعديل/فحص/مزامنة/محرك/مسح/استيراد/ربط)
 *  • البصمة عبر كاميرا التطبيق (بوابة السيرفر) — تفعيل/تعطيل، Geofence، الوجه، الأجهزة، المحاولات
 *  • سجل البصمات الخام — تجاهل/استعادة، إعادة بناء الأيام، التغطية، المطابقة
 *  • الاستثناءات الجغرافية وقوالب الوجه والسجلات من القسمين أعلاه
 * جميعها بـ بوابات الخادم كما في الشاشات المخصصة — لا فتح إضافي هنا.
 */
export function PunchControl() {
    const statusQuery = useQuery({
        queryKey: ['zkteco', 'status'],
        queryFn: ({ signal }) => fetchZkStatus(signal),
    });
    const attemptsQuery = useQuery({
        queryKey: ['settings', 'punch-attempts'],
        queryFn: ({ signal }) => fetchJson(punchAttemptsSchema, '/api/attendance/portal/attempts?limit=1', getAccessToken(), { signal }),
        refetchOnWindowFocus: false,
    });

    const payload = statusQuery.data;
    const rows = useMemo(() => (payload?.devices ?? []).map(deviceToRow), [payload]);
    const counts = summarizeDevices(rows);
    const running = payload?.running === true;
    const totals = payload?.totals ?? {};

    return (
        <div className="flex flex-col gap-md erp-premium erp-premium-zkteco">
            <ScreenHero
                title="مركز التحكم بالبصمة والحضور"
                english="Fingerprint & Attendance Control"
                description="جهاز البصمة، كاميرا الموبايل، والموقع الجغرافي — كل التحكم هنا، كتابةً بتمرير السبب وخلفيها بوابات الخادم."
                actions={
                    <>
                        <button
                            type="button"
                            onClick={() => {
                                () => {
                                    void statusQuery.refetch();
                                };
                            }}
                            disabled={statusQuery.isFetching}
                            className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                        >
                            تحديث
                        </button>
                    </>
                }
            />

            {statusQuery.isPending ? <StateLoading label="جارٍ قراءة حالة الأجهزة…" /> : null}
            {statusQuery.isError ? (
                <StateError message={errorMessage(statusQuery.error)} onRetry={() => void statusQuery.refetch()} />
            ) : null}

            {payload ? (
                <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات التحكم">
                    <div className="rounded-lg border border-hairline bg-surface p-sm">
                        <p className="text-caption text-muted">أجهزة متصلة</p>
                        <p className="mt-xxs text-heading-md text-ink" dir="ltr">{`${intOf(counts.online)} / ${intOf(counts.total)}`}</p>
                        <p className="text-caption text-faint">{running ? 'المحرك يعمل' : 'المحرك متوقف'}</p>
                    </div>
                    <div className="rounded-lg border border-hairline bg-surface p-sm">
                        <p className="text-caption text-muted">بصمات اليوم (بوابة الكاميرا)</p>
                        <p className="mt-xxs text-heading-md text-ink" dir="ltr">
                            {intOf(attemptsQuery.data?.summary.accepted_24h ?? 0)}
                        </p>
                        <p className="text-caption text-faint">
                            مقبول/مرفوض: {intOf(attemptsQuery.data?.summary.accepted_24h ?? 0)} /{' '}
                            {intOf(attemptsQuery.data?.summary.rejected_24h ?? 0)}
                        </p>
                    </div>
                    <div className="rounded-lg border border-hairline bg-surface p-sm">
                        <p className="text-caption text-muted">خارج النطاق (٧ أيام)</p>
                        <p className="mt-xxs text-heading-md text-warning-text" dir="ltr">
                            {intOf(attemptsQuery.data?.summary.out_of_range_7d ?? 0)}
                        </p>
                        <p className="text-caption text-faint">جهاز مختلف: {intOf(attemptsQuery.data?.summary.device_mismatch_7d ?? 0)}</p>
                    </div>
                    <div className="rounded-lg border border-hairline bg-surface p-sm">
                        <p className="text-caption text-muted">بلا ربط</p>
                        <p className="mt-xxs text-heading-md text-warning-text" dir="ltr">
                            {intOf(num(totals.unlinkedEmployees))}
                        </p>
                        <p className="text-caption text-faint">أرقام تحتاج ربطًا بموظف</p>
                    </div>
                </ul>
            ) : null}

            {payload ? (
                <div className="flex flex-col gap-md">
                    <SectionCard
                        title="أجهزة البصمة — تحكم كامل"
                        english="Devices — full control"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(counts.enabled)} مفعّل · ${intOf(counts.syncing)} تتزامن`}
                            </span>
                        }
                    >
                        <p className="text-body-sm text-muted">إدارة الأجهزة، مسح الشبكة واستيراد الموظفين وربط الأرقام:</p>
                        <ZktecoWorkbench devices={rows} running={running} />
                        <ZktecoAdmin devices={rows} />
                    </SectionCard>

                    <SectionCard title="كاميرا التطبيق — كل الإعدادات" english="Camera Portal — full settings">
                        <p className="text-body-sm text-muted">
                            تفعيل/تعطيل، Geofence، محرك الوجه، أجهزة الموظفين، قوالب الوجه، سجل المحاولات، والاستثناءات الجغرافية:
                        </p>
                        <PunchSection />
                    </SectionCard>

                    <SectionCard title="التحكم في البصمات — الخام وإعادة البناء" english="Punch control — raw log & rebuild">
                        <p className="text-body-sm text-muted">بصمات خام بتجاهل/استعادة، إعادة بناء أيام الموظف، تغطية الربط، والمطابقة:</p>
                        <ZktecoControl />
                    </SectionCard>
                </div>
            ) : null}

            <SectionCard title="تصحيح أي بصمة — أي موظف، أي يوم" english="Fix any punch — any employee, any day">
                <AttendanceFixPanel />
            </SectionCard>
        </div>
    );
}
