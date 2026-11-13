import { type PosCartLine, type PosDiscount, type PosTotals, parsePosMoney } from '../../lib/pos-pricing';
import { Badge, Button, Input, Select } from '../../ui';
import { PosNumpad } from './PosNumpad';
import { CARD_BRANDS, type CardMeta, moneyText, PAYMENT_FIELDS, type PaymentKey } from './pos-ui';

export type PaymentReferenceKey = 'card' | 'wallet' | 'bank_transfer';

export interface PosCartProps {
    cart: readonly PosCartLine[];
    /** صور الأصناف بمعرّفها — تُعرض مصغّرة في بنود السلة. */
    images?: Record<string, string>;
    /** رقم الطلب النشط كما يظهر في شريط الطلبات. */
    orderNumber?: number;
    totals: PosTotals;
    discount: PosDiscount;
    onDiscount: (next: PosDiscount) => void;
    payments: Record<PaymentKey, string>;
    paymentsTouched: boolean;
    onPayment: (key: PaymentKey, value: string) => void;
    references: Record<PaymentReferenceKey, string>;
    onReference: (key: PaymentReferenceKey, value: string) => void;
    cardMeta: CardMeta;
    onCardMeta: (next: CardMeta) => void;
    canSell: boolean;
    busy: boolean;
    buffet: boolean;
    onQty: (id: string, delta: number) => void;
    onClear: () => void;
    onHold: () => void;
    onComplete: () => void;
}

function HoldIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M9 5v14M15 5v14" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
        </svg>
    );
}

