import './EmployeePortal.premium.css';
import { useQuery } from '@tanstack/react-query';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { fetchPortalSnapshot, isOn, punchStateName, punchTimeText } from '../lib/employee-portal';
import { errorMessage, intOf, num, textOf } from '../lib/reporting';

/**
 * بوابة الموظف — البطاقة الذكية للقراءة: الربط، وحالة اليوم، وقوالب الوجه،
 * وسجل البصمات. البصمة نفسها والإجراءات تبقى في القديم.
 */
export function EmployeePortal() {
    const snapshotQuery = useQuery({
        queryKey: ['hr', 'employee-portal'],
        queryFn: ({ signal }) => fetchPortalSnapshot(signal),
    });

    const snapshot = snapshotQuery.data;
    const status = snapshot?.status ?? null;
    const punches = snapshot?.punches ?? null;
    const rows = punches?.punches ?? [];

    return (
        <div className="flex flex-col gap-md employeeportal-premium">
            <ReportHeader
                title="بوابة الموظف"
                english="Employee Portal"
                description="ربط الحساب بالموظف وحالة حضور اليوم وقوالب الوجه وسجل البصمات."
                pending={snapshotQuery.isFetching}
                onRefresh={() => {
                    void snapshotQuery.refetch();
                }}
            />
            <PrintActions title="بوابة الموظف" />

            {snapshotQuery.isPending ? <StateLoading label="جارٍ قراءة بوابة الموظف…" /> : null}

            {snapshotQuery.isError ? (
                <StateError
                    message={errorMessage(snapshotQuery.error)}
                    onRetry={() => {
                        void snapshotQuery.refetch();
                    }}
                />
            ) : null}

            {snapshot ? (
                <>
                    <ul
                        className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4"
                        aria-label="مؤشرات بوابة الموظف"
                    >
                        <KpiCard
                            label="الموظف"
                            english="Employee"
                            value={textOf(status?.employeeName) || 'غير مربوط'}
                            hint={
                                isOn(status?.hasEmployeeProfile)
                                    ? 'الحساب مرتبط بملف موظف'
                                    : 'راجع الموارد البشرية للربط'
                            }
                            tone={isOn(status?.hasEmployeeProfile) ? 'success' : 'warning'}
                        />
                        <KpiCard
                            label="بوابة البصمة"
                            english="Portal"
                            value={isOn(status?.enabled) ? 'مفعّلة' : 'مغلقة'}
                            hint={isOn(status?.geofence) ? 'الموقع مطلوب' : 'بلا تحقق موقع'}
                            tone={isOn(status?.enabled) ? 'success' : 'neutral'}
                        />
                        <KpiCard
                            label="حضور اليوم"
                            english="Today"
                            value={textOf(status?.today?.checkIn) || 'لم يسجل'}
                            hint={`انصراف: ${textOf(status?.today?.checkOut) || '—'}`}
                        />
                        <KpiCard
                            label="قالب الوجه"
                            english="Face template"
                            value={isOn(status?.faceEnrolled) ? 'مسجل' : 'غير مسجل'}
                            hint={isOn(status?.faceEnabled) ? 'محرك الوجه مفعّل' : 'محرك الوجه مغلق'}
                            tone={isOn(status?.faceEnrolled) ? 'success' : 'neutral'}
                        />
                    </ul>

                    <SectionCard
                        title="بصماتي"
                        english="My punches"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(punches?.punchCount ?? rows.length)} بصمة`}
                            </span>
                        }
                    >
                        {!isOn(punches?.linked) && rows.length === 0 ? (
                            <StateEmpty
                                title="لا ربط بجهاز البصمة"
                                hint={textOf(punches?.error) || 'اطلب من الموارد البشرية ربط رقمك على جهاز البصمة.'}
                            />
                        ) : rows.length === 0 ? (
                            <StateEmpty title="لا بصمات مسجلة" hint="لم تُسجَّل بصمة لهذا الحساب بعد." />
                        ) : (
                            <TableScroll label="جدول بصمات الموظف">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الوقت
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الحالة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الجهاز
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((punch) => (
                                            <tr
                                                key={punch.id}
                                                className="border-b border-hairline hover:bg-surface-hover"
                                            >
                                                <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                    {punchTimeText(punch)}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">
                                                    {punchStateName(num(punch.state))}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">
                                                    {textOf(punch.deviceName) || '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>

                    {snapshot.failures.length > 0 ? (
                        <p
                            className="rounded-md border border-warning bg-surface p-sm text-body-sm text-warning-text"
                            role="alert"
                        >
                            {`تعذّر قراءة: ${snapshot.failures.join(' · ')}`}
                        </p>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
