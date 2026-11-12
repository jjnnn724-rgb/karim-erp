import { useMemo, useRef, useState, type RefObject } from 'react';
import { Badge, Button, SearchInput } from '../../ui';
import type { BuffetLive, HeldOrder } from '../../lib/pos';
import { intOf } from '../../lib/reporting';
import {
    bestSellers,
    groupCatalog,
    moneyText,
    orderCatalog,
    qtyText,
    soldQty,
    type CatalogItem,
    type SalesIndex,
} from './pos-ui';
import { PosProductImage } from './PosProductImage';

export interface PosCatalogProps {
    buffet: boolean;
    items: readonly CatalogItem[];
    heldOrders: readonly HeldOrder[];
    heldError: string;
    buffetLive: BuffetLive | null;
    /** كميات البيع برمز Yara — تُرتَّب بها البطاقات؛ غيابها يعني ترتيبًا أبجديًا. */
    sales: SalesIndex;
    query: string;
    onQuery: (value: string) => void;
    selectedCategory: string;
    onCategory: (value: string) => void;
    onAdd: (item: CatalogItem) => void;
    onBarcodeEnter: () => void;
    searchInputRef: RefObject<HTMLInputElement | null>;
    favorites: readonly string[];
    onToggleFavorite: (item: CatalogItem) => void;
    canSell: boolean;
    canManageCatalog: boolean;
    imagePending: boolean;
    onUploadImage: (item: CatalogItem, file: File) => void;
    onRecall: (order: HeldOrder) => void;
    onDeleteHeld: (order: HeldOrder) => void;
    busy: boolean;
}

function tierMark(tier: string): string {
    return ({ adult: 'كبير', child: 'صغير', hospitality: 'ضيافة' } as Record<string, string>)[tier] ?? 'فئة';
}

function BuffetLiveStrip({ live }: { live: BuffetLive | null }) {
    if (!live?.daily) {
        return (
            <p className="pos-live" role="status">
                العداد الحي غير متاح حاليًا.
            </p>
        );
    }
    const daily = live.daily;
    return (
        <div className="pos-live" role="status" aria-live="polite">
            <span className="pos-live__dot" aria-hidden="true" />
            <span className="pos-live__pill">
                <strong>{intOf(daily.covers_total ?? 0)}</strong> فرد اليوم
            </span>
            <span className="pos-live__pill">
                <strong>{moneyText(daily.revenue ?? 0)}</strong>
            </span>
            <span className="pos-live__pill">
                <strong>{intOf(daily.invoices_count ?? 0)}</strong> فاتورة
            </span>
            {live.shift ? (
                <span className="pos-live__pill">
                    <strong>{intOf(live.shift.covers_total ?? 0)}</strong> فرد الوردية
                </span>
            ) : null}
            {Number(daily.voided?.count ?? 0) > 0 ? (
                <span className="pos-live__pill pos-live__pill--warning">
                    {intOf(daily.voided?.count ?? 0)} ملغاة
                </span>
            ) : null}
        </div>
    );
}

