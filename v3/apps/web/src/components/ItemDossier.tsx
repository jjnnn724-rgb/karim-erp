import './ItemDossier.premium.css';
import { useQuery } from '@tanstack/react-query';
import { fetchInquiryItem } from '../lib/inventory-inquiry';
import { errorMessage, intOf, moneyOf, qtyOf, textOf } from '../lib/reporting';
import { Badge } from '../ui/Badge';
import { StateEmpty, StateError, StateLoading, TableScroll } from './TableState';

/**
 * بطاقة الصنف — نفس عقد `/api/inventory-inquiry/item/:id` الذي تقرأه v2
 * (`item-dossier.js`): حقائق الصنف، الكاردكس برصيد جارٍ، فواتير الدخول،
 * أقسام الصرف، الدُفعات والصلاحية، وأسطر POS.
 *
 * مكوّن واحد تستخدمه الشاشتان (المحرك والبطاقة الفاخرة) — فلا نسختان لرقم واحد.
 * كل رقم معروض قادم من الخادم؛ الواجهة لا تحسب متوسطًا ولا رصيدًا بنفسها.
 */
export function ItemDossier({ itemId, from, to }: { itemId: string; from: string; to: string }) {
    const query = useQuery({
        queryKey: ['inquiry-item', itemId, from, to],
        queryFn: ({ signal }) => fetchInquiryItem(itemId, from, to, signal),
        enabled: itemId !== '',
    });

    if (itemId === '') {
        return <StateEmpty title="لا صنف مختار" hint="اختر صنفًا من القائمة لعرض بطاقته الكاملة." />;
    }
    if (query.isPending) {
        return <StateLoading label="جارٍ تحميل بطاقة الصنف…" />;
    }
    if (query.isError) {
        return (
            <StateError
                message={errorMessage(query.error)}
                onRetry={() => {
                    void query.refetch();
                }}
            />
        );
    }

    const payload = query.data;
    const item = payload?.item;
    const cardex = payload?.cardex ?? [];
    const departments = payload?.departments ?? [];
    const batches = payload?.batches ?? [];
    const purchases = payload?.purchases;
    const sales = payload?.sales;

    if (!item) {
        return <StateEmpty title="لا بيانات للصنف" hint="أعد المحاولة أو وسّع المدى." />;
    }

    const lowStock = Boolean(item.lowStock);
    const unit = textOf(item.unit) || 'وحدة';

    return (
        <div className="erp-dossier flex flex-col gap-md">
            <div className="erp-dossier__hero">
                <div className="erp-dossier__identity">
                    <span className="erp-dossier__eyebrow" dir="ltr">
                        ITEM DOSSIER · #{String(item.id)}
                    </span>
                    <h3 className="erp-dossier__title">{textOf(item.name) || '—'}</h3>
                    <div className="erp-dossier__badges">
                        <Badge variant="info">{textOf(item.category) || 'بلا تصنيف'}</Badge>
                        {textOf(item.barcode) ? (
                            <Badge>
                                <span dir="ltr">{textOf(item.barcode)}</span>
                            </Badge>
                        ) : null}
                        <Badge variant={lowStock ? 'warning' : 'success'} dot>
                            {lowStock ? 'تحت الحد الأدنى' : 'رصيد آمن'}
                        </Badge>
                    </div>
                </div>
                <div className="erp-dossier__price">
                    <span>متوسط التكلفة الحالي</span>
                    <b className="erp-numeric" dir="ltr">
                        {moneyOf(item.avgCost)}
                    </b>
                    <small>لكل {unit} — من دفتر المخزون</small>
                </div>
            </div>

            <div className="erp-dossier__kpis">
                <div className="erp-dossier__kpi">
                    <span>الرصيد الحالي</span>
                    <b className="erp-numeric" dir="ltr">
                        {qtyOf(item.qty)}
                    </b>
                    <small>{unit}</small>
                </div>
                <div className="erp-dossier__kpi">
                    <span>قيمة المخزون</span>
                    <b className="erp-numeric" dir="ltr">
                        {moneyOf(item.stockValue)}
                    </b>
                    <small>رصيد × متوسط التكلفة</small>
                </div>
                <div className="erp-dossier__kpi">
                    <span>الحد الأدنى</span>
                    <b className="erp-numeric" dir="ltr">
                        {qtyOf(item.minQty)}
                    </b>
                    <small>{lowStock ? 'يحتاج توريد' : 'ضمن الحد'}</small>
                </div>
                <div className="erp-dossier__kpi">
                    <span>حركات في المدى</span>
                    <b className="erp-numeric" dir="ltr">
                        {intOf(cardex.length)}
                    </b>
                    <small>عملية مسجّلة</small>
                </div>
            </div>

            <div className="erp-dossier__facts">
                <div>
                    <span>الوحدة</span>
                    <b>{unit}</b>
                </div>
                <div>
                    <span>الباركود</span>
                    <b dir="ltr">{textOf(item.barcode) || '—'}</b>
                </div>
                <div>
                    <span>الرف / الموقع</span>
                    <b>{textOf(item.shelf) || '—'}</b>
                </div>
                <div>
                    <span>رصيد الكاردكس</span>
                    <b className="erp-numeric" dir="ltr">
                        {qtyOf(item.balanceSum)}
                    </b>
                </div>
                <div>
                    <span>دُفعات مسجّلة</span>
                    <b className="erp-numeric" dir="ltr">
                        {intOf(batches.length)}
                    </b>
                </div>
                <div>
                    <span>فواتير شراء في المدى</span>
                    <b className="erp-numeric" dir="ltr">
                        {intOf(purchases?.invoices?.length ?? 0)}
                    </b>
                </div>
                <div>
                    <span>آخر سعر شراء</span>
                    <b className="erp-numeric" dir="ltr">
                        {purchases?.invoices?.length ? moneyOf(purchases.invoices[0]?.unitCost) : '—'}
                    </b>
                    {purchases?.invoices?.length ? (
                        <small className="text-caption text-muted">
                            {textOf(purchases.invoices[0]?.supplier) || '—'} · {textOf(purchases.invoices[0]?.day)}
                        </small>
                    ) : null}
                </div>
                <div>
                    <span>آخر حركة</span>
                    <b dir="ltr">{cardex.length ? textOf(cardex[0]?.date) || '—' : '—'}</b>
                    {cardex.length ? (
                        <small className="text-caption text-muted">
                            {textOf(cardex[0]?.type) || '—'} · {qtyOf(cardex[0]?.delta)}
                        </small>
                    ) : null}
                </div>
            </div>

            <section className="erp-dossier__section">
                <h3 className="erp-dossier__section-title">
                    الكاردكس{' '}
                    <span dir="ltr" lang="en">
                        Cardex
                    </span>
                </h3>
                {cardex.length === 0 ? (
                    <p className="p-sm text-body-sm text-muted">لا حركة على الصنف في المدى.</p>
                ) : (
                    <TableScroll label="جدول كاردكس الصنف">
                        <table className="w-full border-collapse text-body-md">
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        التاريخ
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        النوع
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الموقع
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        الحركة
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        الرصيد
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {cardex.slice(0, 60).map((row, index) => (
                                    <tr
                                        key={`${textOf(row.date)}-${textOf(row.referenceId)}-${String(index)}`}
                                        className="border-b border-hairline"
                                    >
                                        <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                            {textOf(row.date) || '—'}
                                        </td>
                                        <td className="px-sm py-xxs text-muted">
                                            {textOf(row.type) || '—'}
                                            {row.reason ? (
                                                <span className="block text-caption text-faint">{textOf(row.reason)}</span>
                                            ) : null}
                                        </td>
                                        <td className="px-sm py-xxs text-muted">{textOf(row.location) || textOf(row.deptCode) || '—'}</td>
                                        <td
                                            className={`erp-numeric px-sm py-xxs text-end ${
                                                Number(row.delta) < 0 ? 'text-danger-text' : 'text-success-text'
                                            }`}
                                            dir="ltr"
                                        >
                                            {qtyOf(row.delta)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                            {qtyOf(row.runningQty)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                )}
            </section>

            <div className="grid gap-md lg:grid-cols-2">
                <section className="erp-dossier__section">
                    <h3 className="erp-dossier__section-title">
                        صرف الأقسام{' '}
                        <span dir="ltr" lang="en">
                            Departments
                        </span>
                    </h3>
                    {departments.length === 0 ? (
                        <p className="p-sm text-body-sm text-muted">لا صرف لأقسام في المدى.</p>
                    ) : (
                        <ul className="flex flex-col gap-xxs p-sm" aria-label="صرف الصنف للأقسام">
                            {departments.map((row) => (
                                <li
                                    key={`${textOf(row.deptCode)}-${textOf(row.deptName)}`}
                                    className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-sm"
                                >
                                    <span className="text-ink">{textOf(row.deptName) || '—'}</span>
                                    <span className="erp-numeric text-ink" dir="ltr">
                                        {qtyOf(row.qty)} · {moneyOf(row.cost)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="erp-dossier__section">
                    <h3 className="erp-dossier__section-title">
                        الدُفعات والصلاحية{' '}
                        <span dir="ltr" lang="en">
                            Batches
                        </span>
                    </h3>
                    {batches.length === 0 ? (
                        <p className="p-sm text-body-sm text-muted">لا دُفعات مسجّلة.</p>
                    ) : (
                        <ul className="flex flex-col gap-xxs p-sm" aria-label="دُفعات الصنف">
                            {batches.map((row, index) => (
                                <li
                                    key={`${textOf(row.expiryDate)}-${textOf(row.lot)}-${String(index)}`}
                                    className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-sm"
                                >
                                    <span className={row.expired ? 'text-danger-text' : 'text-ink'} dir="ltr">
                                        {textOf(row.expiryDate) || 'بلا صلاحية'}
                                        {row.lot ? ` · ${textOf(row.lot)}` : ''}
                                    </span>
                                    <span className="erp-numeric text-ink" dir="ltr">
                                        {qtyOf(row.qty)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>

            <div className="grid gap-md lg:grid-cols-2">
                <section className="erp-dossier__section">
                    <h3 className="erp-dossier__section-title">
                        المشتريات{' '}
                        <span dir="ltr" lang="en">
                            Purchases
                        </span>
                    </h3>
                    <p className="px-sm text-body-sm text-muted" role="status">
                        {`دخل ${qtyOf(purchases?.qty)} بتكلفة ${moneyOf(purchases?.cost)} · ${intOf(purchases?.invoices?.length)} فاتورة`}
                    </p>
                    {(purchases?.invoices ?? []).length === 0 ? (
                        <p className="p-sm text-body-sm text-muted">لا فواتير شراء في المدى.</p>
                    ) : (
                        <ul className="flex flex-col gap-xxs p-sm" aria-label="فواتير شراء الصنف">
                            {(purchases?.invoices ?? []).slice(0, 12).map((invoice, index) => (
                                <li
                                    key={`${textOf(invoice.invoiceNumber)}-${String(index)}`}
                                    className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-sm"
                                >
                                    <span className="text-ink">
                                        {textOf(invoice.invoiceNumber) || '—'}
                                        <span className="block text-caption text-faint">
                                            {textOf(invoice.supplier) || '—'} · {textOf(invoice.day)}
                                        </span>
                                    </span>
                                    <span className="erp-numeric text-ink" dir="ltr">
                                        {qtyOf(invoice.qty)} · {moneyOf(invoice.lineTotal)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="erp-dossier__section">
                    <h3 className="erp-dossier__section-title">
                        مبيعات نقطة البيع{' '}
                        <span dir="ltr" lang="en">
                            POS
                        </span>
                    </h3>
                    <p className="px-sm text-body-sm text-muted" role="status">
                        {`مبيع ${qtyOf(sales?.pos)} · صافي ${moneyOf(sales?.net)} · ${intOf(sales?.orders)} طلبًا`}
                    </p>
                    <p className="px-sm text-caption text-faint">
                        هذا الرقم من أسطر POS المربوطة بالمعرّف — لا يُجمع مع مرآة المبيعات بالاسم.
                    </p>
                </section>
            </div>
        </div>
    );
}
