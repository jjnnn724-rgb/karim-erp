import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuffetLive, HeldOrder } from '../../lib/pos';
import { intOf } from '../../lib/reporting';
import { Badge, Button, SearchInput } from '../../ui';
import { CatalogPriceEdit } from './CatalogPriceEdit';
import { ProductArt } from './pos-art';
import { bestSellers, type CatalogItem, moneyText, orderCatalog, qtyText, type SalesIndex, soldQty } from './pos-ui';

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
    /** manager/admin فقط — يفتح محرر سعر البيع من البطاقة. */
    canEditProductPrice: boolean;
    onProductPriceSaved: (productId: string, price: number) => void;
    imagePending: boolean;
    onUploadImage: (item: CatalogItem, file: File) => void;
    onRemoveImage: (item: CatalogItem) => void;
    onRecall: (order: HeldOrder) => void;
    onDeleteHeld: (order: HeldOrder) => void;
    busy: boolean;
}

/** عدد البطاقات في الدفعة الأولى ومن كل دفعة تالية عند التمرير. */
const PAGE_SIZE = 60;

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
                <span className="pos-live__pill pos-live__pill--warning">{intOf(daily.voided?.count ?? 0)} ملغاة</span>
            ) : null}
        </div>
    );
}

interface ProductCardProps {
    item: CatalogItem;
    pinned: boolean;
    canSell: boolean;
    busy: boolean;
    canManageCatalog: boolean;
    imagePending: boolean;
    /** manager/admin فقط */
    canEditProductPrice: boolean;
    onAdd: (item: CatalogItem) => void;
    onToggleFavorite: (item: CatalogItem) => void;
    onPickImage: (item: CatalogItem) => void;
    onRemoveImage: (item: CatalogItem) => void;
    onEditPrice: (item: CatalogItem) => void;
}

/**
 * بطاقة صنف واحدة — مُذكَّرة عمدًا: إضافة صنف للسلة أو تغيير كمية لا يعيد رسم
 * بقية البطاقات الـ322، وهو أكبر تكلفة في الشاشة عند كل لمسة.
 */
