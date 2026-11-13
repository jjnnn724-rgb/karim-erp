import './PosEntry.premium.css';
import './PosEntry.midnight.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { StateError, StateLoading } from '../components/TableState';
import { ApiError } from '../lib/api';
import { useAuthState } from '../lib/auth';
import {
    addBuffetTier,
    type BuffetTier,
    closePosShift,
    completePosSale,
    deleteHeldOrder,
    disableBuffetTier,
    execDayClose,
    expectedCash,
    fetchActiveShift,
    fetchBuffetConfig,
    fetchBuffetInvoices,
    fetchBuffetLive,
    fetchBuffetReport,
    fetchDayCloseStatus,
    fetchHeldOrders,
    fetchKotHtml,
    fetchPosDepartments,
    fetchPosOrder,
    fetchPosOrders,
    fetchPosOrdersExport,
    fetchPosProducts,
    fetchPosQuote,
    fetchSalesQuantities,
    fetchShiftSummary,
    type HeldOrder,
    holdPosOrder,
    isBuffetDepartment,
    openPosDrawer,
    openPosShift,
    type PosOrderDetail,
    type PosPaymentInput,
    type PosSaleResult,
    recallHeldOrder,
    removePosProductImage,
    renameBuffetTier,
    reprintPosOrder,
    riyadhToday,
    saveBuffetPrices,
    setBuffetTierActive,
    uploadPosProductImage,
    voidPosOrder,
} from '../lib/pos';
import {
    applyQuoteToPosTotals,
    buildPosSaleItems,
    calculatePosTotals,
    matchPosBarcode,
    type PosCartLine,
    type PosDiscount,
    type PosSaleItem,
    type PosTotals,
    parsePosMoney,
} from '../lib/pos-pricing';
import { errorMessage, intOf } from '../lib/reporting';
import { Badge, Button, Dialog, Input, PageHeader, Textarea, useToast } from '../ui';
import { PosBuffetPrices, PosBuffetReport } from './pos/PosBuffet';
import { type PaymentReferenceKey, PosCart } from './pos/PosCart';
import { PosCatalog } from './pos/PosCatalog';
import { PosHistory, type PosHistoryFiltersState, PosOrderDetailPanel } from './pos/PosHistory';
import { PosOpenShift } from './pos/PosOpenShift';
import { PosPrinters } from './pos/PosPrinters';
import { PosReceipt } from './pos/PosReceipt';
import {
    BUFFET_ADMIN_ROLES,
    CATALOG_IMAGE_ROLES,
    type CardMeta,
    type CatalogItem,
    catalogFromProducts,
    catalogFromTiers,
    DAY_CLOSE_ROLES,
    HISTORY_ROLES,
    moneyText,
    newIdempotencyKey,
    openPrintWindow,
    openServerHtmlWindow,
    ordersPrintHtml,
    PAYMENT_FIELDS,
    type PaymentKey,
    POS_FAVORITES_LIMIT,
    POS_ROLES,
    readPosFavorites,
    roleIn,
    SELL_ROLES,
    VOID_ROLES,
    writePosFavorites,
} from './pos/pos-ui';

type View = 'cashier' | 'history' | 'order-detail' | 'buffet-prices' | 'buffet-report';

const EMPTY_DISCOUNT: PosDiscount = { type: '', value: '0' };
const EMPTY_PAYMENTS: Record<PaymentKey, string> = { cash: '0.00', card: '0', wallet: '0', bank_transfer: '0' };
const EMPTY_REFERENCES: Record<PaymentReferenceKey, string> = { card: '', wallet: '', bank_transfer: '' };
/** بطاقة الدفع المختارة — تُعلَن الماركة وآخر 4 أرقام على الإيصال */
const EMPTY_CARD_META: CardMeta = { brand: '', last4: '' };
const EMPTY_FILTERS: PosHistoryFiltersState = { dateFrom: '', dateTo: '', status: '', search: '' };
const EMPTY_SALES_INDEX: Record<string, number> = {};
// مصفوفة ثابتة الهوية: تمرير `[]` جديد كل رسم كان يهدم تذكير الكتالوج.
const EMPTY_HELD_ORDERS: HeldOrder[] = [];

const MAX_TABS = 5;
let tabSequence = 0;

/** طلب متوازٍ: سلة ودفع وإيصال ومفتاح منع تكرار مستقل لكل عميل. */
interface PosTab {
    id: string;
    cart: PosCartLine[];
    discount: PosDiscount;
    payments: Record<PaymentKey, string>;
    references: Record<PaymentReferenceKey, string>;
    cardMeta: CardMeta;
    paymentsTouched: boolean;
    receipt: PosSaleResult | null;
    saleKey: string;
}

function blankTab(id: string): PosTab {
    return {
        id,
        cart: [],
        discount: EMPTY_DISCOUNT,
        payments: EMPTY_PAYMENTS,
        references: EMPTY_REFERENCES,
        cardMeta: EMPTY_CARD_META,
        paymentsTouched: false,
        receipt: null,
        saleKey: '',
    };
}

function newPosTab(): PosTab {
    tabSequence += 1;
    return blankTab(`pos-tab-${String(tabSequence)}`);
}

function freshPosTab(tab: PosTab): PosTab {
    return blankTab(tab.id);
}

/** لا تخلو قائمة الطلبات عمليًا؛ هذا احتياطي لو حدث سباق حذف كي لا ينكسر الرسم. */
const FALLBACK_TAB: PosTab = blankTab('pos-tab-fallback');

function openShiftInfo(existingZ: unknown): string {
    if (existingZ && typeof existingZ === 'object' && 'z_number' in existingZ) {
        const number = (existingZ as { z_number?: unknown }).z_number;
        if (number !== null && number !== undefined) {
            return String(number);
        }
    }
    return '';
}

