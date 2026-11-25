import { useQuery } from '@tanstack/react-query';
import { fetchInquiryItem } from '../lib/inventory-inquiry';
import { errorMessage, intOf, moneyOf, qtyOf, textOf } from '../lib/reporting';
import { StateEmpty, StateError, StateLoading, TableScroll } from './TableState';

/**
 * بطاقة الصنف — نفس عقد `/api/inventory-inquiry/item/:id` الذي تقرأه v2
 * (`item-dossier.js`): حقائق الصنف، الكاردكس برصيد جارٍ، فواتير الدخول،
 * أقسام الصرف، الدُفعات والصلاحية، وأسطر POS.
 *
 * مكوّن واحد تستخدمه الشاشتان (المحرك والبطاقة الفاخرة) — فلا نسختان لرقم واحد.
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

    return (
        <div className="flex flex-col gap-md">
            <div className="grid gap-sm p-sm text-body-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                    <p className="text-caption text-muted">الصنف</p>
                    <p className="text-heading-sm text-ink">{textOf(item.name) || '—'}</p>
                    <p className="text-caption text-faint">{textOf(item.category) || 'بلا تصنيف'}</p>
                </div>
                <div>
                    <p className="text-caption text-muted">الرصيد / الحد</p>
                    <p className="erp-numeric text-ink" dir="ltr">
                        {qtyOf(item.qty)} / {qtyOf(item.minQty)}
                    </p>
                    {item.lowStock ? <p className="text-caption text-warning-text">تحت الحد الأدنى</p> : null}
                </div>
                <div>
                    <p className="text-caption text-muted">متوسط التكلفة</p>
                    <p className="erp-numeric text-ink" dir="ltr">
                        {moneyOf(item.avgCost)}
                    </p>
                    <p className="text-caption text-faint">{textOf(item.unit) || '—'}</p>
                </div>
                <div>
                    <p className="text-caption text-muted">قيمة المخزون</p>
                    <p className="erp-numeric text-ink" dir="ltr">
                        {moneyOf(item.stockValue)}
                    </p>
                    <p className="text-caption text-faint">{textOf(item.shelf) || textOf(item.barcode) || '—'}</p>
                </div>
            </div>

            <section className="border-t border-hairline">
                <h3 className="px-sm py-xs text-heading-sm text-ink">
                    الكاردكس{' '}
                    <span className="text-body-sm text-muted" dir="ltr" lang="en">
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
                <section className="border-t border-hairline">
                    <h3 className="px-sm py-xs text-heading-sm text-ink">
                        صرف الأقسام{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
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

                <section className="border-t border-hairline">
                    <h3 className="px-sm py-xs text-heading-sm text-ink">
                        الدُفعات والصلاحية{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
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
                <section className="border-t border-hairline">
                    <h3 className="px-sm py-xs text-heading-sm text-ink">
                        المشتريات{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
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

                <section className="border-t border-hairline">
                    <h3 className="px-sm py-xs text-heading-sm text-ink">
                        مبيعات نقطة البيع{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
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
