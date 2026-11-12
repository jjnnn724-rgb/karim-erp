import './Zkteco.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { ZktecoAdmin } from '../components/ZktecoAdmin';
import { ZktecoControl } from '../components/ZktecoControl';
import { ZktecoWorkbench } from '../components/ZktecoWorkbench';
import { errorMessage, intOf, num } from '../lib/reporting';
import { deviceToRow, fetchZkStatus, summarizeDevices } from '../lib/zkteco';

/**
 * أجهزة البصمة — حالة المحرك والأجهزة والربط (قراءة فقط).
 * التزامن والتشغيل والإيقاف والإضافة كلها أبواب كتابة تبقى في القديم.
 */
export function Zkteco() {
    const statusQuery = useQuery({
        queryKey: ['zkteco', 'status'],
        queryFn: ({ signal }) => fetchZkStatus(signal),
    });

    const payload = statusQuery.data;
    const rows = useMemo(() => (payload?.devices ?? []).map(deviceToRow), [payload]);
    const counts = summarizeDevices(rows);
    const totals = payload?.totals ?? {};
    const running = payload?.running === true;
    const unlinked = num(totals.unlinkedEmployees);

    return (
        <div className="flex flex-col gap-md erp-premium erp-premium-zkteco">
            <ReportHeader
                title="أجهزة البصمة"
                english="ZKTeco Devices"
                description="محرك المزامنة وأجهزة البصمة وعدد البصمات اليوم وربط الموظفين."
                pending={statusQuery.isFetching}
                onRefresh={() => {
                    void statusQuery.refetch();
                }}
            />
            <div className="flex justify-end gap-xs" data-erp-print-hide>
                <PrintActions title="أجهزة البصمة" />
            </div>

            {statusQuery.isPending ? <StateLoading label="جارٍ قراءة حالة أجهزة البصمة…" /> : null}

            {statusQuery.isError ? (
                <StateError
                    message={errorMessage(statusQuery.error)}
                    onRetry={() => {
                        void statusQuery.refetch();
                    }}
                />
            ) : null}

            {payload ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات أجهزة البصمة">
                        <KpiCard
                            label="محرك المزامنة"
                            english="Sync engine"
                            value={running ? 'يعمل' : 'متوقف'}
                            hint="حالة المحرك في هذه اللحظة"
                            tone={running ? 'success' : 'danger'}
                        />
                        <KpiCard
                            label="الأجهزة"
                            english="Devices"
                            value={`${intOf(counts.online)} / ${intOf(counts.total)}`}
                            hint="متصل من إجمالي الأجهزة"
                        />
                        <KpiCard
                            label="بصمات اليوم"
                            english="Punches today"
                            value={intOf(totals.today)}
                            hint="من دفتر البصمات غير المتجاهَل"
                        />
                        <KpiCard
                            label="موظفون بلا ربط"
                            english="Unlinked employees"
                            value={intOf(unlinked)}
                            hint="ليس لهم رقم بصمة على أي جهاز"
                            tone={unlinked > 0 ? 'warning' : 'success'}
                        />
                    </ul>

                    <ZktecoWorkbench devices={rows} running={running} />

                    <ZktecoAdmin devices={rows} />

                    <SectionCard
                        title="الأجهزة"
                        english="Devices"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(counts.enabled)} مفعّل · ${intOf(counts.syncing)} يزامن الآن`}
                            </span>
                        }
                    >
                        {rows.length === 0 ? (
                            <StateEmpty title="لا أجهزة مسجلة" hint="لا أجهزة مسجّلة." />
                        ) : (
                            <TableScroll label="جدول أجهزة البصمة">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الجهاز
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                العنوان
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الحالة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                آخر مزامنة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                بصمات مزامنة
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((device) => (
                                            <tr key={device.id} className="border-b border-hairline hover:bg-surface-hover">
                                                <td className="px-sm py-xxs text-ink">
                                                    {device.name}
                                                    {device.enabled ? null : <span className="text-caption text-faint"> (معطّل)</span>}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {device.ip ? `${device.ip}:${device.port}` : '—'}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm">
                                                    <span className={device.status === 'متصل' ? 'text-success-text' : 'text-muted'}>
                                                        {device.syncing ? 'يزامن الآن' : device.status}
                                                    </span>
                                                    {device.failures > 0 ? (
                                                        <span className="text-caption text-danger-text" dir="ltr">
                                                            {` (${String(device.failures)} فشل)`}
                                                        </span>
                                                    ) : null}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {device.lastSyncAt || '—'}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {intOf(device.totalSynced)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>

                    {rows.some((device) => device.lastError) ? (
                        <p className="rounded-md border border-warning bg-surface p-sm text-body-sm text-warning-text" role="alert">
                            {rows
                                .filter((device) => device.lastError)
                                .map((device) => `${device.name}: ${device.lastError}`)
                                .join(' · ')}
                        </p>
                    ) : null}

                    <p className="text-caption text-muted" role="status">
                        {`الموظفون: ${intOf(totals.employees)} · المربوطون: ${intOf(totals.linkedEmployees)} · سجل البصمات: ${intOf(totals.logs)}`}
                    </p>

                    <ZktecoControl />
                </>
            ) : null}

            {statusQuery.isPending ? (
                <SectionCard title="الأجهزة" english="Devices">
                    <TableSkeleton rows={4} columns={5} />
                </SectionCard>
            ) : null}
        </div>
    );
}
