import { type PosCartLine, type PosDiscount, type PosTotals, parsePosMoney } from '../../lib/pos-pricing';
import { Badge, Button, Input, Select } from '../../ui';
import { PosNumpad } from './PosNumpad';
import { moneyText, PAYMENT_FIELDS, type PaymentKey } from './pos-ui';

export type PaymentReferenceKey = 'card' | 'wallet' | 'bank_transfer';

export interface PosCartProps {
    cart: readonly PosCartLine[];
    /** صور الأصناف بمعرّفها — تُعرض مصغّرة في بنود السلة. */
    images?: Record<string, string>;
    totals: PosTotals;
    discount: PosDiscount;
    onDiscount: (next: PosDiscount) => void;
    payments: Record<PaymentKey, string>;
    paymentsTouched: boolean;
    onPayment: (key: PaymentKey, value: string) => void;
    references: Record<PaymentReferenceKey, string>;
    onReference: (key: PaymentReferenceKey, value: string) => void;
    canSell: boolean;
    busy: boolean;
    buffet: boolean;
    onQty: (id: string, delta: number) => void;
    onClear: () => void;
    onHold: () => void;
    onComplete: () => void;
}

/** السلة والخصم والدفع — الأرقام تقديرية، والخادم هو من يسجّل الفاتورة. */
export function PosCart({
    cart,
    images,
    totals,
    discount,
    onDiscount,
    payments,
    paymentsTouched,
    onPayment,
    references,
    onReference,
    canSell,
    busy,
    buffet,
    onQty,
    onClear,
    onHold,
    onComplete,
}: PosCartProps) {
    const count = cart.reduce((sum, row) => sum + row.quantity, 0);
    const amounts = PAYMENT_FIELDS.map((field) => parsePosMoney(payments[field.key]));
    const invalid = amounts.some((amount) => !Number.isFinite(amount));
    const paid = invalid ? 0 : amounts.reduce((sum, amount) => sum + amount, 0);
    const due = Math.max(0, totals.total - paid);
    const change = Math.max(0, paid - totals.total);
    const paymentState = invalid
        ? 'أدخل مبالغ دفع صحيحة غير سالبة.'
        : due > 0.009
          ? `المتبقي للدفع: ${moneyText(due)}`
          : change > 0.009
            ? `الباقي للعميل: ${moneyText(change)}`
            : 'المبلغ المدفوع مطابق للإجمالي.';

    return (
        <section className="erp-card pos-cart" aria-labelledby="pos-cart-title">
            <div className="erp-card__body pos-cart__body">
                <div className="pos-cart__head">
                    <div className="pos-cart__head-title">
                        <h2 id="pos-cart-title" className="erp-card__title">
                            السلة <Badge variant="info">{count}</Badge>
                        </h2>
                        <span className="pos-customer-pill" title="البيع الحالي بدون ملف عميل مرتبط">
                            عميل نقدي
                        </span>
                    </div>
                    <div className="pos-cart__head-actions">
                        <Button
                            size="sm"
                            variant="secondary"
                            aria-label="تعليق الطلب الحالي"
                            title="تعليق الطلب · F3"
                            disabled={!cart.length || !canSell || busy}
                            onClick={onHold}
                        >
                            <span aria-hidden="true">Ⅱ</span>
                            <span>تعليق</span>
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            aria-label="تفريغ السلة"
                            title="إفراغ السلة"
                            disabled={!cart.length || busy}
                            onClick={onClear}
                        >
                            <span aria-hidden="true">×</span>
                            <span>إفراغ</span>
                        </Button>
                    </div>
                </div>

                {cart.length === 0 ? (
                    <div className="pos-cart__empty">
                        <span className="pos-cart__empty-icon" aria-hidden="true">
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                width="20"
                                height="20"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                            >
                                <path
                                    d="M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.55L21 8H6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                                <circle cx="10" cy="20" r="1.3" />
                                <circle cx="18" cy="20" r="1.3" />
                            </svg>
                        </span>
                        <p>{buffet ? 'السلة فارغة — اختر فئة وأضف فردًا للبدء.' : 'السلة فارغة — اختر صنفًا للبدء.'}</p>
                    </div>
                ) : (
                    <ul className="pos-cart__lines">
                        {cart.map((row) => {
                            const totalLine = totals.items.find((line) => line.id === row.id);
                            return (
                                <li key={row.id} className="pos-cart__line">
                                    {images?.[row.id] ? (
                                        <img
                                            className="pos-cart__thumb"
                                            src={images[row.id]}
                                            alt=""
                                            loading="lazy"
                                            decoding="async"
                                        />
                                    ) : null}
                                    <div className="min-w-0 pos-cart__copy">
                                        <strong>{row.name}</strong>
                                        <small>{moneyText(row.price)} {buffet ? 'للفرد' : 'للوحدة'}</small>
                                    </div>
                                    <strong className="pos-cart__line-total erp-numeric" dir="ltr">
                                        {moneyText((totalLine?.subtotal ?? 0) + (totalLine?.tax ?? 0))}
                                    </strong>
                                    <fieldset
                                        className="pos-qty m-0 min-w-0 border-0 p-0"
                                        aria-label={`كمية ${row.name}`}
                                    >
                                        <button
                                            type="button"
                                            aria-label={`تقليل ${row.name}`}
                                            disabled={busy}
                                            onClick={() => {
                                                onQty(row.id, -1);
                                            }}
                                        >
                                            −
                                        </button>
                                        <span aria-live="polite">{row.quantity}</span>
                                        <button
                                            type="button"
                                            aria-label={`زيادة ${row.name}`}
                                            disabled={busy}
                                            onClick={() => {
                                                onQty(row.id, 1);
                                            }}
                                        >
                                            +
                                        </button>
                                    </fieldset>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {canSell && cart.length ? (
                    <details className="pos-payments">
                        <summary className="pos-payments__summary">
                            <strong>الدفع</strong>
                            <span className={`pos-payments__summary-state${invalid ? ' is-invalid' : ''}`} role="status" aria-live="polite">
                                {paymentState}
                            </span>
                            <span className="pos-payments__summary-edit">تعديل</span>
                        </summary>
                        <div className="pos-payments__body">
                            <div className="pos-payments__discount">
                                <Select
                                    label="نوع الخصم"
                                    value={discount.type}
                                    options={[
                                        { value: '', label: 'بدون خصم' },
                                        { value: 'percent', label: 'نسبة مئوية' },
                                        { value: 'fixed', label: 'مبلغ ثابت' },
                                    ]}
                                    onValueChange={(value) => {
                                        onDiscount({ type: value as PosDiscount['type'], value: discount.value });
                                    }}
                                    disabled={busy}
                                />
                                <Input
                                    label="قيمة الخصم"
                                    inputMode="decimal"
                                    dir="ltr"
                                    value={discount.value}
                                    disabled={!discount.type || busy}
                                    onChange={(event) => {
                                        onDiscount({ type: discount.type, value: event.target.value });
                                    }}
                                />
                            </div>
                            {!totals.valid ? (
                                <p className="text-body-sm text-danger" role="alert">
                                    قيمة الخصم غير صالحة؛ النسبة من 0 إلى 100.
                                </p>
                            ) : null}

                            <div className="pos-payments__grid">
                                {PAYMENT_FIELDS.map((field) => (
                                    <div key={field.key} className="pos-payments__field">
                                        <Input
                                            label={field.label}
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            inputMode="decimal"
                                            dir="ltr"
                                            value={payments[field.key]}
                                            disabled={busy}
                                            onChange={(event) => {
                                                onPayment(field.key, event.target.value);
                                            }}
                                        />
                                        {field.key === 'cash' ? null : (
                                            <Input
                                                label={`مرجع ${field.label}`}
                                                maxLength={120}
                                                autoComplete="off"
                                                dir="ltr"
                                                value={references[field.key]}
                                                disabled={busy}
                                                onChange={(event) => {
                                                    onReference(field.key, event.target.value);
                                                }}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>

                            <PosNumpad
                                value={payments.cash}
                                due={totals.total}
                                fresh={!paymentsTouched}
                                disabled={busy}
                                onChange={(value) => {
                                    onPayment('cash', value);
                                }}
                            />
                        </div>
                    </details>
                ) : !canSell ? (
                    <p className="text-body-sm text-muted">قراءة فقط — لا يمكن إتمام البيع بهذا الدور.</p>
                ) : null}
            </div>
            <div className="pos-cart__foot">
                <dl className="pos-totals pos-totals--compact">
                    <div>
                        <dt>المجموع قبل الضريبة</dt>
                        <dd>{moneyText(totals.subtotalBeforeDiscount)}</dd>
                    </div>
                    <div>
                        <dt>الخصم</dt>
                        <dd>−{moneyText(totals.discount)}</dd>
                    </div>
                    <div>
                        <dt>الضريبة ({[...new Set(cart.map((line) => line.vatRate))].length === 1 ? `${cart[0]?.vatRate ?? 15}%` : 'متعددة'})</dt>
                        <dd>{moneyText(totals.tax)}</dd>
                    </div>
                </dl>
                <div className="pos-cart__foot-main">
                    <div className="pos-cart__due">
                        <span>
                            الإجمالي النهائي
                            {count ? ` · ${count} في السلة` : ''}
                        </span>
                        <strong className="erp-numeric" dir="ltr">
                            {moneyText(totals.total)}
                        </strong>
                    </div>
                    {canSell ? (
                        <Button
                            variant="primary"
                            aria-label="إتمام البيع"
                            loading={busy}
                            disabled={!cart.length || !totals.valid}
                            onClick={onComplete}
                        >
                            <span>إتمام البيع والدفع</span>
                            <kbd>F4</kbd>
                        </Button>
                    ) : null}
                </div>
            </div>
        </section>
    );
}