/** كتالوج البيع: بحث وباركود، تصنيفات، بطاقات أصناف أو أفراد بوفيه، معلّقات. */
export function PosCatalog({
    buffet,
    items,
    heldOrders,
    heldError,
    buffetLive,
    sales,
    query,
    onQuery,
    selectedCategory,
    onCategory,
    onAdd,
    onBarcodeEnter,
    searchInputRef,
    favorites,
    onToggleFavorite,
    canSell,
    canManageCatalog,
    imagePending,
    onUploadImage,
    onRecall,
    onDeleteHeld,
    busy,
}: PosCatalogProps) {
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [imageTarget, setImageTarget] = useState<CatalogItem | null>(null);
    const needle = query.trim().toLocaleLowerCase();

    const categories = useMemo(() => {
        const soldByCategory = new Map<string, number>();
        for (const item of items) {
            if (!item.category) continue;
            soldByCategory.set(item.category, (soldByCategory.get(item.category) ?? 0) + soldQty(item, sales));
        }
        return [...soldByCategory.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'))
            .map(([category]) => category);
    }, [items, sales]);

    const filtered = useMemo(() => {
        return items.filter((item) => {
            const categoryMatch = buffet || !selectedCategory || item.category === selectedCategory;
            const haystack = `${item.name} ${item.barcode} ${item.category}`.toLocaleLowerCase();
            return categoryMatch && (!needle || haystack.includes(needle));
        });
    }, [buffet, items, needle, selectedCategory]);

    const ordered = useMemo(() => {
        if (buffet) return filtered;
        return orderCatalog(filtered, { favorites, sales, query: needle });
    }, [buffet, favorites, filtered, needle, sales]);

    const grouped = !buffet && !needle && !selectedCategory;
    const groups = useMemo(() => {
        if (!grouped) return [];
        return groupCatalog(filtered, { favorites, sales });
    }, [favorites, filtered, grouped, sales]);

    const hasSales = useMemo(() => Object.keys(sales).length > 0, [sales]);
    const topSellers = useMemo(() => {
        if (buffet || !hasSales) return [];
        return bestSellers(filtered, { favorites, sales, limit: 6 });
    }, [buffet, favorites, filtered, hasSales, sales]);

    const favoriteItems = useMemo(() => {
        if (buffet) {
            return [] as CatalogItem[];
        }
        return favorites
            .map((id) => items.find((item) => item.id === id))
            .filter((item): item is CatalogItem => Boolean(item));
    }, [buffet, favorites, items]);

    function pickImage(item: CatalogItem) {
        setImageTarget(item);
        fileRef.current?.click();
    }

    function renderItem(item: CatalogItem) {
        return buffet ? (
            <button
                key={item.id}
                type="button"
                className="pos-person"
                aria-label={`إضافة ${item.name} إلى السلة`}
                disabled={!canSell || busy}
                onClick={() => {
                    onAdd(item);
                }}
            >
                <span className="pos-person__mark">{tierMark(item.tier)}</span>
                <strong>{item.name}</strong>
                <small>{item.price === 0 ? 'ضيافة مجانية' : `${item.unit} واحد`}</small>
                <span className="pos-person__price">
                    {item.price === 0 ? 'مجاناً' : moneyText(item.price)}
                </span>
                <span className="pos-person__add">+ إضافة فرد</span>
            </button>
        ) : (
            <article key={item.id} className={`pos-product${favorites.includes(item.id) ? ' is-pinned' : ''}`}>
                <button
                    type="button"
                    className="pos-product__main"
                    aria-label={`إضافة ${item.name} إلى السلة`}
                    disabled={!canSell || busy}
                    onClick={() => {
                        onAdd(item);
                    }}
                >
                    <span className="pos-product__image">
                        <PosProductImage src={item.imageUrl} name={item.name} />
                    </span>
                    <span className="pos-product__info">
                        <strong>{item.name}</strong>
                        <span className="pos-product__price">{moneyText(item.price)}</span>
                        <span className="pos-product__meta">
                            <small>{`المتاح: ${item.stock === null ? '—' : qtyText(item.stock)} ${item.unit}`}</small>
                            {item.barcode ? <small dir="ltr">{item.barcode}</small> : null}
                        </span>
                    </span>
                </button>
                {canSell ? (
                    <button
                        type="button"
                        className={`pos-product__pin${favorites.includes(item.id) ? ' is-on' : ''}`}
                        aria-label={
                            favorites.includes(item.id)
                                ? `إزالة ${item.name} من المفضلة`
                                : `إضافة ${item.name} إلى المفضلة`
                        }
                        aria-pressed={favorites.includes(item.id)}
                        disabled={busy}
                        onClick={() => {
                            onToggleFavorite(item);
                        }}
                    >
                        {favorites.includes(item.id) ? '★' : '☆'}
                    </button>
                ) : null}
                {canManageCatalog ? (
                    <button
                        type="button"
                        className="pos-product__image-action"
                        aria-label={`رفع أو تغيير صورة ${item.name}`}
                        disabled={busy || imagePending}
                        onClick={() => {
                            pickImage(item);
                        }}
                    >
                        {item.imageUrl ? 'تغيير الصورة' : 'إضافة صورة'}
                    </button>
                ) : null}
            </article>
        );
    }

    return (
        <section className="erp-card pos-catalog" aria-labelledby="pos-catalog-title">
            <div className="erp-card__body pos-catalog__body">
                <div className="pos-catalog__head">
                    <h2 id="pos-catalog-title" className="erp-card__title">
                        {buffet ? 'فئات البوفيه' : 'الأصناف'} <Badge variant="info">{intOf(filtered.length)}</Badge>
                        {buffet ? (
                            <Badge variant="info" className="ms-xs">
                                بوفيه مفتوح
                            </Badge>
                        ) : null}
                    </h2>
                    <p className="text-body-sm text-muted">
                        {buffet
                            ? 'اختر فئة لإضافة فرد'
                            : hasSales
                              ? 'المفضلة ثم الأكثر مبيعًا — واختر فئة للتصفية'
                              : 'اضغط الصنف أو امسح الباركود ثم Enter'}
                    </p>
                </div>

                {buffet ? <BuffetLiveStrip live={buffetLive} /> : null}

                {!buffet && favoriteItems.length ? (
                    <div className="pos-favorites" role="group" aria-label="الأصناف المفضلة">
                        <span className="pos-favorites__label">المفضلة</span>
                        <div className="pos-favorites__list">
                            {favoriteItems.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className="pos-favorite"
                                    aria-label={`إضافة ${item.name} إلى السلة من المفضلة`}
                                    disabled={!canSell || busy}
                                    onClick={() => {
                                        onAdd(item);
                                    }}
                                >
                                    <strong>{item.name}</strong>
                                    <small>{moneyText(item.price)}</small>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}

                {topSellers.length ? (
                    <div className="pos-favorites pos-favorites--best" role="group" aria-label="الأكثر مبيعًا">
                        <span className="pos-favorites__label">الأكثر مبيعًا</span>
                        <div className="pos-favorites__list">
                            {topSellers.map((item) => (
                                <button
                                    key={`best-${item.id}`}
                                    type="button"
                                    className="pos-favorite pos-favorite--best"
                                    aria-label={`إضافة ${item.name} إلى السلة من الأكثر مبيعًا`}
                                    disabled={!canSell || busy}
                                    onClick={() => {
                                        onAdd(item);
                                    }}
                                >
                                    <strong>{item.name}</strong>
                                    <small>
                                        {moneyText(item.price)} · {qtyText(soldQty(item, sales))} مبيعًا
                                    </small>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}

                <SearchInput
                    inputRef={searchInputRef}
                    label={buffet ? 'بحث الفئات' : 'بحث الأصناف'}
                    placeholder={buffet ? 'اسم فئة البوفيه' : 'اسم الصنف أو الباركود ثم Enter'}
                    value={query}
                    onChange={onQuery}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            onBarcodeEnter();
                        }
                    }}
                    autoFocus
                />

                {!buffet && categories.length ? (
                    <div className="pos-categories" role="group" aria-label="تصنيف الأصناف">
                        <button
                            type="button"
                            className={`pos-category${selectedCategory ? '' : ' is-active'}`}
                            aria-pressed={!selectedCategory}
                            onClick={() => {
                                onCategory('');
                            }}
                        >
                            الكل
                        </button>
                        {categories.map((category) => (
                            <button
                                key={category}
                                type="button"
                                className={`pos-category${selectedCategory === category ? ' is-active' : ''}`}
                                aria-pressed={selectedCategory === category}
                                onClick={() => {
                                    onCategory(category);
                                }}
                            >
                                {category}
                            </button>
                        ))}
                    </div>
                ) : null}

                {filtered.length === 0 ? (
                    <p className="text-body-sm text-muted" role="status">
                        {buffet
                            ? 'لا توجد فئات بوفيه مطابقة أو مفعّلة — راجع أسعار البوفيه.'
                            : 'لا توجد أصناف مطابقة.'}
                    </p>
                ) : (
                    <div className="pos-groups">
                        {(grouped ? groups : [{ key: '', items: ordered, sold: 0 }]).map((group) =>
                            group.key ? (
                                <section key={group.key} className="pos-group" aria-label={`فئة ${group.key}`}>
                                    <h3 className="pos-group__title">
                                        {group.key} <Badge variant="info">{intOf(group.items.length)}</Badge>
                                    </h3>
                                    <div className="pos-grid">{group.items.map(renderItem)}</div>
                                </section>
                            ) : (
                                <div key="flat" className={`pos-grid${buffet ? ' pos-grid--people' : ''}`}>
                                    {group.items.map(renderItem)}
                                </div>
                            ),
                        )}
                    </div>
                )}

                {canManageCatalog && !buffet ? (
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        hidden
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            const target = imageTarget;
                            event.target.value = '';
                            if (file && target) {
                                onUploadImage(target, file);
                            }
                            setImageTarget(null);
                        }}
                    />
                ) : null}

                <section className="pos-held" aria-labelledby="pos-held-title">
                    <h3 id="pos-held-title" className="pos-held__title">
                        الطلبات المعلقة <Badge variant="info">{heldOrders.length}</Badge>
                    </h3>
                    {heldError ? (
                        <p className="text-body-sm text-danger" role="alert">
                            {heldError}
                        </p>
                    ) : null}
                    {heldOrders.length === 0 ? (
                        <p className="text-body-sm text-muted">لا توجد طلبات معلقة.</p>
                    ) : (
                        <ul className="pos-held__list">
                            {heldOrders.map((order) => (
                                <li key={order.id} className="pos-held__row">
                                    <div className="min-w-0">
                                        <strong>{order.items_preview || 'طلب محفوظ'}</strong>
                                        <small>
                                            {moneyText(order.total_amount)} · {order.created_at ?? ''}
                                        </small>
                                    </div>
                                    <div className="pos-held__actions">
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            disabled={!canSell || busy}
                                            onClick={() => {
                                                onRecall(order);
                                            }}
                                        >
                                            استرجاع
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={!canSell || busy}
                                            onClick={() => {
                                                onDeleteHeld(order);
                                            }}
                                        >
                                            حذف
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </section>
    );
}