/** نقطة البيع — واجهة V3 الكاملة على نفس أبواب V2 والخادم هو الحاكم. */
export function PosEntry() {
    const auth = useAuthState();
    const role = auth.user?.role ?? '';
    const canAccess = roleIn(role, POS_ROLES);
    const canSell = roleIn(role, SELL_ROLES);
    const canHistory = roleIn(role, HISTORY_ROLES);
    const canVoid = roleIn(role, VOID_ROLES);
    const canManageCatalog = roleIn(role, CATALOG_IMAGE_ROLES);
    const canManageBuffet = roleIn(role, BUFFET_ADMIN_ROLES);
    const canDayClose = roleIn(role, DAY_CLOSE_ROLES);

    const queryClient = useQueryClient();
    const { toast } = useToast();
    const confirm = useConfirm();

    const [view, setView] = useState<View>('cashier');
    const [busy, setBusy] = useState(false);
    const [openError, setOpenError] = useState('');
    const [query, setQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');
    const [tabs, setTabs] = useState<PosTab[]>(() => [newPosTab()]);
    const [activeTabId, setActiveTabId] = useState('');
    const [favorites, setFavorites] = useState<string[]>([]);
    const [imagePending, setImagePending] = useState(false);
    const [printersOpen, setPrintersOpen] = useState(false);
    const [mobilePane, setMobilePane] = useState<'catalog' | 'cart'>('catalog');
    const paneSwitchRef = useRef<HTMLDivElement | null>(null);

    // التبديل بين اللوحتين على الشاشات الضيقة يعيد التمرير لرأس اللوحة،
    // فلا يهبط الكاشير في منتصف قائمة طويلة بعد التبديل.
    // biome-ignore lint/correctness/useExhaustiveDependencies: a pane transition triggers this scroll; the effect captures no mutable values.
    useEffect(() => {
        if (!window.matchMedia('(max-width: 1100px)').matches) return;
        const node = paneSwitchRef.current;
        if (!node) return;
        const top = node.getBoundingClientRect().top + window.scrollY - 84;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, [mobilePane]);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    /** قائمة «إدارة الوردية» — تُغلق عند النقر خارجها حتى لا تبقى فوق السلة. */
    const menuRef = useRef<HTMLDetailsElement | null>(null);

    useEffect(() => {
        function onPointerDown(event: MouseEvent) {
            const node = menuRef.current;
            if (!node?.open) {
                return;
            }
            if (event.target instanceof Node && !node.contains(event.target)) {
                node.open = false;
            }
        }
        document.addEventListener('mousedown', onPointerDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
        };
    }, []);

    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? FALLBACK_TAB;
    const cart = activeTab.cart;
    const discount = activeTab.discount;
    const payments = activeTab.payments;
    const references = activeTab.references;
    const cardMeta = activeTab.cardMeta;
    const paymentsTouched = activeTab.paymentsTouched;
    const receipt = activeTab.receipt;
    const cartCount = cart.reduce((sum, row) => sum + row.quantity, 0);

    const [historyFilters, setHistoryFilters] = useState<PosHistoryFiltersState>(EMPTY_FILTERS);
    const [historyPage, setHistoryPage] = useState(1);
    const [printingHistory, setPrintingHistory] = useState(false);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

    const [closeOpen, setCloseOpen] = useState(false);
    const [actualCash, setActualCash] = useState('');
    const [closeNotes, setCloseNotes] = useState('');
    const [closeError, setCloseError] = useState('');
    const [dayCloseBusy, setDayCloseBusy] = useState(false);

    const [voidTarget, setVoidTarget] = useState<PosOrderDetail | null>(null);
    const [voidReason, setVoidReason] = useState('');
    const [voidError, setVoidError] = useState('');

    const [buffetBusy, setBuffetBusy] = useState(false);
    const [reportDate, setReportDate] = useState(() => riyadhToday());

    const departmentsQuery = useQuery({
        queryKey: ['pos-departments'],
        queryFn: ({ signal }) => fetchPosDepartments(signal),
        enabled: canAccess,
        staleTime: 5 * 60 * 1000,
    });
    const shiftQuery = useQuery({
        queryKey: ['pos-active-shift'],
        queryFn: ({ signal }) => fetchActiveShift(signal),
        enabled: canAccess,
        refetchOnWindowFocus: false,
    });

    const shift = shiftQuery.data ?? null;
    const buffet = shift ? isBuffetDepartment({ deptCode: shift.deptCode, deptName: shift.deptName }) : false;
    const staleShift = Boolean(shift?.isStale);

    const productsQuery = useQuery({
        queryKey: ['pos-products', shift?.departmentId ?? ''],
        queryFn: ({ signal }) => fetchPosProducts(shift?.departmentId ?? '', signal),
        enabled: canAccess && Boolean(shift) && !buffet && !staleShift,
    });
    /* مبيعات 14 يومًا تُرتَّب بها البطاقات — فشلها لا يعطّل البيع (ترتيب أبجدي). */
    const salesRankQuery = useQuery({
        queryKey: ['pos-sales-ranking'],
        queryFn: ({ signal }) => fetchSalesQuantities(14, signal),
        enabled: canAccess && Boolean(shift) && !buffet && !staleShift,
        staleTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: false,
    });
    const buffetConfigQuery = useQuery({
        queryKey: ['pos-buffet-config'],
        queryFn: ({ signal }) => fetchBuffetConfig(signal),
        enabled: canAccess && Boolean(shift) && buffet && !staleShift,
        refetchOnWindowFocus: false,
    });
    const heldQuery = useQuery({
        queryKey: ['pos-held', shift?.sessionId ?? ''],
        queryFn: ({ signal }) => fetchHeldOrders(shift?.sessionId ?? '', signal),
        enabled: canAccess && Boolean(shift) && !staleShift,
    });
    const buffetLiveQuery = useQuery({
        queryKey: ['pos-buffet-live', shift?.sessionId ?? ''],
        queryFn: ({ signal }) => fetchBuffetLive(riyadhToday(), shift?.sessionId ?? null, signal),
        enabled: canAccess && Boolean(shift) && buffet && !staleShift,
        refetchInterval: 60_000,
    });

    const historyQuery = useQuery({
        queryKey: ['pos-orders', historyFilters, historyPage],
        queryFn: ({ signal }) => fetchPosOrders({ ...historyFilters, page: historyPage, limit: 20 }, signal),
        enabled: canAccess && canHistory && view === 'history',
    });
    const detailQuery = useQuery({
        queryKey: ['pos-order', selectedOrderId ?? ''],
        queryFn: ({ signal }) => fetchPosOrder(selectedOrderId ?? '', signal),
        enabled: view === 'order-detail' && Boolean(selectedOrderId),
    });
    const reportQuery = useQuery({
        queryKey: ['pos-buffet-report', reportDate],
        queryFn: ({ signal }) => fetchBuffetReport(reportDate, signal),
        enabled: view === 'buffet-report' && canAccess && buffet,
    });
    const reportInvoicesQuery = useQuery({
        queryKey: ['pos-buffet-invoices', reportDate],
        queryFn: ({ signal }) => fetchBuffetInvoices(reportDate, 200, signal),
        enabled: view === 'buffet-report' && canAccess && buffet,
    });
    const summaryQuery = useQuery({
        queryKey: ['pos-shift-summary', shift?.sessionId ?? ''],
        queryFn: ({ signal }) => fetchShiftSummary(shift?.sessionId ?? '', signal),
        enabled: closeOpen && Boolean(shift),
    });

    const items = useMemo(() => {
        if (buffet) {
            return catalogFromTiers(buffetConfigQuery.data?.tiers ?? []);
        }
        return catalogFromProducts(productsQuery.data ?? []);
    }, [buffet, buffetConfigQuery.data, productsQuery.data]);

    /** صور الأصناف المفهرسة بمعرّفها — مصغّرات السلة بلا طلب إضافي. */
    const itemImages = useMemo(() => {
        const map: Record<string, string> = {};
        for (const item of items) {
            if (item.imageUrl) map[item.id] = item.imageUrl;
        }
        return map;
    }, [items]);

    // مراجع مستقرة لأحداث الكتالوج: إضافة صنف أو تعديل المفضلة لا يجب أن يعيد
    // رسم 322 بطاقة صنف — البطاقة تُعاد فقط عندما يتغيّر صنفها فعليًا.
    const catalogHandlersRef = useRef({ addItem, toggleFavorite, uploadImage, removeImage, barcodeEnter, recallOrder, removeHeldOrder });
    catalogHandlersRef.current = { addItem, toggleFavorite, uploadImage, removeImage, barcodeEnter, recallOrder, removeHeldOrder };

    const handleAddItem = useCallback((item: CatalogItem) => {
        catalogHandlersRef.current.addItem(item);
    }, []);
    const handleToggleFavorite = useCallback((item: CatalogItem) => {
        catalogHandlersRef.current.toggleFavorite(item);
    }, []);
    const handleUploadImage = useCallback((item: CatalogItem, file: File) => {
        void catalogHandlersRef.current.uploadImage(item, file);
    }, []);
    const handleRemoveImage = useCallback((item: CatalogItem) => {
        void catalogHandlersRef.current.removeImage(item);
    }, []);
    const handleBarcodeEnter = useCallback(() => {
        catalogHandlersRef.current.barcodeEnter();
    }, []);
    const handleRecallOrder = useCallback((order: HeldOrder) => {
        void catalogHandlersRef.current.recallOrder(order);
    }, []);
    const handleDeleteHeld = useCallback((order: HeldOrder) => {
        void catalogHandlersRef.current.removeHeldOrder(order);
    }, []);

    const localTotals = useMemo(() => calculatePosTotals(cart, discount), [cart, discount]);

    /**
     * مطابقة المعاينة مع الخادم: التقدير يظهر فورًا، وبعد توقّف الكاشير عن
     * التعديل 350ms نسأل `/api/sales/quote` (نفس محرّك الفاتورة) ونستبدل
     * الأرقام بها. عند فشل الشبكة يبقى التقدير المحلي ولا يتعطّل البيع.
     */
    const quoteSignature = useMemo(
        () =>
            cart.length
                ? `${cart.map((row) => `${row.id}:${row.quantity}:${row.price}`).join('|')}#${discount.type}:${discount.value}`
                : '',
        [cart, discount],
    );
    const [quoteRequest, setQuoteRequest] = useState<{ key: string; items: PosSaleItem[] } | null>(null);

    useEffect(() => {
        if (!quoteSignature || !shift || busy || !localTotals.valid) {
            setQuoteRequest(null);
            return;
        }
        const timer = window.setTimeout(() => {
            try {
                setQuoteRequest({ key: quoteSignature, items: buildPosSaleItems(cart, discount) });
            } catch {
                setQuoteRequest(null);
            }
        }, 350);
        return () => window.clearTimeout(timer);
    }, [quoteSignature, shift, busy, localTotals.valid, cart, discount]);

    const quoteQuery = useQuery({
        queryKey: ['pos-quote', shift?.departmentId ?? '', quoteRequest?.key ?? ''],
        queryFn: ({ signal }) => fetchPosQuote(shift?.departmentId ?? '', quoteRequest?.items ?? [], signal),
        enabled: Boolean(shift && quoteRequest),
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 5 * 60 * 1000,
    });

    const serverTotals = useMemo<PosTotals | null>(() => {
        if (!quoteQuery.data || !quoteRequest || quoteRequest.key !== quoteSignature) {
            return null;
        }
        return applyQuoteToPosTotals(quoteQuery.data, cart, discount);
    }, [quoteQuery.data, quoteRequest, quoteSignature, cart, discount]);

    const totals = serverTotals ?? localTotals;
    const unbalancedInvoice = quoteQuery.error instanceof ApiError && quoteQuery.error.code === 'INVOICE_UNBALANCED';

    useEffect(() => {
        if (activeTab.paymentsTouched) {
            return;
        }
        const tabId = activeTab.id;
        setTabs((current) =>
            current.map((tab) =>
                tab.id === tabId && !tab.paymentsTouched ? { ...tab, payments: { ...tab.payments, cash: totals.total.toFixed(2) } } : tab,
            ),
        );
    }, [activeTab.id, activeTab.paymentsTouched, totals.total]);

    useEffect(() => {
        if (!buffet && (view === 'buffet-prices' || view === 'buffet-report')) {
            setView('cashier');
        }
    }, [buffet, view]);

    useEffect(() => {
        if (closeOpen && summaryQuery.data && !actualCash) {
            setActualCash(expectedCash(summaryQuery.data).toFixed(2));
        }
    }, [actualCash, closeOpen, summaryQuery.data]);

    const favoritesDept = shift?.departmentId ?? '';

    useEffect(() => {
        setFavorites(favoritesDept ? readPosFavorites(favoritesDept) : []);
    }, [favoritesDept]);

    function updateActiveTab(mutate: (tab: PosTab) => PosTab) {
        const id = activeTab.id;
        setTabs((current) => current.map((tab) => (tab.id === id ? mutate(tab) : tab)));
    }

    function resetSale() {
        updateActiveTab((tab) => freshPosTab(tab));
        setMobilePane('catalog');
    }

    function openCloseShiftDialog() {
        setActualCash('');
        setCloseNotes('');
        setCloseError('');
        setCloseOpen(true);
    }

    function addItem(item: CatalogItem) {
        if (!canSell) {
            return;
        }
        updateActiveTab((tab) => {
            const index = tab.cart.findIndex((row) => row.id === item.id);
            const cartNext =
                index >= 0
                    ? tab.cart.map((row, rowIndex) => (rowIndex === index ? { ...row, quantity: row.quantity + 1 } : row))
                    : [...tab.cart, { id: item.id, name: item.name, price: item.price, vatRate: item.vatRate, quantity: 1 }];
            return { ...tab, cart: cartNext, receipt: null, saleKey: '' };
        });
    }

    function changeQuantity(id: string, delta: number) {
        updateActiveTab((tab) => {
            const row = tab.cart.find((line) => line.id === id);
            if (!row) {
                return tab;
            }
            const quantity = row.quantity + delta;
            const cartNext =
                quantity <= 0
                    ? tab.cart.filter((line) => line.id !== id)
                    : tab.cart.map((line) => (line.id === id ? { ...line, quantity } : line));
            return { ...tab, cart: cartNext, receipt: null, saleKey: '' };
        });
    }

    function setPayment(key: PaymentKey, value: string) {
        updateActiveTab((tab) => ({
            ...tab,
            payments: { ...tab.payments, [key]: value },
            paymentsTouched: true,
            saleKey: '',
        }));
    }

    function setCardMeta(next: CardMeta) {
        updateActiveTab((tab) => ({ ...tab, cardMeta: next, saleKey: '' }));
    }

    function setReference(key: PaymentReferenceKey, value: string) {
        updateActiveTab((tab) => ({
            ...tab,
            references: { ...tab.references, [key]: value },
            saleKey: '',
        }));
    }

    function setDiscountValue(next: PosDiscount) {
        updateActiveTab((tab) => ({ ...tab, discount: next, saleKey: '' }));
    }

    function toggleFavorite(item: CatalogItem) {
        if (!canSell || !favoritesDept) {
            return;
        }
        setFavorites((current) => {
            const next = current.includes(item.id)
                ? current.filter((id) => id !== item.id)
                : [...current, item.id].slice(-POS_FAVORITES_LIMIT);
            writePosFavorites(favoritesDept, next);
            return next;
        });
    }

    function barcodeEnter() {
        const match = matchPosBarcode(items, query);
        if (match.status === 'ambiguous') {
            toast({ title: 'الباركود مرتبط بأكثر من صنف؛ راجع بيانات الأصناف قبل البيع.', variant: 'error' });
            return;
        }
        if (match.status !== 'matched' || !match.product) {
            return;
        }
        addItem(match.product);
        setQuery('');
    }

    async function handleOpenShift(departmentId: string, openingBalance: number) {
        if (!canSell || busy) {
            return;
        }
        setBusy(true);
        setOpenError('');
        try {
            const opened = await openPosShift(departmentId, openingBalance);
            const department = (departmentsQuery.data ?? []).find((row) => row.id === departmentId);
            const tab = newPosTab();
            setTabs([tab]);
            setActiveTabId(tab.id);
            setView('cashier');
            queryClient.setQueryData(['pos-active-shift'], {
                ...opened,
                deptName: department?.name_ar || department?.name_en || '',
                deptCode: department?.code ?? '',
            });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['pos-active-shift'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-buffet-config'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-held'] }),
            ]);
            toast({ title: 'تم فتح الوردية بنجاح.', variant: 'success' });
        } catch (error) {
            setOpenError(`تعذّر فتح الوردية: ${errorMessage(error)}`);
        } finally {
            setBusy(false);
        }
    }

    async function completeSale() {
        if (!canSell || busy || !shift || !cart.length) {
            return;
        }
        if (!totals.valid) {
            toast({ title: 'قيمة الخصم غير صالحة؛ تحقق من نوع الخصم وقيمته.', variant: 'error' });
            return;
        }
        if (unbalancedInvoice) {
            toast({
                title: 'الفاتورة غير متوازنة (الصافي + الضريبة ≠ الإجمالي)؛ لا يمكن إصدارها. راجع المحاسبة.',
                variant: 'error',
            });
            return;
        }
        const cardAmount = parsePosMoney(payments.card);
        if (cardAmount > 0) {
            const brandOk = cardMeta.brand.trim().length > 0;
            const last4Ok = /^\d{4}$/.test(cardMeta.last4.trim());
            const auth = references.card.trim();
            const missing = [
                !brandOk ? 'نوع البطاقة (مدى/فيزا/ماستركارد)' : '',
                !last4Ok ? 'آخر 4 أرقام من البطاقة' : '',
                !auth ? 'رقم المرجع/الموافقة من قارئ البطاقة' : '',
            ].filter(Boolean);
            if (missing.length) {
                toast({ title: `أكمل بيانات البطاقة: ${missing.join('، ')}.`, variant: 'error' });
                return;
            }
        }

        const entries = PAYMENT_FIELDS.map((field) => ({
            method: field.key,
            amount: parsePosMoney(payments[field.key]),
            reference: field.key === 'cash' ? null : references[field.key].trim() || null,
            ...(field.key === 'card' && cardMeta.brand ? { payer_info: { brand: cardMeta.brand, last4: cardMeta.last4.trim() } } : {}),
        }));
        if (entries.some((entry) => !Number.isFinite(entry.amount))) {
            toast({ title: 'أدخل مبالغ دفع صحيحة غير سالبة.', variant: 'error' });
            return;
        }
        const salePayments: PosPaymentInput[] = entries
            .filter((entry) => entry.amount > 0)
            .map((entry) => ({
                method: entry.method,
                amount: entry.amount,
                reference: entry.reference,
                ...(entry.payer_info ? { payer_info: entry.payer_info } : {}),
            }));
        const paid = salePayments.reduce((sum, payment) => sum + payment.amount, 0);
        if (paid + 0.009 < totals.total) {
            toast({ title: 'المبلغ المدفوع أقل من إجمالي الفاتورة.', variant: 'error' });
            return;
        }
        if (paid - totals.total > 0.01) {
            const ok = await confirm(
                `المدفوع ${moneyText(paid)} يزيد عن الإجمالي ${moneyText(totals.total)}. سيتم احتساب الباقي للعميل؛ هل تتابع؟`,
                { confirmLabel: 'متابعة البيع' },
            );
            if (!ok) {
                return;
            }
        }
        const saleKey = activeTab.saleKey || newIdempotencyKey(shift.sessionId);
        const settledTabId = activeTab.id;
        if (!activeTab.saleKey) {
            setTabs((current) => current.map((tab) => (tab.id === settledTabId ? { ...tab, saleKey } : tab)));
        }
        setBusy(true);
        try {
            const result = await completePosSale({
                departmentId: shift.departmentId,
                sessionId: shift.sessionId,
                items: buildPosSaleItems(cart, discount),
                payments: salePayments,
                idempotencyKey: saleKey,
            });
            setTabs((current) => current.map((tab) => (tab.id === settledTabId ? { ...freshPosTab(tab), receipt: result } : tab)));
            toast({ title: 'تم تسجيل البيع؛ حالة الطباعة وZATCA معروضة حسب رد الخادم.', variant: 'success' });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-buffet-config'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-buffet-live'] }),
            ]);
        } catch (error) {
            if (error instanceof ApiError && error.code === 'SHIFT_STALE') {
                void shiftQuery.refetch();
                toast({
                    title: 'وردية الأمس ما زالت مفتوحة؛ أغلقها أولًا ثم افتح وردية اليوم.',
                    variant: 'error',
                });
            } else {
                toast({ title: `فشل إتمام البيع ولم تُفرّغ السلة: ${errorMessage(error)}`, variant: 'error' });
            }
        } finally {
            setBusy(false);
        }
    }

    async function holdOrder() {
        if (!canSell || busy || !shift || !cart.length) {
            return;
        }
        if (!totals.valid) {
            toast({ title: 'قيمة الخصم غير صالحة؛ لا يمكن تعليق الطلب.', variant: 'error' });
            return;
        }
        setBusy(true);
        try {
            await holdPosOrder({
                sessionId: shift.sessionId,
                departmentId: shift.departmentId,
                items: cart.map((row) => ({
                    product_id: Number(row.id),
                    quantity: row.quantity,
                    unit_price: row.price,
                    discount: 0,
                })),
                cartDiscount: discount.type ? { type: discount.type, value: parsePosMoney(discount.value) } : null,
            });
            const heldTabId = activeTab.id;
            setTabs((current) => current.map((tab) => (tab.id === heldTabId ? freshPosTab(tab) : tab)));
            toast({ title: 'تم تعليق الطلب في الخادم.', variant: 'success' });
            await queryClient.invalidateQueries({ queryKey: ['pos-held', shift.sessionId] });
        } catch (error) {
            toast({ title: `تعذّر تعليق الطلب: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setBusy(false);
        }
    }

    async function recallOrder(order: HeldOrder) {
        if (!canSell || busy || !shift) {
            return;
        }
        if (cart.length) {
            const ok = await confirm('السلة الحالية غير فارغة. استبدالها بالطلب المعلق؟', { confirmLabel: 'استبدال' });
            if (!ok) {
                return;
            }
        }
        setBusy(true);
        try {
            const result = await recallHeldOrder(order.id, shift.sessionId);
            if (!result.items.length) {
                throw new Error('الطلب المحفوظ لا يحتوي أصنافًا صالحة');
            }
            const recalledTabId = activeTab.id;
            const recalledCart = result.items.map((item) => ({
                id: String(item.product_id),
                name: String(item.name ?? 'صنف'),
                price: item.unit_price,
                vatRate: item.vat_rate,
                quantity: item.quantity,
            }));
            const recalledDiscount =
                result.cart_discount && (result.cart_discount.type === 'percent' || result.cart_discount.type === 'fixed')
                    ? { type: result.cart_discount.type, value: String(result.cart_discount.value ?? '0') }
                    : EMPTY_DISCOUNT;
            setTabs((current) =>
                current.map((tab) =>
                    tab.id === recalledTabId ? { ...freshPosTab(tab), cart: recalledCart, discount: recalledDiscount } : tab,
                ),
            );
            toast({ title: 'تم استرجاع الطلب المعلق.', variant: 'success' });
            await queryClient.invalidateQueries({ queryKey: ['pos-held', shift.sessionId] });
        } catch (error) {
            toast({ title: `تعذّر استرجاع الطلب: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setBusy(false);
        }
    }

    async function removeHeldOrder(order: HeldOrder) {
        if (!canSell || busy || !shift) {
            return;
        }
        const ok = await confirm('حذف الطلب المعلق نهائيًا؟', { tone: 'danger', confirmLabel: 'حذف' });
        if (!ok) {
            return;
        }
        setBusy(true);
        try {
            await deleteHeldOrder(order.id, shift.sessionId);
            toast({ title: 'تم حذف الطلب المعلق.', variant: 'success' });
            await queryClient.invalidateQueries({ queryKey: ['pos-held', shift.sessionId] });
        } catch (error) {
            toast({ title: `تعذّر حذف الطلب: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setBusy(false);
        }
    }

    async function uploadImage(item: CatalogItem, file: File) {
        if (!canManageCatalog || busy || imagePending) {
            return;
        }
        setImagePending(true);
        try {
            const result = await uploadPosProductImage(item.id, file);
            if (!result.image_url) {
                throw new Error('لم يرجع الخادم رابط الصورة بعد الحفظ');
            }
            toast({ title: 'تم حفظ الصورة؛ ستظهر لكل الكاشيريات بعد تحديث الأصناف.', variant: 'success' });
            await queryClient.invalidateQueries({ queryKey: ['pos-products'] });
        } catch (error) {
            toast({ title: `تعذّر رفع صورة الصنف: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setImagePending(false);
        }
    }

    async function removeImage(item: CatalogItem) {
        if (!canManageCatalog || busy || imagePending || item.isBuffet || !item.hasImage) {
            return;
        }
        setImagePending(true);
        try {
            const ok = await confirm(`حذف صورة ${item.name}؟ يبقى الصنف متاحًا للبيع.`, {
                tone: 'danger',
                confirmLabel: 'حذف الصورة',
            });
            if (!ok) return;
            await removePosProductImage(item.id);
            toast({ title: 'تم حذف صورة الصنف.', variant: 'success' });
            await queryClient.invalidateQueries({ queryKey: ['pos-products'] });
        } catch (error) {
            toast({ title: `تعذّر حذف صورة الصنف: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setImagePending(false);
        }
    }

    async function reprint(orderId: string) {
        if (!canSell || busy) {
            return;
        }
        setBusy(true);
        try {
            const result = await reprintPosOrder(orderId);
            toast({ title: result.message || 'أُضيفت الفاتورة إلى طابور الطباعة.', variant: 'success' });
        } catch (error) {
            toast({ title: `تعذرت إعادة الطباعة: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setBusy(false);
        }
    }

    async function openKot(orderId: string, counter: number | null) {
        if (busy) {
            return;
        }
        setBusy(true);
        try {
            const html = await fetchKotHtml(orderId);
            const opened = openServerHtmlWindow(html, `تذاكر المطبخ${counter ? ` — فاتورة #${String(counter)}` : ''}`);
            if (!opened) {
                toast({ title: 'حجب المتصفح نافذة تذاكر المطبخ؛ اسمح بالنوافذ المنبثقة.', variant: 'error' });
            }
        } catch (error) {
            toast({ title: `تعذّر فتح تذاكر المطبخ: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setBusy(false);
        }
    }

    async function submitCloseShift() {
        if (!shift || busy) {
            return;
        }
        const cash = parsePosMoney(actualCash);
        if (!Number.isFinite(cash) || cash < 0) {
            setCloseError('النقد الفعلي غير صالح؛ بقيت الوردية مفتوحة.');
            return;
        }
        const ok = await confirm('سيغلق الخادم الوردية نهائيًا. هل تؤكد الإغلاق؟', {
            tone: 'warning',
            confirmLabel: 'إغلاق الوردية',
        });
        if (!ok) {
            return;
        }
        setCloseError('');
        setBusy(true);
        try {
            const result = await closePosShift(shift.sessionId, cash, closeNotes);
            setCloseOpen(false);
            setActualCash('');
            setCloseNotes('');
            const tab = newPosTab();
            setTabs([tab]);
            setActiveTabId(tab.id);
            setView('cashier');
            toast({ title: `أُغلقت الوردية. فرق النقد: ${moneyText(result.cash_variance)}.`, variant: 'success' });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['pos-active-shift'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-buffet-config'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-held'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-buffet-live'] }),
            ]);
        } catch (error) {
            setCloseError(`تعذّر إغلاق الوردية: ${errorMessage(error)}`);
        } finally {
            setBusy(false);
        }
    }

    async function runDayClose() {
        if (!canDayClose || dayCloseBusy) {
            return;
        }
        setDayCloseBusy(true);
        try {
            const status = await fetchDayCloseStatus();
            if (status.existing_z) {
                toast({
                    title: `اليوم مقفل مسبقًا برقم ${openShiftInfo(status.existing_z)}.`,
                    variant: 'info',
                });
                return;
            }
            const openCount = (status.open ?? []).length;
            if (openCount) {
                toast({
                    title: `أغلق ${intOf(openCount)} وردية مفتوحة أولًا من سجل الورديات، ثم أعد المحاولة.`,
                    variant: 'error',
                });
                return;
            }
            const day = String(status.today ?? riyadhToday());
            const ok = await confirm(`تنفيذ الإقفال اليومي Z ليوم ${day}؟ سيُقفل اليوم ويُرحّل الفرق للدفتر.`, {
                tone: 'warning',
                confirmLabel: 'تنفيذ الإقفال',
            });
            if (!ok) {
                return;
            }
            const result = await execDayClose(day);
            toast({
                title: `تم الإقفال ${result.z?.z_number ?? ''} — الفرق ${moneyText(result.z?.total_variance ?? 0)}.`,
                variant: 'success',
            });
        } catch (error) {
            toast({ title: `تعذّر تنفيذ الإقفال اليومي: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setDayCloseBusy(false);
        }
    }

    function openVoidDialog(detail: PosOrderDetail) {
        setVoidTarget(detail);
        setVoidReason('');
        setVoidError('');
    }

    async function submitVoid() {
        if (!voidTarget || busy) {
            return;
        }
        const reason = voidReason.trim();
        if (!reason || reason.length > 500) {
            setVoidError('سبب الإلغاء مطلوب وبحد أقصى 500 حرف.');
            return;
        }
        setBusy(true);
        try {
            const result = await voidPosOrder(voidTarget.id, reason);
            toast({ title: result.message || 'تم إلغاء الفاتورة.', variant: 'success' });
            const orderId = voidTarget.id;
            setVoidTarget(null);
            setVoidReason('');
            setVoidError('');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['pos-order', orderId] }),
                queryClient.invalidateQueries({ queryKey: ['pos-orders'] }),
            ]);
        } catch (error) {
            setVoidError(`تعذّر إلغاء الفاتورة: ${errorMessage(error)}`);
        } finally {
            setBusy(false);
        }
    }

    async function printHistory() {
        if (printingHistory) {
            return;
        }
        setPrintingHistory(true);
        try {
            const result = await fetchPosOrdersExport({
                ...(historyFilters.dateFrom ? { dateFrom: historyFilters.dateFrom } : {}),
                ...(historyFilters.dateTo ? { dateTo: historyFilters.dateTo } : {}),
                status: historyFilters.status,
                search: historyFilters.search,
            });
            const rows = result.data.map((row) => ({
                invoice_counter: row.invoice_counter,
                department_name: row.department_name ?? null,
                created_at: row.created_at ?? null,
                cashier_name: row.cashier_name ?? null,
                item_count: row.item_count,
                total_amount: row.total_amount,
                status: row.status ?? null,
            }));
            const opened = openPrintWindow('سجل فواتير الكاشير', ordersPrintHtml(rows));
            if (!opened) {
                toast({ title: 'حجب المتصفح نافذة الطباعة؛ اسمح بالنوافذ المنبثقة.', variant: 'error' });
                return;
            }
            toast({ title: `أُرسل ${intOf(result.data.length)} فاتورة إلى الطباعة.`, variant: 'success' });
        } catch (error) {
            toast({ title: `تعذّر تصدير الفواتير: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setPrintingHistory(false);
        }
    }

    async function saveBuffet(prices: Record<string, number>, renames: Array<{ id: string; name: string }>) {
        if (!canManageBuffet || buffetBusy) {
            return;
        }
        setBuffetBusy(true);
        try {
            await saveBuffetPrices(prices);
            for (const rename of renames) {
                await renameBuffetTier(rename.id, rename.name);
            }
            await queryClient.invalidateQueries({ queryKey: ['pos-buffet-config'] });
            toast({ title: 'تم حفظ قائمة الأسعار؛ الفواتير الجديدة فقط تتأثر.', variant: 'success' });
        } catch (error) {
            toast({ title: `تعذّر حفظ الأسعار: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setBuffetBusy(false);
        }
    }

    async function addTier(name: string, price: number) {
        if (!canManageBuffet || buffetBusy) {
            return;
        }
        setBuffetBusy(true);
        try {
            await addBuffetTier(name, price);
            await queryClient.invalidateQueries({ queryKey: ['pos-buffet-config'] });
            toast({ title: 'تمت إضافة الفئة إلى قائمة أسعار البوفيه.', variant: 'success' });
        } catch (error) {
            toast({ title: `تعذّر إضافة الفئة: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setBuffetBusy(false);
        }
    }

    async function toggleTier(tier: BuffetTier) {
        if (!canManageBuffet || buffetBusy) {
            return;
        }
        const active = tier.is_active !== false;
        if (active) {
            const ok = await confirm('تعطيل هذه الفئة؟ تبقى فواتيرها السابقة محفوظة ويمكن تفعيلها لاحقًا.', {
                tone: 'warning',
                confirmLabel: 'تعطيل',
            });
            if (!ok) {
                return;
            }
        }
        setBuffetBusy(true);
        try {
            if (active) {
                await disableBuffetTier(tier.id);
            } else {
                await setBuffetTierActive(tier.id, true);
            }
            await queryClient.invalidateQueries({ queryKey: ['pos-buffet-config'] });
            toast({
                title: active ? 'تم تعطيل الفئة — سجل مبيعاتها محفوظ.' : 'تم تفعيل الفئة.',
                variant: 'success',
            });
        } catch (error) {
            toast({ title: `تعذّر تحديث الفئة: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setBuffetBusy(false);
        }
    }

    async function refreshAll() {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['pos-active-shift'] }),
            queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
            queryClient.invalidateQueries({ queryKey: ['pos-buffet-config'] }),
            queryClient.invalidateQueries({ queryKey: ['pos-held'] }),
            queryClient.invalidateQueries({ queryKey: ['pos-buffet-live'] }),
        ]);
        toast({ title: 'حُدّثت بيانات الكاشير من الخادم.', variant: 'info' });
    }

    function addTab() {
        if (tabs.length >= MAX_TABS) {
            toast({ title: `الحد الأقصى ${String(MAX_TABS)} طلبات متوازية.`, variant: 'info' });
            return;
        }
        const tab = newPosTab();
        setTabs((current) => [...current, tab]);
        setActiveTabId(tab.id);
    }

    async function closeTab(id: string) {
        if (tabs.length <= 1) {
            return;
        }
        const index = tabs.findIndex((tab) => tab.id === id);
        const target = index >= 0 ? tabs[index] : undefined;
        if (!target) {
            return;
        }
        if (target.cart.length) {
            const ok = await confirm(`إغلاق طلب ${String(index + 1)} وفيه ${String(target.cart.length)} سطرًا دون بيع؟`, {
                tone: 'warning',
                confirmLabel: 'إغلاق الطلب',
            });
            if (!ok) {
                return;
            }
        }
        setTabs((current) => {
            const next = current.filter((tab) => tab.id !== id);
            return next.length ? next : [newPosTab()];
        });
        if (activeTab.id === id) {
            const neighbor = tabs[index + 1] ?? tabs[index - 1] ?? tabs[0] ?? FALLBACK_TAB;
            setActiveTabId(neighbor.id);
        }
    }

    async function openDrawer() {
        if (!canSell || busy || !shift) {
            return;
        }
        setBusy(true);
        try {
            const ack = await openPosDrawer(shift.sessionId);
            toast({ title: `فُتح درج النقدية عبر الطابعة ${ack.printerId}.`, variant: 'success' });
        } catch (error) {
            toast({ title: `تعذّر فتح الدرج: ${errorMessage(error)}`, variant: 'error' });
        } finally {
            setBusy(false);
        }
    }

    const shortcutActions = useRef({ hold: () => {}, complete: () => {} });
    shortcutActions.current = {
        hold: () => {
            void holdOrder();
        },
        complete: () => {
            void completeSale();
        },
    };

    const overlayOpen = view !== 'cashier';

    useEffect(() => {
        if (!overlayOpen) {
            return;
        }
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== 'Escape') {
                return;
            }
            const dialogOpen = [...document.querySelectorAll('[role="dialog"]:not([data-pos-overlay])')].some(
                (node) => (node as HTMLElement).getClientRects().length > 0,
            );
            if (dialogOpen) {
                return;
            }
            setView(view === 'order-detail' ? 'history' : 'cashier');
        }
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [overlayOpen, view]);

    useEffect(() => {
        if (view !== 'cashier' || !shift) {
            return;
        }
        function onKeyDown(event: KeyboardEvent) {
            if (event.altKey || event.metaKey) {
                return;
            }
            // نافذة تأكيد ظاهرة فقط تعطّل الاختصارات؛ درج القائمة المخفي يبقى في DOM.
            const dialogOpen = [...document.querySelectorAll('[role="dialog"]')].some(
                (node) => (node as HTMLElement).getClientRects().length > 0,
            );
            if (dialogOpen) {
                return;
            }
            if (event.ctrlKey) {
                if (/^[1-5]$/.test(event.key)) {
                    const target = tabs[Number(event.key) - 1];
                    if (target) {
                        event.preventDefault();
                        setActiveTabId(target.id);
                    }
                }
                return;
            }
            switch (event.key) {
                case 'F2':
                    event.preventDefault();
                    searchInputRef.current?.focus();
                    searchInputRef.current?.select();
                    break;
                case 'F3':
                    event.preventDefault();
                    shortcutActions.current.hold();
                    break;
                case 'F4':
                case 'F5':
                    event.preventDefault();
                    shortcutActions.current.complete();
                    break;
                case 'F6':
                case 'F9':
                    if (canHistory) {
                        event.preventDefault();
                        setView('history');
                    }
                    break;
                default:
                    break;
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [view, shift, tabs, canHistory]);

    const overlayTitle =
        view === 'history'
            ? 'سجل فواتير الكاشير'
            : view === 'order-detail'
              ? 'تفاصيل الفاتورة'
              : view === 'buffet-prices'
                ? 'أسعار البوفيه'
                : 'تقرير البوفيه';

    if (!canAccess) {
        return (
            <div className="flex flex-col gap-md premium-screen pos-entry">
                <PageHeader title="الكاشير" english="POS" description="نقطة البيع — القرار النهائي للخادم." />
                <p className="erp-card erp-card__body text-body-sm text-muted">
                    مدخل الكاشير متاح للأدوار المخوّلة فقط — القرار النهائي للخادم.
                </p>
            </div>
        );
    }

    const departments = (departmentsQuery.data ?? []).filter((department) => department.is_active !== false);
    const catalogLoading = buffet ? buffetConfigQuery.isPending : productsQuery.isPending;
    const catalogError = buffet ? buffetConfigQuery.error : productsQuery.error;
    const catalogRetry = () => {
        if (buffet) {
            void buffetConfigQuery.refetch();
        } else {
            void productsQuery.refetch();
        }
    };

    const activeOrderNumber = tabs.findIndex((tab) => tab.id === activeTab.id) + 1;
    const heldCount = heldQuery.data?.length ?? 0;
    const closeMenu = () => {
        if (menuRef.current) {
            menuRef.current.open = false;
        }
    };

    return (
        <div className={`flex flex-col premium-screen pos-entry pos-entry--workspace pos-entry--pane-${mobilePane}`}>
            <h1 className="sr-only">الكاشير — نقطة البيع</h1>
            {shift ? (
                <section className="pos-cmdbar" aria-label="شريط الكاشير">
                    <div className="pos-cmdbar__identity">
                        <span
                            className={`pos-cmdbar__status${shift.isStale ? ' is-warn' : ''}`}
                            aria-hidden="true"
                            title={shift.isStale ? 'وردية يوم سابق — غير صالحة للبيع' : 'وردية مفتوحة'}
                        />
                        <div className="pos-cmdbar__copy">
                            <strong>{shift.deptName || 'نقطة البيع'}</strong>
                            <small>
                                <span className="pos-cmdbar__shift">وردية #{shift.sessionId}</span>
                                {buffet ? (
                                    <span className="pos-cmdbar__tag" title="قسم البوفيه المفتوح">
                                        بوفيه
                                    </span>
                                ) : null}
                                {shift.isStale ? <span className="pos-cmdbar__tag pos-cmdbar__tag--warn">يوم {shift.openedOn}</span> : null}
                            </small>
                        </div>
                    </div>

                    <div className="pos-cmdbar__center">
                        {view === 'cashier' && !shift.isStale ? (
                            <div className="pos-tabs" role="tablist" aria-label="الطلبات المتوازية">
                                {tabs.map((tab, index) => {
                                    const count = tab.cart.reduce((sum, row) => sum + row.quantity, 0);
                                    const selected = tab.id === activeTab.id;
                                    return (
                                        <div key={tab.id} className={`pos-tab${selected ? ' is-active' : ''}`}>
                                            <button
                                                type="button"
                                                role="tab"
                                                aria-selected={selected}
                                                aria-label={`طلب ${String(index + 1)}${count ? ` — ${String(count)} قطعة` : ''}`}
                                                onClick={() => {
                                                    setActiveTabId(tab.id);
                                                }}
                                            >
                                                طلب {index + 1}
                                                <span className="pos-tab__count">{intOf(count)}</span>
                                            </button>
                                            {tabs.length > 1 ? (
                                                <button
                                                    type="button"
                                                    className="pos-tab__close"
                                                    aria-label={`إغلاق طلب ${String(index + 1)}`}
                                                    onClick={() => {
                                                        void closeTab(tab.id);
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            ) : null}
                                        </div>
                                    );
                                })}
                                <button type="button" className="pos-tab-new" disabled={tabs.length >= MAX_TABS || busy} onClick={addTab}>
                                    + طلب جديد
                                </button>
                                <span className="pos-tabs__held" title="طلبات معلقة في الخادم">
                                    معلقة
                                    <strong className="erp-numeric">{intOf(heldCount)}</strong>
                                </span>
                                <span className="pos-tabs__hint" aria-hidden="true">
                                    F2 بحث · F3 تعليق · F4 إتمام · F9 السجل
                                </span>
                            </div>
                        ) : null}
                    </div>

                    <div className="pos-cmdbar__end">
                        <button
                            type="button"
                            className="pos-icon-btn"
                            aria-label="فتح الدرج"
                            title="فتح الدرج النقدي"
                            disabled={!canSell || busy}
                            onClick={() => {
                                void openDrawer();
                            }}
                        >
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                width="18"
                                height="18"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M3 10h18M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M4 10h16v9H4z" />
                                <path d="M9 15h6" />
                            </svg>
                        </button>
                        <details ref={menuRef} className="pos-menu">
                            <summary className="pos-menu__trigger">
                                إدارة الوردية
                                <svg
                                    aria-hidden="true"
                                    viewBox="0 0 24 24"
                                    width="14"
                                    height="14"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="m6 9 6 6 6-6" />
                                </svg>
                            </summary>
                            <div className="pos-menu__panel">
                                {canHistory ? (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                            setView('history');
                                            closeMenu();
                                        }}
                                    >
                                        سجل الفواتير
                                    </Button>
                                ) : null}
                                {buffet && canManageBuffet ? (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                            setView('buffet-prices');
                                            closeMenu();
                                        }}
                                    >
                                        أسعار البوفيه
                                    </Button>
                                ) : null}
                                {buffet ? (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                            setView('buffet-report');
                                            closeMenu();
                                        }}
                                    >
                                        تقرير البوفيه
                                    </Button>
                                ) : null}
                                {canManageCatalog ? (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                            setPrintersOpen(true);
                                            closeMenu();
                                        }}
                                    >
                                        الطابعة
                                    </Button>
                                ) : null}
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        void refreshAll();
                                        closeMenu();
                                    }}
                                >
                                    تحديث البيانات
                                </Button>
                                {canDayClose ? (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                            void runDayClose();
                                            closeMenu();
                                        }}
                                        disabled={dayCloseBusy}
                                    >
                                        إقفال اليوم Z
                                    </Button>
                                ) : null}
                                <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={() => {
                                        openCloseShiftDialog();
                                        closeMenu();
                                    }}
                                    disabled={!canSell || busy}
                                >
                                    إغلاق الوردية
                                </Button>
                            </div>
                        </details>
                    </div>
                </section>
            ) : null}

            {shift && unbalancedInvoice ? (
                <p className="pos-alert" role="alert">
                    الفاتورة غير متوازنة (الصافي + الضريبة ≠ الإجمالي) — لا يمكن إصدارها أو طباعتها حتى تصحيح بيانات الأصناف.
                </p>
            ) : null}

            {view === 'cashier' ? (
                <>
                    {shiftQuery.isPending ? <StateLoading label="جارٍ قراءة الوردية والأصناف…" /> : null}
                    {shiftQuery.isError ? (
                        <StateError
                            message={errorMessage(shiftQuery.error)}
                            onRetry={() => {
                                void shiftQuery.refetch();
                            }}
                        />
                    ) : null}

                    {!shiftQuery.isPending && !shiftQuery.isError && !shift ? (
                        <div className="pos-open__wrap">
                            <PosOpenShift
                                departments={departments}
                                canSell={canSell}
                                busy={busy}
                                error={openError || (departmentsQuery.isError ? errorMessage(departmentsQuery.error) : '')}
                                loading={departmentsQuery.isPending}
                                onOpen={(departmentId, openingBalance) => {
                                    void handleOpenShift(departmentId, openingBalance);
                                }}
                            />
                        </div>
                    ) : null}

                    {shift?.isStale ? (
                        <div className="pos-open__wrap">
                            <section className="erp-card pos-open" aria-labelledby="pos-stale-title">
                                <div className="erp-card__body flex flex-col gap-sm">
                                    <div>
                                        <h2 id="pos-stale-title" className="erp-card__title">
                                            وردية يوم سابق ما زالت مفتوحة
                                        </h2>
                                        <p className="text-body-sm text-muted">
                                            وردية #{shift.sessionId} فُتحت في {shift.openedOn}، والخادم يرفض البيع عليها في يوم جديد. أغلقها
                                            أولًا (بعد عدّ النقد الفعلي) ثم افتح وردية اليوم.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-sm">
                                        <Button variant="danger" onClick={openCloseShiftDialog} disabled={!canSell || busy}>
                                            إغلاق وردية الأمس
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            onClick={() => {
                                                void shiftQuery.refetch();
                                            }}
                                        >
                                            تحديث
                                        </Button>
                                        {!canSell ? (
                                            <p className="text-body-sm text-muted">
                                                هذا الحساب للقراءة فقط ولا يمكنه إغلاق الوردية أو البيع.
                                            </p>
                                        ) : null}
                                    </div>
                                </div>
                            </section>
                        </div>
                    ) : shift ? (
                        catalogLoading ? (
                            <StateLoading label={buffet ? 'جارٍ تحميل فئات البوفيه…' : 'جارٍ تحميل أصناف الوصفات…'} />
                        ) : catalogError ? (
                            <StateError message={errorMessage(catalogError)} onRetry={catalogRetry} />
                        ) : (
                            <>
                                <div ref={paneSwitchRef} className="pos-pane-switch" role="tablist" aria-label="عرض شاشة الكاشير">
                                    <button
                                        type="button"
                                        role="tab"
                                        className={`pos-pane-switch__btn${mobilePane === 'catalog' ? ' is-active' : ''}`}
                                        aria-selected={mobilePane === 'catalog'}
                                        onClick={() => {
                                            setMobilePane('catalog');
                                        }}
                                    >
                                        الأصناف
                                    </button>
                                    <button
                                        type="button"
                                        role="tab"
                                        className={`pos-pane-switch__btn${mobilePane === 'cart' ? ' is-active' : ''}`}
                                        aria-selected={mobilePane === 'cart'}
                                        onClick={() => {
                                            setMobilePane('cart');
                                        }}
                                    >
                                        السلة
                                        <Badge variant={cartCount ? 'info' : 'neutral'}>{intOf(cartCount)}</Badge>
                                    </button>
                                </div>
                                <div className="pos-pane-dock">
                                    <button
                                        type="button"
                                        className="pos-pane-dock__btn"
                                        aria-label={`عرض السلة — ${intOf(cartCount)} قطعة، الإجمالي ${moneyText(totals.total)}`}
                                        onClick={() => {
                                            setMobilePane('cart');
                                        }}
                                    >
                                        <span className="pos-pane-dock__count">السلة · {intOf(cartCount)}</span>
                                        <strong className="pos-pane-dock__total erp-numeric" dir="ltr">
                                            {moneyText(totals.total)}
                                        </strong>
                                        <span className="pos-pane-dock__cta">عرض السلة</span>
                                    </button>
                                </div>
                                <div className="pos-entry__layout">
                                    <PosCatalog
                                        buffet={buffet}
                                        items={items}
                                        heldOrders={heldQuery.data ?? EMPTY_HELD_ORDERS}
                                        heldError={heldQuery.isError ? errorMessage(heldQuery.error) : ''}
                                        buffetLive={buffetLiveQuery.data ?? null}
                                        sales={salesRankQuery.data ?? EMPTY_SALES_INDEX}
                                        query={query}
                                        onQuery={setQuery}
                                        selectedCategory={selectedCategory}
                                        onCategory={setSelectedCategory}
                                        onAdd={handleAddItem}
                                        onBarcodeEnter={handleBarcodeEnter}
                                        searchInputRef={searchInputRef}
                                        favorites={favorites}
                                        onToggleFavorite={handleToggleFavorite}
                                        canSell={canSell}
                                        canManageCatalog={canManageCatalog}
                                        imagePending={imagePending}
                                        onUploadImage={handleUploadImage}
                                        onRemoveImage={handleRemoveImage}
                                        onRecall={handleRecallOrder}
                                        onDeleteHeld={handleDeleteHeld}
                                        busy={busy || buffetBusy || dayCloseBusy}
                                    />
                                    <div className="pos-entry__side">
                                        <PosCart
                                            cart={cart}
                                            images={itemImages}
                                            orderNumber={activeOrderNumber}
                                            totals={totals}
                                            discount={discount}
                                            onDiscount={setDiscountValue}
                                            payments={payments}
                                            paymentsTouched={paymentsTouched}
                                            onPayment={setPayment}
                                            references={references}
                                            onReference={setReference}
                                            cardMeta={cardMeta}
                                            onCardMeta={setCardMeta}
                                            canSell={canSell}
                                            busy={busy}
                                            buffet={buffet}
                                            onQty={changeQuantity}
                                            onClear={() => {
                                                resetSale();
                                            }}
                                            onHold={() => {
                                                void holdOrder();
                                            }}
                                            onComplete={() => {
                                                void completeSale();
                                            }}
                                        />
                                        {receipt ? (
                                            <PosReceipt
                                                receipt={receipt}
                                                buffet={buffet}
                                                canReprint={canSell}
                                                busy={busy}
                                                onReprint={(orderId) => {
                                                    void reprint(orderId);
                                                }}
                                                onKot={(orderId, counter) => {
                                                    void openKot(orderId, counter);
                                                }}
                                                onDismiss={() => {
                                                    updateActiveTab((tab) => ({ ...tab, receipt: null }));
                                                }}
                                            />
                                        ) : null}
                                    </div>
                                </div>
                            </>
                        )
                    ) : null}
                </>
            ) : null}

            {overlayOpen ? (
                <div className="pos-overlay" role="dialog" aria-modal="true" aria-label={overlayTitle} data-pos-overlay="true">
                    <div className="pos-overlay__panel">
                        <div className="pos-overlay__bar">
                            <strong className="pos-overlay__title">{overlayTitle}</strong>
                            <Button size="sm" variant="secondary" onClick={() => setView('cashier')}>
                                إغلاق
                            </Button>
                        </div>
                        <div className="pos-overlay__body">
                            {view === 'history' && canHistory ? (
                                <PosHistory
                                    filters={historyFilters}
                                    onApply={(next) => {
                                        setHistoryFilters(next);
                                        setHistoryPage(1);
                                    }}
                                    result={historyQuery.data}
                                    loading={historyQuery.isPending || historyQuery.isFetching}
                                    error={historyQuery.isError ? errorMessage(historyQuery.error) : ''}
                                    printing={printingHistory}
                                    onPage={setHistoryPage}
                                    onRetry={() => {
                                        void historyQuery.refetch();
                                    }}
                                    onBack={() => {
                                        setView('cashier');
                                    }}
                                    onDetail={(orderId) => {
                                        setSelectedOrderId(orderId);
                                        setView('order-detail');
                                    }}
                                    onPrint={() => {
                                        void printHistory();
                                    }}
                                />
                            ) : null}

                            {view === 'order-detail' ? (
                                <PosOrderDetailPanel
                                    detail={detailQuery.data}
                                    loading={detailQuery.isPending}
                                    error={detailQuery.isError ? errorMessage(detailQuery.error) : ''}
                                    canVoid={canVoid}
                                    canReprint={canSell}
                                    busy={busy}
                                    onBack={() => {
                                        setView('history');
                                    }}
                                    onRetry={() => {
                                        void detailQuery.refetch();
                                    }}
                                    onVoid={openVoidDialog}
                                    onReprint={(orderId) => {
                                        void reprint(orderId);
                                    }}
                                    onKot={(orderId, counter) => {
                                        void openKot(orderId, counter);
                                    }}
                                />
                            ) : null}

                            {view === 'buffet-prices' && buffet ? (
                                <PosBuffetPrices
                                    tiers={buffetConfigQuery.data?.tiers ?? []}
                                    canManage={canManageBuffet}
                                    busy={buffetBusy}
                                    onBack={() => {
                                        setView('cashier');
                                    }}
                                    onSave={(prices, renames) => {
                                        void saveBuffet(prices, renames);
                                    }}
                                    onAdd={(name, price) => {
                                        void addTier(name, price);
                                    }}
                                    onToggle={(tier) => {
                                        void toggleTier(tier);
                                    }}
                                />
                            ) : null}

                            {view === 'buffet-report' && buffet ? (
                                <PosBuffetReport
                                    date={reportDate}
                                    onDate={setReportDate}
                                    report={reportQuery.data}
                                    invoices={reportInvoicesQuery.data?.data ?? []}
                                    loading={reportQuery.isPending || reportInvoicesQuery.isPending}
                                    error={
                                        reportQuery.isError
                                            ? errorMessage(reportQuery.error)
                                            : reportInvoicesQuery.isError
                                              ? errorMessage(reportInvoicesQuery.error)
                                              : ''
                                    }
                                    onRetry={() => {
                                        void reportQuery.refetch();
                                        void reportInvoicesQuery.refetch();
                                    }}
                                    onBack={() => {
                                        setView('cashier');
                                    }}
                                />
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}

            <Dialog
                open={closeOpen}
                onOpenChange={(open) => {
                    setCloseOpen(open);
                    if (!open) {
                        setActualCash('');
                        setCloseNotes('');
                        setCloseError('');
                    }
                }}
                title="إغلاق الوردية"
                description="النقد المتوقع من الخادم = العهدة + داخل نقدي − خارج نقدي."
                size="sm"
                footer={
                    <>
                        <Button size="sm" variant="secondary" onClick={() => setCloseOpen(false)}>
                            إلغاء
                        </Button>
                        <Button
                            size="sm"
                            variant="danger"
                            loading={busy}
                            disabled={!summaryQuery.data || summaryQuery.isError}
                            onClick={() => {
                                void submitCloseShift();
                            }}
                        >
                            إغلاق الوردية
                        </Button>
                    </>
                }
            >
                <div className="erp-stack">
                    {summaryQuery.isPending ? <StateLoading label="جارٍ قراءة ملخص الوردية…" /> : null}
                    {summaryQuery.isError ? (
                        <StateError
                            message={errorMessage(summaryQuery.error)}
                            onRetry={() => {
                                void summaryQuery.refetch();
                            }}
                        />
                    ) : null}
                    {summaryQuery.data ? (
                        <dl className="pos-totals">
                            <div>
                                <dt>العهدة الافتتاحية</dt>
                                <dd>{moneyText(summaryQuery.data.opening_balance)}</dd>
                            </div>
                            <div>
                                <dt>داخل نقدي</dt>
                                <dd>{moneyText(summaryQuery.data.cash_in)}</dd>
                            </div>
                            <div>
                                <dt>خارج نقدي</dt>
                                <dd>{moneyText(summaryQuery.data.cash_out)}</dd>
                            </div>
                            <div>
                                <dt>الفواتير</dt>
                                <dd>{intOf(summaryQuery.data.invoice_count)}</dd>
                            </div>
                            <div>
                                <dt>ملغاة</dt>
                                <dd>{`${intOf(summaryQuery.data.voided_count)} · ${moneyText(summaryQuery.data.voided_amount)}`}</dd>
                            </div>
                            <div className="pos-totals__grand">
                                <dt>النقد المتوقع</dt>
                                <dd>{moneyText(expectedCash(summaryQuery.data))}</dd>
                            </div>
                        </dl>
                    ) : null}
                    <Input
                        label="النقد الفعلي"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        dir="ltr"
                        value={actualCash}
                        disabled={!summaryQuery.data || busy}
                        onChange={(event) => {
                            setActualCash(event.target.value);
                        }}
                    />
                    <Textarea
                        label="ملاحظات الإغلاق (اختياري)"
                        rows={2}
                        maxLength={500}
                        value={closeNotes}
                        onChange={(event) => {
                            setCloseNotes(event.target.value);
                        }}
                    />
                    {closeError ? (
                        <p className="text-body-sm text-danger" role="alert">
                            {closeError}
                        </p>
                    ) : null}
                </div>
            </Dialog>

            <Dialog
                open={voidTarget !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setVoidTarget(null);
                        setVoidReason('');
                        setVoidError('');
                    }
                }}
                title="إلغاء الفاتورة"
                description="سيؤدي ذلك إلى إلغاء الفاتورة وعكس المخزون والإيراد ورد المبلغ وفق بياناتها."
                size="sm"
                footer={
                    <>
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                setVoidTarget(null);
                                setVoidReason('');
                                setVoidError('');
                            }}
                        >
                            تراجع
                        </Button>
                        <Button
                            size="sm"
                            variant="danger"
                            loading={busy}
                            disabled={!voidReason.trim()}
                            onClick={() => {
                                void submitVoid();
                            }}
                        >
                            تأكيد الإلغاء
                        </Button>
                    </>
                }
            >
                <div className="erp-stack">
                    <p className="text-body-sm text-muted">
                        {voidTarget
                            ? `الفاتورة #${String(voidTarget.invoice_counter ?? voidTarget.id)} — ${moneyText(voidTarget.total_amount)}`
                            : ''}
                    </p>
                    <Textarea
                        label="سبب الإلغاء (مطلوب)"
                        rows={3}
                        maxLength={500}
                        value={voidReason}
                        onChange={(event) => {
                            setVoidReason(event.target.value);
                        }}
                    />
                    {voidError ? (
                        <p className="text-body-sm text-danger" role="alert">
                            {voidError}
                        </p>
                    ) : null}
                </div>
            </Dialog>

            <PosPrinters open={printersOpen} departmentId={shift?.departmentId ?? ''} onClose={() => setPrintersOpen(false)} />
        </div>
    );
}