const ProductCard = memo(function ProductCard({
    item,
    pinned,
    canSell,
    busy,
    canManageCatalog,
    imagePending,
    canEditProductPrice,
    onAdd,
    onToggleFavorite,
    onPickImage,
    onRemoveImage,
    onEditPrice,
}: ProductCardProps) {
    return (
        <article className={`pos-product${pinned ? ' is-pinned' : ''}`}>
            <button
                type="button"
                className="pos-product__main"
                aria-label={`إضافة ${item.name} إلى السلة`}
                disabled={!canSell || busy}
                onClick={() => {
                    onAdd(item);
                }}
            >
                <span className="pos-product__media">
                    <ProductArt item={item} />
                    {item.imageUrl ? (
                        <img
                            className="pos-product__photo"
                            src={item.imageUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            fetchPriority="low"
                            onError={(event) => {
                                // صورة تالفة أو مفقودة: أخفِها فتظهر أيقونة العائلة خلفها.
                                event.currentTarget.style.visibility = 'hidden';
                            }}
                        />
                    ) : null}
                    {item.category ? <span className="pos-product__category-badge">{item.category}</span> : null}
                    {item.stock !== null && item.stock <= 5 ? (
                        <span className="pos-product__stock">{`متبقي ${qtyText(item.stock)}`}</span>
                    ) : null}
                    <span className="pos-product__add" aria-hidden="true">
                        +
                    </span>
                </span>
                <span className="pos-product__info">
                    <strong>{item.name}</strong>
                    {item.nameEn ? (
                        <span className="pos-product__name-en" dir="ltr">
                            {item.nameEn}
                        </span>
                    ) : null}
                    <span className="pos-product__price-row">
                        <span className="pos-product__price">
                            {moneyText(item.price)}
                            {item.unit ? <span className="pos-product__unit">/{item.unit}</span> : null}
                        </span>
                    </span>
                </span>
            </button>
            {canSell ? (
                <button
                    type="button"
                    className={`pos-product__pin${pinned ? ' is-on' : ''}`}
                    aria-label={pinned ? `إزالة ${item.name} من المفضلة` : `إضافة ${item.name} إلى المفضلة`}
                    aria-pressed={pinned}
                    disabled={busy}
                    onClick={() => {
                        onToggleFavorite(item);
                    }}
                >
                    {pinned ? '★' : '☆'}
                </button>
            ) : null}
            {canEditProductPrice ? (
                <button
                    type="button"
                    className="pos-product__price-edit"
                    aria-label={`تعديل سعر ${item.name}`}
                    title="تعديل سعر البيع"
                    disabled={busy}
                    onClick={() => {
                        onEditPrice(item);
                    }}
                >
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        width="13"
                        height="13"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M12.6 3.7a2 2 0 0 1 1.4-.6h.6a2 2 0 0 1 1.4.6l4.3 4.3a2 2 0 0 1 0 2.8l-8.5 8.5a2 2 0 0 1-2.8 0l-4.3-4.3a2 2 0 0 1 0-2.8l8.5-8.5Z" />
                        <path d="M13 7l4 4M8.5 12.5l3 3" />
                    </svg>
                </button>
            ) : null}
            {canManageCatalog ? (
                <div className="pos-product__image-actions">
                    <button
                        type="button"
                        className="pos-product__image-action"
                        aria-label={`رفع أو تغيير صورة ${item.name}`}
                        disabled={busy || imagePending}
                        onClick={() => {
                            onPickImage(item);
                        }}
                    >
                        صورة
                    </button>
                    {item.hasImage ? (
                        <button
                            type="button"
                            className="pos-product__image-action"
                            aria-label={`حذف صورة ${item.name}`}
                            disabled={busy || imagePending}
                            onClick={() => {
                                onRemoveImage(item);
                            }}
                        >
                            حذف الصورة
                        </button>
                    ) : null}
                </div>
            ) : null}
        </article>
    );
});

/** كتالوج البيع: بحث وباركود، تصنيفات، بطاقات أصناف أو أفراد بوفيه، معلّقات. */
function PosCatalogView({
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
    onRemoveImage,
    onRecall,
    onDeleteHeld,
    busy,
    canEditProductPrice,
    onProductPriceSaved,
}: PosCatalogProps) {
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [imageTarget, setImageTarget] = useState<CatalogItem | null>(null);
    const [priceEditTarget, setPriceEditTarget] = useState<CatalogItem | null>(null);
    const needle = query.trim().toLocaleLowerCase();

    useEffect(() => {
        searchInputRef.current?.focus();
    }, [searchInputRef]);

    const categories = useMemo(() => {
        const soldByCategory = new Map<string, number>();
        const itemsByCategory = new Map<string, number>();
        for (const item of items) {
            if (!item.category) continue;
            soldByCategory.set(item.category, (soldByCategory.get(item.category) ?? 0) + soldQty(item, sales));
            itemsByCategory.set(item.category, (itemsByCategory.get(item.category) ?? 0) + 1);
        }
        return [...soldByCategory.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'))
            .map(([category]) => ({ name: category, count: itemsByCategory.get(category) ?? 0 }));
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

    // تحميل تدريجي للبطاقات: تركيب 322 بطاقة معًا يكلّف أول رسم وتذكيرات لا داعي لها.
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [toolsOpen, setToolsOpen] = useState(false);

    useEffect(() => {
        if (!toolsOpen) {
            return undefined;
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setToolsOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
        };
    }, [toolsOpen]);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    // biome-ignore lint/correctness/useExhaustiveDependencies: filter changes intentionally reset the visible page.
    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [needle, selectedCategory, buffet]);

    useEffect(() => {
        const node = sentinelRef.current;
        if (!node) return;
        if (typeof IntersectionObserver === 'undefined') {
            setVisibleCount(ordered.length);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    if (visibleCount >= ordered.length) return;
                    setVisibleCount((current) => Math.min(ordered.length, current + PAGE_SIZE));
                }
            },
            { rootMargin: '600px 0px' },
        );
        observer.observe(node);
        return () => {
            observer.disconnect();
        };
    }, [ordered.length, visibleCount]);

    const hasSales = useMemo(() => Object.keys(sales).length > 0, [sales]);
    const topSellers = useMemo(() => {
        if (buffet || !hasSales) return [];
        return bestSellers(filtered, { favorites, sales, limit: 6 });
    }, [buffet, favorites, filtered, hasSales, sales]);

    const favoriteItems = useMemo(() => {
        if (buffet) {
            return [] as CatalogItem[];
        }
        return favorites.map((id) => items.find((item) => item.id === id)).filter((item): item is CatalogItem => Boolean(item));
    }, [buffet, favorites, items]);

    const pickImage = useCallback((item: CatalogItem) => {
        setImageTarget(item);
        fileRef.current?.click();
    }, []);

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
                <span className="pos-person__price">{item.price === 0 ? 'مجاناً' : moneyText(item.price)}</span>
                <span className="pos-person__add">+ إضافة فرد</span>
            </button>
        ) : (
            <ProductCard
                key={item.id}
                item={item}
                pinned={favorites.includes(item.id)}
                canSell={canSell}
                busy={busy}
                canManageCatalog={canManageCatalog}
                imagePending={imagePending}
                canEditProductPrice={canEditProductPrice}
                onAdd={onAdd}
                onToggleFavorite={onToggleFavorite}
                onPickImage={pickImage}
                onRemoveImage={onRemoveImage}
                onEditPrice={setPriceEditTarget}
            />
        );
    }

    return (
        <section className="erp-card pos-catalog" aria-labelledby="pos-catalog-title">
            <h2 id="pos-catalog-title" className="sr-only">
                الأصناف
            </h2>

            {!buffet ? (
                <button
                    type="button"
                    className="pos-tools-toggle"
                    aria-expanded={toolsOpen}
                    aria-controls="pos-tools-panel"
                    aria-label="الفئات والمفضلة والأكثر مبيعًا"
                    title="الفئات والمفضلة والأكثر مبيعًا"
                    onClick={() => {
                        setToolsOpen((open) => !open);
                    }}
                >
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M4 6h16M7 12h10M10 18h4" />
                    </svg>
                </button>
            ) : null}
            {toolsOpen && !buffet ? (
                <>
                    <button
                        type="button"
                        className="pos-tools-scrim"
                        aria-label="إغلاق أدوات الكتالوج"
                        onClick={() => {
                            setToolsOpen(false);
                        }}
                    />
                    <div className="pos-tools-panel" id="pos-tools-panel" role="dialog" aria-modal="false" aria-label="أدوات الكتالوج">
                        <header className="pos-tools-panel__head">
                            <strong className="pos-tools-panel__title">الكتالوج</strong>
                            <Badge variant="info">{intOf(filtered.length)} صنف</Badge>
                            <button
                                type="button"
                                className="pos-tools-close"
                                aria-label="إغلاق"
                                onClick={() => {
                                    setToolsOpen(false);
                                }}
                            >
                                ×
                            </button>
                        </header>

                        {categories.length ? (
                            <div className="pos-tools-group" role="group" aria-label="الفئات">
                                <span className="pos-tools-group__label">الفئات</span>
                                <div className="pos-tools-chips">
                                    <button
                                        type="button"
                                        className={`pos-category${selectedCategory ? '' : ' is-active'}`}
                                        aria-pressed={!selectedCategory}
                                        onClick={() => {
                                            onCategory('');
                                            setToolsOpen(false);
                                        }}
                                    >
                                        الكل
                                    </button>
                                    {categories.map((category) => (
                                        <button
                                            key={category.name}
                                            type="button"
                                            className={`pos-category${selectedCategory === category.name ? ' is-active' : ''}`}
                                            aria-pressed={selectedCategory === category.name}
                                            onClick={() => {
                                                onCategory(category.name);
                                                setToolsOpen(false);
                                            }}
                                        >
                                            {category.name}
                                            <span className="pos-category__count" aria-hidden="true">
                                                {intOf(category.count)}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {favoriteItems.length ? (
                            <div className="pos-tools-group" role="group" aria-label="الأصناف المفضلة">
                                <span className="pos-tools-group__label">المفضلة</span>
                                <div className="pos-tools-quick">
                                    {favoriteItems.map((item) => (
                                        <button
                                            key={`fav-${String(item.id)}`}
                                            type="button"
                                            className="pos-favorite"
                                            aria-label={`إضافة ${item.name} إلى السلة من المفضلة`}
                                            disabled={!canSell || busy}
                                            onClick={() => {
                                                onAdd(item);
                                            }}
                                        >
                                            {item.imageUrl ? (
                                                <img
                                                    className="pos-favorite__thumb"
                                                    src={item.imageUrl}
                                                    alt=""
                                                    loading="lazy"
                                                    decoding="async"
                                                    onError={(event) => {
                                                        event.currentTarget.style.visibility = 'hidden';
                                                    }}
                                                />
                                            ) : null}
                                            <span className="pos-favorite__copy">
                                                <strong>{item.name}</strong>
                                                <small>{moneyText(item.price)}</small>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {topSellers.length ? (
                            <div className="pos-tools-group" role="group" aria-label="الأكثر مبيعًا">
                                <span className="pos-tools-group__label">الأكثر مبيعًا</span>
                                <div className="pos-tools-quick">
                                    {topSellers.map((item) => (
                                        <button
                                            key={`best-${String(item.id)}`}
                                            type="button"
                                            className="pos-favorite pos-favorite--best"
                                            aria-label={`إضافة ${item.name} إلى السلة من الأكثر مبيعًا`}
                                            disabled={!canSell || busy}
                                            onClick={() => {
                                                onAdd(item);
                                            }}
                                        >
                                            {item.imageUrl ? (
                                                <img
                                                    className="pos-favorite__thumb"
                                                    src={item.imageUrl}
                                                    alt=""
                                                    loading="lazy"
                                                    decoding="async"
                                                    onError={(event) => {
                                                        event.currentTarget.style.visibility = 'hidden';
                                                    }}
                                                />
                                            ) : null}
                                            <span className="pos-favorite__copy">
                                                <strong>{item.name}</strong>
                                                <small>
                                                    {moneyText(item.price)} · {qtyText(soldQty(item, sales))} مبيعًا
                                                </small>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </>
            ) : null}

            <div className="pos-catalog__toolbar">
                {buffet ? (
                    <div className="pos-catalog__head">
                        <span className="erp-card__title">فئات البوفيه</span>
                        <Badge variant="info">بوفيه مفتوح</Badge>
                    </div>
                ) : null}
                <SearchInput
                    inputRef={searchInputRef}
                    label={buffet ? 'بحث الفئات' : 'بحث الأصناف'}
                    placeholder={buffet ? 'اسم فئة البوفيه... [F2]' : 'اسم الصنف أو الباركود... [F2]'}
                    value={query}
                    onChange={onQuery}
                    inputMode="none"
                    autoComplete="off"
                    enterKeyHint="enter"
                    className="pos-search"
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            onBarcodeEnter();
                        }
                    }}
                />
            </div>

            <div className="erp-card__body pos-catalog__body">
                {buffet ? <BuffetLiveStrip live={buffetLive} /> : null}

                {filtered.length === 0 ? (
                    <p className="text-body-sm text-muted" role="status">
                        {buffet ? 'لا توجد فئات بوفيه مطابقة أو مفعّلة — راجع أسعار البوفيه.' : 'لا توجد أصناف مطابقة.'}
                    </p>
                ) : (
                    <div className={`pos-grid${buffet ? ' pos-grid--people' : ''}`}>
                        {ordered.slice(0, visibleCount).map(renderItem)}
                        {visibleCount < ordered.length ? <div ref={sentinelRef} className="pos-grid__sentinel" aria-hidden="true" /> : null}
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
            {!buffet ? (
                <CatalogPriceEdit
                    product={priceEditTarget}
                    onClose={() => {
                        setPriceEditTarget(null);
                    }}
                    onSaved={onProductPriceSaved}
                />
            ) : null}
        </section>
    );
}

/**
 * السلة تتغير مع كل لمسة؛ تغليف الكتالوج بـ memo يعني أن إضافة صنف لا تلمس
 * شبكة الأصناف إطلاقًا (لا حساب ترتيب ولا إعادة رسم بطاقات).
 */
export const PosCatalog = memo(PosCatalogView);