/** السلة والخصم والدفع — الأرقام تقديرية، والخادم هو من يسجّل الفاتورة. */
export function PosCart({
    cart,
    images,
    orderNumber = 1,
    totals,
    discount,
    onDiscount,
    payments,
    paymentsTouched,
    onPayment,
    references,
    onReference,
    cardMeta,
    onCardMeta,
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

    // حساب نشاط البطاقة: لتفعيل لوحة بيانات البطاقة عند البدء بها
    const cardAmount = parsePosMoney(payments.card);
    const cardActive = Boolean(cardAmount > 0 || cardMeta.brand || cardMeta.last4 || references.card);
    const cardBrandLabel = CARD_BRANDS.find((brand) => brand.value === cardMeta.brand)?.label ?? '';

    // نسبة الضريبة المعروضة تتغيّر مع سلّة مختلطة النسب؛ لا نطبع 15% إن لم تكن كذلك.
    const rates = [...new Set(cart.map((row) => row.vatRate))];
    const vatLabel = rates.length === 1 ? `الضريبة (${String(Math.round((rates[0] ?? 0) * 100))}%)` : 'الضريبة';

    return (
        <section className="erp-card pos-cart" aria-labelledby="pos-cart-title">
            <header className="pos-cart__head">
                <div className="pos-cart__head-main">
                    <h2 id="pos-cart-title" className="erp-card__title">
                        السلة <Badge variant="info">{count}</Badge>
                    </h2>
                    <span className="pos-cart__order">طلب #{orderNumber}</span>
                </div>
                <div className="pos-cart__head-tools">
                    <span className="pos-cart__customer" title="بيع مباشر دون بيانات عميل">
                        <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <circle cx="12" cy="8" r="3.4" />
                            <path d="M5 20a7 7 0 0 1 14 0" />
                        </svg>
                        عميل نقدي
                    </span>
                    <button
                        type="button"
                        className="pos-icon-btn pos-icon-btn--sm"
                        aria-label="تعليق الطلب الحالي"
                        title="تعليق الطلب (F3)"
                        disabled={!cart.length || !canSell || busy}
                        onClick={onHold}
                    >
                        <HoldIcon />
                    </button>
                    <button
                        type="button"
                        className="pos-icon-btn pos-icon-btn--sm pos-icon-btn--danger"
                        aria-label="تفريغ السلة"
                        title="تفريغ السلة"
                        disabled={!cart.length || !canSell || busy}
                        onClick={onClear}
                    >
                        <TrashIcon />
                    </button>
                </div>
            </header>

            <div className="pos-cart__body custom-scroll">
                {cart.length === 0 ? (
                    <div className="pos-cart__empty">
                        <span className="pos-cart__empty-icon" aria-hidden="true">
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                width="22"
                                height="22"
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
                        {cart.map((row) => (
                            <li key={row.id} className="pos-cart__line">
                                {images?.[row.id] ? (
                                    <img className="pos-cart__thumb" src={images[row.id]} alt="" loading="lazy" decoding="async" />
                                ) : null}
                                <div className="min-w-0 pos-cart__copy">
                                    <strong>{row.name}</strong>
                                    <small>
                                        {moneyText(row.price)}
                                        {buffet ? ' / فرد' : ''}
                                    </small>
                                </div>
                                <fieldset className="pos-qty m-0 min-w-0 border-0 p-0" aria-label={`كمية ${row.name}`}>
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
                                <span className="pos-cart__line-total erp-numeric" dir="ltr">
                                    {moneyText(row.price * row.quantity)}
                                </span>
                                <button
                                    type="button"
                                    className="pos-cart__line-remove"
                                    aria-label={`حذف ${row.name} من السلة`}
                                    title="حذف البند"
                                    disabled={busy}
                                    onClick={() => {
                                        onQty(row.id, -row.quantity);
                                    }}
                                >
                                    <TrashIcon />
                                </button>
                            </li>
                        ))}
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
                                        {field.key === 'cash' ? null : field.key === 'card' ? null : (
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

                            {cardActive ? (
                                <div className="pos-card">
                                    <h4 id="pos-card-title" className="pos-card__title">
                                        بيانات البطاقة
                                        {cardAmount > 0 ? <span className="pos-card__badge">يدفع {moneyText(cardAmount)}</span> : null}
                                    </h4>
                                    <div className="pos-card__brands" role="group" aria-label="ماركة البطاقة">
                                        {CARD_BRANDS.map((brand) => {
                                            const active = cardMeta.brand === brand.value;
                                            return (
                                                <button
                                                    key={brand.value}
                                                    type="button"
                                                    aria-pressed={active}
                                                    className={`pos-card__brand${active ? ' is-active' : ''}`}
                                                    disabled={busy}
                                                    onClick={() => {
                                                        onCardMeta({
                                                            ...cardMeta,
                                                            brand: active ? '' : (brand.value as CardMeta['brand']),
                                                        });
                                                    }}
                                                >
                                                    {brand.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="pos-card__row">
                                        <Input
                                            label="آخر 4 أرقام"
                                            inputMode="numeric"
                                            maxLength={4}
                                            dir="ltr"
                                            value={cardMeta.last4}
                                            disabled={busy}
                                            hint="تظهر على الإيصال فقط — لا تُخزَّن الشفرة الكاملة"
                                            onChange={(event) => {
                                                const digits = event.target.value.replace(/\D/g, '').slice(0, 4);
                                                onCardMeta({ ...cardMeta, last4: digits });
                                            }}
                                        />
                                        <Input
                                            label="مرجع / رقم الموافقة"
                                            maxLength={120}
                                            autoComplete="off"
                                            dir="ltr"
                                            value={references.card}
                                            disabled={busy}
                                            placeholder="مثال: 889911"
                                            onChange={(event) => {
                                                onReference('card', event.target.value);
                                            }}
                                        />
                                    </div>
                                    <p className="pos-card__hint" role="status">
                                        {cardMeta.brand && cardMeta.last4.length === 4
                                            ? `${cardBrandLabel} ····${cardMeta.last4} — تظهر على الإيصال`
                                            : 'اختر ماركة البطاقة ثم آخر 4 أرقام لاستكمال البيانات'}
                                    </p>
                                </div>
                            ) : null}

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

            <footer className="pos-cart__foot">
                <dl className="pos-totals">
                    <div>
                        <dt>المجموع قبل الضريبة</dt>
                        <dd className="erp-numeric" dir="ltr">
                            {moneyText(totals.subtotalBeforeDiscount)}
                        </dd>
                    </div>
                    {totals.discount > 0 ? (
                        <div className="pos-totals__discount">
                            <dt>الخصم</dt>
                            <dd className="erp-numeric" dir="ltr">
                                −{moneyText(totals.discount)}
                            </dd>
                        </div>
                    ) : null}
                    <div>
                        <dt>{vatLabel}</dt>
                        <dd className="erp-numeric" dir="ltr">
                            {moneyText(totals.tax)}
                        </dd>
                    </div>
                </dl>

                <div className="pos-cart__due">
                    <span>
                        الإجمالي النهائي
                        {count ? ` · ${String(count)} في السلة` : ''}
                    </span>
                    <strong className="erp-numeric" dir="ltr">
                        {moneyText(totals.total)}
                    </strong>
                </div>

                {canSell ? (
                    <Button
                        variant="primary"
                        className="pos-cart__checkout"
                        loading={busy}
                        disabled={!cart.length || !totals.valid}
                        onClick={onComplete}
                    >
                        إتمام البيع والدفع
                        <kbd className="pos-kbd">F4</kbd>
                    </Button>
                ) : null}
            </footer>
        </section>
    );
}
