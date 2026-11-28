import './MenuCost.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { formatMoney } from '../lib/format';
import { fetchMenuCostToday, MENU_COST_STATUS_AR, type MenuCostRow } from '../lib/menu-cost';
import { ScreenHero } from '../ui';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

const intOf = (value: string | number | null | undefined): string =>
    value == null || value === '' ? '—' : Number(value).toLocaleString('en-US');
const moneyOf = (value: string | number | null | undefined): string =>
    value == null || value === '' ? '—' : `${formatMoney(String(value))} ر.س`;
const ratioOf = (value: string | number | null | undefined): string =>
    value == null || value === '' ? '—' : `${Number(value).toFixed(1)}%`;

type StatusFilter = 'all' | 'priced' | 'partial' | 'unpriced';

export function MenuCost() {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<StatusFilter>('all');

    const query = useQuery({
        queryKey: ['menu-cost', 'today'],
        queryFn: ({ signal }) => fetchMenuCostToday(undefined, signal),
        staleTime: 60_000,
        refetchInterval: 60_000,
        refetchOnWindowFocus: true,
    });

    const rows = useMemo(() => {
        const term = search.trim().toLowerCase();
        const list = (query.data?.rows ?? []).filter((row: MenuCostRow) => {
            if (status !== 'all' && row.pricing_status !== status) {
                return false;
            }
            if (!term) {
                return true;
            }
            return [row.name, row.name_en].some((value) =>
                String(value ?? '')
                    .toLowerCase()
                    .includes(term),
            );
        });
        return [...list].sort((a, b) => Number(b.daily_cost ?? 0) - Number(a.daily_cost ?? 0));
    }, [query.data, search, status]);

    const totals = query.data?.totals;

    return (
        <div className="menu-cost-screen mx-auto flex w-full min-w-0 flex-col gap-md">
            <ScreenHero
                title="محرك تسعير المنيو"
                english="MENU COST ENGINE"
                description="كل أصناف المنيو مُسعّرة من متوسط المخزن الحي — وتكلفة اليوم من الكمية المباعة فعليًا بتوقيت الرياض."
                actions={
                    <Button type="button" size="sm" variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}>
                        {query.isFetching ? 'جارٍ التحديث…' : 'تحديث'}
                    </Button>
                }
            />

            <div className="mc-kpis">
                <div className="mc-kpi">
                    <span>أصناف المنيو</span>
                    <b>{intOf(totals?.items)}</b>
                    <small>كل الأصناف النشطة</small>
                </div>
                <div className="mc-kpi mc-kpi--accent">
                    <span>تكلفة اليوم</span>
                    <b dir="ltr">{moneyOf(totals?.total_daily_cost)}</b>
                    <small>كميات اليوم × تكلفة الوحدة</small>
                </div>
                <div className="mc-kpi">
                    <span>مبيعات اليوم</span>
                    <b dir="ltr">{moneyOf(totals?.total_net_sales)}</b>
                    <small>صافي بعد الخصم والضريبة</small>
                </div>
                <div className="mc-kpi">
                    <span>نسبة الكوست</span>
                    <b dir="ltr">{ratioOf(totals?.cost_ratio)}</b>
                    <small>تكلفة اليوم ÷ المبيعات</small>
                </div>
                <div className="mc-kpi">
                    <span>مسعّر / بلا تسعير</span>
                    <b>
                        {intOf(totals?.priced_count)} / {intOf(totals?.unpriced_count)}
                    </b>
                    <small>الصنف بلا BOM أو بسعر مفقود يظهر بلا تسعير</small>
                </div>
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="mc-search">
                        بحث في المنيو
                        <input
                            id="mc-search"
                            type="search"
                            value={search}
                            placeholder="اسم الصنف…"
                            onChange={(event) => setSearch(event.target.value)}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="mc-status">
                        حالة التسعير
                        <select
                            id="mc-status"
                            value={status}
                            onChange={(event) => setStatus(event.target.value as StatusFilter)}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="all">كل الأصناف</option>
                            <option value="priced">مسعّر</option>
                            <option value="estimated">تقديري</option>
                            <option value="partial">جزئي</option>
                            <option value="unpriced">بلا تسعير</option>
                        </select>
                    </label>
                    <span className="text-caption text-muted" role="status">
                        {intOf(rows.length)} صنف · {query.data?.date ?? ''}
                    </span>
                </div>
            </Card>

            <Card>
                {query.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ حساب تكلفة المنيو…" />
                        <TableSkeleton rows={8} columns={8} />
                    </div>
                ) : null}
                {query.isError ? (
                    <StateError
                        message={query.error instanceof Error ? query.error.message : 'خطأ غير معروف'}
                        onRetry={() => void query.refetch()}
                    />
                ) : null}
                {query.isSuccess && rows.length === 0 ? <StateEmpty title="لا أصناف" hint="جرّب تغيير البحث أو حالة التسعير." /> : null}
                {query.isSuccess && rows.length > 0 ? (
                    <TableScroll label="جدول تكلفة المنيو">
                        <table className="w-full border-collapse text-body-md">
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الصنف
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        سعر البيع
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        تكلفة الوحدة
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        كمية اليوم
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        تكلفة اليوم
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        مبيعات اليوم
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        النسبة
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-center font-medium">
                                        الحالة
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={String(row.product_id)} className="border-b border-hairline hover:bg-surface-hover">
                                        <td className="px-sm py-xxs text-ink">
                                            {row.name}
                                            {row.reason ? <span className="block text-caption text-faint">{row.reason}</span> : null}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                            {moneyOf(row.price)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                            {moneyOf(row.unit_cost)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                            {intOf(row.quantity_sold_today)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end font-bold text-ink" dir="ltr">
                                            {moneyOf(row.daily_cost)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                            {moneyOf(row.net_sales)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end" dir="ltr">
                                            {ratioOf(row.cost_ratio)}
                                        </td>
                                        <td className="px-sm py-xxs text-center">
                                            <Badge
                                                variant={
                                                    row.pricing_status === 'priced'
                                                        ? 'success'
                                                        : row.pricing_status === 'estimated'
                                                          ? 'warning'
                                                          : row.pricing_status === 'partial'
                                                            ? 'warning'
                                                            : 'neutral'
                                                }
                                                dot
                                            >
                                                {MENU_COST_STATUS_AR[String(row.pricing_status ?? '')] ?? '—'}
                                            </Badge>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                ) : null}
            </Card>
        </div>
    );
}
