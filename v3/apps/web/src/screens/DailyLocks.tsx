import './DailyLocks.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { PrintActions } from '../components/PrintActions';
import { StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { ApiError } from '../lib/api';
import {
    dailyLockRows,
    displayTotals,
    fetchDailyLocks,
    isLocked,
    type DailyLocksResponse,
} from '../lib/daily-locks';
import { formatInt } from '../lib/format';
import { errorMessage, qtyOf, todayIso } from '../lib/reporting';

/**
 * لوحة التقفيل اليومي — قراءة فقط (ADR-001).
 *
 * الخادم يعيد لكل قسم: إيراد/مرتجع/صافي/عدد فواتير/مرتجعات/عدد التقفيلات،
 * وشاشتُه القديمة تعرض منه مؤشرات اليوم وجدول الأقسام. هنا نفس العرض ونفس
 * الأرقام. لا مسار فتح/إغلاق في القديم ولا في الخادم — التكافؤ كامل.
 */

function errorText(error: unknown): string {
    if (error instanceof ApiError) {
        if (error.isAuthProblem) {
            return `${error.message} — تحقّق من الجلسة أو صلاحية الحساب.`;
        }
        return error.message;
    }
    return errorMessage(error);
}

function lockedLabel(locked: boolean): string {
    return locked ? 'مقفّل' : 'مفتوح';
}

export function DailyLocks() {
    const [date, setDate] = useState(() => todayIso());

    const locksQuery = useQuery({
        queryKey: ['daily-locks', date],
        queryFn: ({ signal }) => fetchDailyLocks(date, signal),
    });

    const data: DailyLocksResponse | undefined = locksQuery.data;
    const rows = dailyLockRows(data);
    const totals = displayTotals(data);
    const locked = Number(data?.locked ?? rows.filter((row) => isLocked(row)).length);
    const unlocked = Number(data?.unlocked ?? rows.length - locked);
    const day = String(data?.date ?? date);

    return (
        <div className="daily-locks-premium flex flex-col gap-md">
            <ReportHeader
                title="لوحة التقفيل اليومي"
                english="Daily Locks"
                description="أقسام يومٍ واحد: حالة الإقفال والإيراد والمرتجع والصافي."
                pending={locksQuery.isFetching}
                onRefresh={() => {
                    void locksQuery.refetch();
                }}
            />
            <div className="flex justify-end gap-xs" data-erp-print-hide>
                <PrintActions title="لوحة التقفيل اليومي" />
            </div>

            <SectionCard title="اليوم" english="Day">
                <div className="flex flex-wrap items-end gap-sm p-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="dl-date">
                        اليوم
                        <input
                            id="dl-date"
                            type="date"
                            value={date}
                            onChange={(event) => {
                                setDate(event.target.value);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            dir="ltr"
                        />
                    </label>
                    <p className="text-body-sm text-muted">
                        يومٌ واحد في كل طلب — التغيير يجلب بيانات اليوم المختار من الخادم.
                    </p>
                </div>
            </SectionCard>

            {locksQuery.isPending ? (
                <SectionCard title="ملخص اليوم" english="Day summary">
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل لوحة التقفيل" />
                        <TableSkeleton rows={5} columns={5} />
                    </div>
                </SectionCard>
            ) : null}

            {locksQuery.isError ? (
                <SectionCard title="ملخص اليوم" english="Day summary">
                    <StateError
                        message={errorText(locksQuery.error)}
                        onRetry={() => {
                            void locksQuery.refetch();
                        }}
                    />
                </SectionCard>
            ) : null}

            {data ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-5" aria-label="مؤشرات التقفيل">
                        <KpiCard
                            label="اليوم"
                            english="Date"
                            value={day || '—'}
                            hint="اليوم المعروض كما أكّده الخادم"
                        />
                        <KpiCard
                            label="مقفّل"
                            english="Locked"
                            value={formatInt(locked)}
                            hint={`من ${formatInt(rows.length)} قسمًا`}
                            tone="success"
                        />
                        <KpiCard
                            label="مفتوح"
                            english="Unlocked"
                            value={formatInt(unlocked)}
                            hint={unlocked > 0 ? 'أقسام لم يُقفل يومها بعد' : 'كل الأقسام مقفلة'}
                            tone={unlocked > 0 ? 'danger' : 'neutral'}
                        />
                        <KpiCard
                            label="فواتير"
                            english="Invoices"
                            value={formatInt(totals.invoices)}
                            hint={`${formatInt(totals.refunds)} مرتجعًا`}
                        />
                        <KpiCard
                            label="صافي"
                            english="Net"
                            value={qtyOf(totals.net)}
                            hint={`إيراد ${qtyOf(totals.gross)} · مرتجع ${qtyOf(totals.refund)}`}
                        />
                    </ul>

                    <SectionCard
                        title="الأقسام"
                        english="Departments"
                        actions={<span className="text-body-sm text-muted">{formatInt(rows.length)} قسمًا</span>}
                    >
                        {rows.length === 0 ? (
                            <StateEmpty
                                title="لا أقسام في هذا اليوم"
                                hint="اختر يومًا آخر — القائمة تأتي من أقسام نقطة البيع المسجّلة."
                            />
                        ) : (
                            <TableScroll label="جدول تقفيل الأقسام">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                القسم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الحالة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                إيراد
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                مرتجع
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                صافي
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                فاتورة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                مرتجعات
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row, index) => {
                                            const rowLocked = isLocked(row);
                                            return (
                                                <tr
                                                    key={`${String(row.dept_code ?? '')}-${String(index)}`}
                                                    className={`border-b border-hairline ${
                                                        rowLocked ? '' : 'bg-surface-hover'
                                                    }`}
                                                >
                                                    <td className="px-sm py-xxs text-ink">
                                                        <b>{String(row.dept_name ?? '—')}</b>{' '}
                                                        <span
                                                            className="erp-numeric ms-xs text-caption text-muted"
                                                            dir="ltr"
                                                        >
                                                            {String(row.dept_code ?? '')}
                                                        </span>
                                                    </td>
                                                    <td className="px-sm py-xxs">
                                                        <span
                                                            className={`inline-block whitespace-nowrap rounded-sm border border-hairline px-xs text-caption ${
                                                                rowLocked ? 'text-success-text' : 'text-danger-text'
                                                            }`}
                                                        >
                                                            {lockedLabel(rowLocked)}
                                                        </span>
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                                        {qtyOf(row.gross)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                                        {qtyOf(row.refund)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                        <b>{qtyOf(row.net)}</b>
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                                        {formatInt(Number(row.invoices ?? 0))}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                                        {formatInt(Number(row.refunds ?? 0))}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>
                </>
            ) : null}
        </div>
    );
}
