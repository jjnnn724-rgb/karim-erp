import { useState } from 'react';
import { Badge, Button, Input, Pagination, Select } from '../../ui';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../../components/TableState';
import type { PosOrderDetail, PosOrderPage } from '../../lib/pos';
import { intOf } from '../../lib/reporting';
import { moneyText, orderStatusLabel, orderStatusTone, paymentMethodLabel } from './pos-ui';

export interface PosHistoryFiltersState {
    dateFrom: string;
    dateTo: string;
    status: '' | 'issued' | 'reported' | 'cancelled';
    search: string;
}

export interface PosHistoryProps {
    filters: PosHistoryFiltersState;
    onApply: (filters: PosHistoryFiltersState) => void;
    result: PosOrderPage | undefined;
    loading: boolean;
    error: string;
    printing: boolean;
    onPage: (page: number) => void;
    onRetry: () => void;
    onBack: () => void;
    onDetail: (orderId: string) => void;
    onPrint: () => void;
}

const STATUS_OPTIONS = [
    { value: '', label: 'كل الحالات' },
    { value: 'issued', label: 'صادرة' },
    { value: 'reported', label: 'مبلّغ عنها' },
    { value: 'cancelled', label: 'ملغاة' },
];

/** سجل فواتير الكاشير: فلاتر الخادم، صفحة واحدة، وتصدير للطباعة. */
export function PosHistory({
    filters,
    onApply,
    result,
    loading,
    error,
    printing,
    onPage,
    onRetry,
    onBack,
    onDetail,
    onPrint,
}: PosHistoryProps) {
    const [draft, setDraft] = useState<PosHistoryFiltersState>(filters);
    const [problem, setProblem] = useState('');
    const rows = result?.data ?? [];
    const pagination = result?.pagination;

    function apply() {
        if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) {
            setProblem('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.');
            return;
        }
        setProblem('');
        onApply({ ...draft, search: draft.search.trim() });
    }

    return (
        <section className="erp-card pos-history" aria-labelledby="pos-history-title">
            <div className="erp-card__head">
                <h2 id="pos-history-title" className="erp-card__title">
                    سجل فواتير الكاشير
                </h2>
                <span className="erp-grow" />
                <Button size="sm" variant="secondary" loading={printing} disabled={!rows.length} onClick={onPrint}>
                    طباعة النتائج
                </Button>
                <Button size="sm" variant="secondary" onClick={onBack}>
                    العودة إلى الكاشير
                </Button>
            </div>
            <div className="erp-card__body erp-stack">
                <div className="pos-history__filters">
                    <Input
                        label="من تاريخ"
                        type="date"
                        dir="ltr"
                        value={draft.dateFrom}
                        onChange={(event) => {
                            setDraft((current) => ({ ...current, dateFrom: event.target.value }));
                        }}
                    />
                    <Input
                        label="إلى تاريخ"
                        type="date"
                        dir="ltr"
                        value={draft.dateTo}
                        onChange={(event) => {
                            setDraft((current) => ({ ...current, dateTo: event.target.value }));
                        }}
                    />
                    <Select
                        label="الحالة"
                        value={draft.status}
                        options={STATUS_OPTIONS}
                        onValueChange={(value) => {
                            setDraft((current) => ({ ...current, status: value as PosHistoryFiltersState['status'] }));
                        }}
                    />
                    <Input
                        label="رقم الفاتورة / القسم / الكاشير"
                        type="search"
                        maxLength={100}
                        value={draft.search}
                        onChange={(event) => {
                            setDraft((current) => ({ ...current, search: event.target.value }));
                        }}
                    />
                    <Button variant="primary" size="sm" onClick={apply} disabled={loading}>
                        بحث
                    </Button>
                </div>
                {problem ? (
                    <p className="text-body-sm text-danger" role="alert">
                        {problem}
                    </p>
                ) : null}

                {loading ? <StateLoading label="جارٍ تحميل سجل الفواتير…" /> : null}
                {error ? <StateError message={error} onRetry={onRetry} /> : null}

                {!loading && !error ? (
                    <>
                        <p className="text-body-sm text-muted" role="status" aria-live="polite">
                            {`${intOf(pagination?.total ?? 0)} فاتورة · الصفحة ${intOf(pagination?.page ?? 1)} من ${intOf(
                                pagination?.totalPages ?? 1,
                            )}`}
                        </p>
                        {rows.length === 0 ? (
                            <StateEmpty title="لا فواتير مطابقة" hint="وسّع الفترة أو غيّر الحالة أو البحث." />
                        ) : (
                            <TableScroll label="سجل فواتير الكاشير">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">رقم الفاتورة</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">القسم</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">التاريخ</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">الكاشير</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">الأصناف</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">الإجمالي</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">الحالة</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">التفاصيل</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((order) => (
                                            <tr key={order.id} className="border-b border-hairline">
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    #{String(order.invoice_counter ?? order.id)}
                                                </td>
                                                <td className="px-sm py-xxs text-ink">{order.department_name || '—'}</td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {order.created_at || '—'}
                                                </td>
                                                <td className="px-sm py-xxs text-ink">{order.cashier_name || '—'}</td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {intOf(order.item_count)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyText(order.total_amount)}
                                                </td>
                                                <td className="px-sm py-xxs">
                                                    <Badge variant={orderStatusTone(order.status)}>
                                                        {orderStatusLabel(order.status)}
                                                    </Badge>
                                                </td>
                                                <td className="px-sm py-xxs">
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        onClick={() => {
                                                            onDetail(order.id);
                                                        }}
                                                    >
                                                        عرض
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                        {pagination && pagination.totalPages > 1 ? (
                            <Pagination
                                page={pagination.page}
                                pageSize={pagination.limit}
                                total={pagination.total}
                                onPageChange={onPage}
                            />
                        ) : null}
                    </>
                ) : null}
            </div>
        </section>
    );
}

export interface PosOrderDetailPanelProps {
    detail: PosOrderDetail | undefined;
    loading: boolean;
    error: string;
    canVoid: boolean;
    canReprint: boolean;
    busy: boolean;
    onBack: () => void;
    onRetry: () => void;
    onVoid: (detail: PosOrderDetail) => void;
    onReprint: (orderId: string) => void;
    onKot: (orderId: string, counter: number | null) => void;
}

/** تفاصيل فاتورة واحدة — بنودها ومدفوعاتها وأفعال الإلغاء/الطباعة. */
export function PosOrderDetailPanel({
    detail,
    loading,
    error,
    canVoid,
    canReprint,
    busy,
    onBack,
    onRetry,
    onVoid,
    onReprint,
    onKot,
}: PosOrderDetailPanelProps) {
    return (
        <section className="erp-card pos-order-detail" aria-labelledby="pos-order-detail-title">
            <div className="erp-card__head">
                <h2 id="pos-order-detail-title" className="erp-card__title">
                    {detail ? `تفاصيل الفاتورة #${String(detail.invoice_counter ?? detail.id)}` : 'تفاصيل الفاتورة'}
                </h2>
                <span className="erp-grow" />
                <Button size="sm" variant="secondary" onClick={onBack}>
                    العودة للسجل
                </Button>
            </div>
            <div className="erp-card__body erp-stack">
                {loading ? <StateLoading label="جارٍ تحميل تفاصيل الفاتورة…" /> : null}
                {error ? <StateError message={error} onRetry={onRetry} /> : null}

                {detail ? (
                    <>
                        <ul className="pos-detail__facts">
                            <li>
                                <span>القسم</span>
                                <strong>{detail.department_name || '—'}</strong>
                            </li>
                            <li>
                                <span>الكاشير</span>
                                <strong>{detail.cashier_name || '—'}</strong>
                            </li>
                            <li>
                                <span>التاريخ</span>
                                <strong dir="ltr">{detail.created_at || '—'}</strong>
                            </li>
                            <li>
                                <span>الحالة</span>
                                <Badge variant={orderStatusTone(detail.status)}>{orderStatusLabel(detail.status)}</Badge>
                            </li>
                        </ul>

                        {detail.items.length ? (
                            <TableScroll label="أصناف الفاتورة">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">الصنف</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">الكمية</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">سعر الوحدة</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">الخصم</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">الإجمالي</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detail.items.map((item) => (
                                            <tr key={item.id} className="border-b border-hairline">
                                                <td className="px-sm py-xxs text-ink">{item.product_name || '—'}</td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {String(item.quantity)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyText(item.unit_price)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyText(item.discount)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyText(item.line_total)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <p className="text-body-sm text-muted">لا توجد أصناف مسجلة.</p>
                        )}

                        <dl className="pos-totals">
                            <div>
                                <dt>قبل الضريبة</dt>
                                <dd>{moneyText(detail.subtotal)}</dd>
                            </div>
                            <div>
                                <dt>الخصم</dt>
                                <dd>{moneyText(detail.discount_total)}</dd>
                            </div>
                            <div>
                                <dt>الضريبة</dt>
                                <dd>{moneyText(detail.tax_total)}</dd>
                            </div>
                            <div className="pos-totals__grand">
                                <dt>الإجمالي</dt>
                                <dd>{moneyText(detail.total_amount)}</dd>
                            </div>
                        </dl>

                        {detail.status === 'cancelled' && detail.void_reason ? (
                            <p className="text-body-sm text-danger" role="status">
                                {`سبب الإلغاء: ${detail.void_reason}`}
                            </p>
                        ) : null}

                        <div className="pos-order-detail__actions">
                            {canVoid && detail.status !== 'cancelled' ? (
                                <Button
                                    variant="danger"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => {
                                        onVoid(detail);
                                    }}
                                >
                                    إلغاء الفاتورة ورد المبلغ
                                </Button>
                            ) : null}
                            {canReprint ? (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={busy}
                                    onClick={() => {
                                        onReprint(detail.id);
                                    }}
                                >
                                    إعادة طباعة الفاتورة
                                </Button>
                            ) : null}
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => {
                                    onKot(detail.id, detail.invoice_counter);
                                }}
                            >
                                تذاكر المطبخ
                            </Button>
                        </div>

                        <h3 className="text-heading-sm text-ink">وسائل الدفع</h3>
                        {detail.payments && detail.payments.length ? (
                            <TableScroll label="وسائل دفع الفاتورة">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">الوسيلة</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">المبلغ</th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">المرجع</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detail.payments.map((payment, index) => (
                                            <tr key={`${String(payment.method)}-${String(index)}`} className="border-b border-hairline">
                                                <td className="px-sm py-xxs text-ink">{paymentMethodLabel(payment.method)}</td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyText(payment.amount)}
                                                </td>
                                                <td className="px-sm py-xxs text-muted" dir="ltr">
                                                    {payment.reference || '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <p className="text-body-sm text-muted">لا توجد تفاصيل دفع مسجلة.</p>
                        )}
                    </>
                ) : null}
            </div>
        </section>
    );
}
