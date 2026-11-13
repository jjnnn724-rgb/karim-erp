import { type ReactElement, useEffect, useState } from 'react';
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
    /** اسم العميل ورقم تليفونه — تُسجَّل على الفاتورة وتُطبع على الإيصال. */
    customerName: string;
    customerPhone: string;
    onCustomerName: (value: string) => void;
    onCustomerPhone: (value: string) => void;
    onClearCustomer: () => void;
    /** صلاحية تعديل سعر البند (الخادم يفرض manager/admin فقط). */
    canEditPrice: boolean;
    onQty: (id: string, delta: number) => void;
    /** ضبط سعر بند — مقيّد من الخادم (لا رفع فوق القائمة، وتخفيض يحتاج معتمد). */
    onPrice: (id: string, price: number) => void;
    onClear: () => void;
    onHold: () => void;
    onComplete: () => void;
    /** يوجد إيصال محفوظ لآخر بيع في هذه التبويبة — يفعّل زر الطباعة. */
    canPrintReceipt: boolean;
    /** طلب الطباعة جارٍ — يعطّل الزر ويظهر حالة التحميل. */
    printReceiptPending: boolean;
    onPrintReceipt: () => void;
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

function PrinterIcon() {
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
            <path d="M7 8V3h10v5" />
            <path d="M7 17H4a1 1 0 0 1-1-1v-6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6a1 1 0 0 1-1 1h-3" />
            <rect x="7" y="14" width="10" height="7" rx="1" />
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

function CashIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="3" y="7" width="18" height="10" rx="2" />
            <circle cx="12" cy="12" r="2.4" />
            <path d="M6.5 10.2v.01M17.5 13.8v.01" />
        </svg>
    );
}

function CardIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="3" y="6" width="18" height="12" rx="2" />
            <path d="M3 10h18M7 14h4" />
        </svg>
    );
}

function WalletIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 7a2 2 0 0 1 2-2h13v3" />
            <path d="M4 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H6a2 2 0 0 1-2-2Z" />
            <path d="M16.5 13.5h.01" />
        </svg>
    );
}

function BankIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 9.5 12 5l8 4.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
        </svg>
    );
}

const METHOD_ICONS: Record<PaymentKey, () => ReactElement> = {
    cash: CashIcon,
    card: CardIcon,
    wallet: WalletIcon,
    bank_transfer: BankIcon,
};

const CASH_BILLS = [5, 10, 20, 50, 100, 200, 500] as const;

function PencilIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
            <path d="m13.5 6.5 3 3" />
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
    customerName,
    customerPhone,
    onCustomerName,
    onCustomerPhone,
    onClearCustomer,
    canEditPrice,
    onQty,
    onPrice,
    onClear,
    onHold,
    onComplete,
    canPrintReceipt,
    printReceiptPending,
    onPrintReceipt,
}: PosCartProps) {
    const [editPrice, setEditPrice] = useState<{ id: string; value: string } | null>(null);
    const [customerOpen, setCustomerOpen] = useState(false);

    useEffect(() => {
        if (!customerOpen) {
            return undefined;
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setCustomerOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
        };
    }, [customerOpen]);
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

    /** تعبئة «المتبقي» في طريقة دفع واحدة — ضغطة واحدة وتمتلئ الطريقة. */
    const otherPaidFor = (key: PaymentKey) =>
        PAYMENT_FIELDS.reduce((sum, field) => {
            if (field.key === key) {
                return sum;
            }
            const value = parsePosMoney(payments[field.key]);
            return sum + (Number.isFinite(value) ? value : 0);
        }, 0);

    const remainingFor = (key: PaymentKey) => Math.max(0, totals.total - otherPaidFor(key));

    const fillRemaining = (key: PaymentKey) => {
        onPayment(key, remainingFor(key).toFixed(2));
    };

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
                    <div className="pos-cart__customer-wrap">
                        <button
                            type="button"
                            className={`pos-cart__customer${customerName.trim() ? ' is-set' : ''}`}
                            aria-expanded={customerOpen}
                            aria-controls="pos-customer-panel"
                            title={customerName.trim() ? `العميل: ${customerName.trim()}` : 'بيع مباشر دون بيانات عميل — اضغط لإضافة عميل'}
                            onClick={() => {
                                setCustomerOpen((open) => !open);
                            }}
                        >
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
                            <span>{customerName.trim() || 'عميل نقدي'}</span>
                            {customerPhone.trim() ? (
                                <span className="pos-cart__customer-phone" dir="ltr">
                                    {customerPhone.trim()}
                                </span>
                            ) : null}
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                width="12"
                                height="12"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`pos-cart__customer-chev${customerOpen ? ' is-open' : ''}`}
                            >
                                <path d="m6 9 6 6 6-6" />
                            </svg>
                        </button>
                        {customerOpen ? (
                            <div className="pos-customer-panel" id="pos-customer-panel" role="dialog" aria-modal="false" aria-label="بيانات العميل">
                                <h3 className="pos-customer-panel__title">
                                    بيانات العميل <span className="pos-customer-panel__hint">— تُطبع على الإيصال</span>
                                </h3>
                                <Input
                                    label="اسم العميل"
                                    value={customerName}
                                    autoFocus
                                    maxLength={80}
                                    placeholder="مثال: أحمد محمد"
                                    disabled={busy}
                                    onChange={(event) => {
                                        onCustomerName(event.target.value);
                                    }}
                                />
                                <Input
                                    label="التليفون (اختياري)"
                                    dir="ltr"
                                    inputMode="tel"
                                    value={customerPhone}
                                    maxLength={20}
                                    placeholder="05xxxxxxxx"
                                    disabled={busy}
                                    onChange={(event) => {
                                        onCustomerPhone(event.target.value);
                                    }}
                                />
                                <div className="pos-customer-panel__actions">
                                    {customerName.trim() || customerPhone.trim() ? (
                                        <button
                                            type="button"
                                            className="pos-customer-clear"
                                            disabled={busy}
                                            onClick={() => {
                                                onClearCustomer();
                                            }}
                                        >
                                            مسح العميل
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        className="pos-customer-done"
                                        disabled={busy}
                                        onClick={() => {
                                            setCustomerOpen(false);
                                        }}
                                    >
                                        تم
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </div>
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
                        {cart.map((row) => {
                            const editingState =
                                editPrice && editPrice.id === row.id
                                    ? (() => {
                                          const parsed = Number(editPrice.value);
                                          const listPrice = row.listPrice ?? row.price;
                                          const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= listPrice;
                                          const deltaPct =
                                              listPrice > 0 && Number.isFinite(parsed) ? ((parsed - listPrice) / listPrice) * 100 : null;
                                          return { value: editPrice.value, parsed, listPrice, valid, deltaPct };
                                      })()
                                    : null;
                            return (
                                <li key={row.id} className="pos-cart__line">
                                    {images?.[row.id] ? (
                                        <img className="pos-cart__thumb" src={images[row.id]} alt="" loading="lazy" decoding="async" />
                                    ) : null}
                                    <div className="min-w-0 pos-cart__copy">
                                        <strong>{row.name}</strong>
                                        {canEditPrice ? (
                                            <button
                                                type="button"
                                                className="pos-cart__price-edit"
                                                aria-label={`تعديل سعر ${row.name} — السعر الحالي ${moneyText(row.price)}`}
                                                aria-expanded={editingState !== null}
                                                title="تعديل السعر"
                                                disabled={busy}
                                                onClick={() => {
                                                    setEditPrice(editingState ? null : { id: row.id, value: row.price.toFixed(2) });
                                                }}
                                            >
                                                <span className="erp-numeric" dir="ltr">
                                                    {moneyText(row.price)}
                                                </span>
                                                {buffet ? <span> / فرد</span> : null}
                                                <PencilIcon />
                                                {row.listPrice !== undefined && row.price !== row.listPrice ? (
                                                    <span className="pos-cart__price-badge">معدّل</span>
                                                ) : null}
                                            </button>
                                        ) : (
                                            <small>
                                                {moneyText(row.price)}
                                                {buffet ? ' / فرد' : ''}
                                            </small>
                                        )}
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
                                    {editingState ? (
                                        <div className="pos-price-editor" role="group" aria-label={`تحرير سعر ${row.name}`}>
                                            <Input
                                                label="سعر الوحدة"
                                                inputMode="decimal"
                                                dir="ltr"
                                                autoFocus
                                                value={editingState.value}
                                                disabled={busy}
                                                hint={`سعر القائمة ${moneyText(editingState.listPrice)}`}
                                                onChange={(event) => {
                                                    setEditPrice({ id: row.id, value: event.target.value });
                                                }}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter' && editingState.valid) {
                                                        event.preventDefault();
                                                        onPrice(row.id, Math.round(editingState.parsed * 100) / 100);
                                                        setEditPrice(null);
                                                    } else if (event.key === 'Escape') {
                                                        event.preventDefault();
                                                        setEditPrice(null);
                                                    }
                                                }}
                                            />
                                            <div className="pos-price-editor__meta">
                                                {editingState.deltaPct !== null && Math.abs(editingState.deltaPct) > 0.009 ? (
                                                    <span className={`pos-price-delta${editingState.deltaPct < 0 ? ' is-down' : ' is-up'}`}>
                                                        {editingState.deltaPct < 0 ? 'تخفيض' : '—'}{' '}
                                                        {Math.abs(editingState.deltaPct).toFixed(1)}% عن القائمة
                                                    </span>
                                                ) : (
                                                    <span className="pos-price-delta is-flat">السعر مطابق للقائمة</span>
                                                )}
                                                {!editingState.valid ? (
                                                    <span className="pos-price-error" role="alert">
                                                        السعر غير صالح — لا يمكن تجاوز القائمة
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="pos-price-editor__actions">
                                                {row.listPrice !== undefined && row.price !== row.listPrice ? (
                                                    <button
                                                        type="button"
                                                        className="pos-price-reset"
                                                        disabled={busy}
                                                        onClick={() => {
                                                            onPrice(row.id, row.listPrice!);
                                                            setEditPrice(null);
                                                        }}
                                                    >
                                                        ↺ استرجاع القائمة
                                                    </button>
                                                ) : null}
                                                <button
                                                    type="button"
                                                    className="pos-price-cancel"
                                                    disabled={busy}
                                                    onClick={() => {
                                                        setEditPrice(null);
                                                    }}
                                                >
                                                    إلغاء
                                                </button>
                                                <button
                                                    type="button"
                                                    className="pos-price-save"
                                                    disabled={!editingState.valid || busy}
                                                    onClick={() => {
                                                        onPrice(row.id, Math.round(editingState.parsed * 100) / 100);
                                                        setEditPrice(null);
                                                    }}
                                                >
                                                    حفظ السعر
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}

                {canSell && cart.length ? (
                    <section className="pos-payments" aria-label="الدفع">
                        <div className="pos-payments__head">
                            <strong className="pos-payments__title">الدفع</strong>
                            <span className={`pos-payments__state${invalid ? ' is-invalid' : ''}`} role="status" aria-live="polite">
                                {paymentState}
                            </span>
                        </div>
                        <div className="pos-payments__body">
                            <div className="pos-methods" role="group" aria-label="تعبئة المتبقي في طريقة الدفع">
                                {PAYMENT_FIELDS.map((field) => {
                                    const Icon = METHOD_ICONS[field.key];
                                    const filled = parsePosMoney(payments[field.key]) > 0;
                                    return (
                                        <button
                                            key={field.key}
                                            type="button"
                                            className={`pos-method${filled ? ' is-active' : ''}`}
                                            aria-pressed={filled}
                                            disabled={busy}
                                            title={`تعبئة المتبقي ${moneyText(remainingFor(field.key))} في «${field.label}»`}
                                            onClick={() => {
                                                fillRemaining(field.key);
                                            }}
                                        >
                                            <Icon />
                                            <span>{field.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="pos-bills" role="group" aria-label="فئات نقدية سريعة">
                                {CASH_BILLS.map((bill) => (
                                    <button
                                        key={bill}
                                        type="button"
                                        className="pos-bill"
                                        disabled={busy}
                                        onClick={() => {
                                            onPayment('cash', bill.toFixed(2));
                                        }}
                                    >
                                        {bill}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    className="pos-bill pos-bill--exact"
                                    disabled={busy}
                                    onClick={() => {
                                        onPayment('cash', remainingFor('cash').toFixed(2));
                                    }}
                                >
                                    المبلغ بالظبط
                                </button>
                            </div>
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
                    </section>
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
                    <div className="pos-cart__foot-actions">
                        <Button
                            variant="secondary"
                            className="pos-cart__print"
                            loading={printReceiptPending}
                            disabled={busy || printReceiptPending || !canPrintReceipt}
                            onClick={onPrintReceipt}
                            title={canPrintReceipt ? 'طباعة إيصال آخر بيع' : 'الطباعة متاحة بعد إتمام أول بيع'}
                            aria-label="طباعة الإيصال"
                        >
                            <PrinterIcon />
                            طباعة
                        </Button>
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
                    </div>
                ) : null}
            </footer>
        </section>
    );
}
