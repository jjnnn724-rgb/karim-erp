import './PosEntry.premium.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { StateError, StateLoading } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import {
    addBuffetTier,
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
    fetchSalesQuantities,
    fetchShiftSummary,
    holdPosOrder,
    isBuffetDepartment,
    openPosDrawer,
    openPosShift,
    recallHeldOrder,
    renameBuffetTier,
    reprintPosOrder,
    riyadhToday,
    saveBuffetPrices,
    setBuffetTierActive,
    uploadPosProductImage,
    voidPosOrder,
    type BuffetTier,
    type HeldOrder,
    type PosOrderDetail,
    type PosPaymentInput,
    type PosSaleResult,
} from '../lib/pos';
import {
    buildPosSaleItems,
    calculatePosTotals,
    matchPosBarcode,
    parsePosMoney,
    type PosCartLine,
    type PosDiscount,
} from '../lib/pos-pricing';
import { errorMessage, intOf } from '../lib/reporting';
import { Badge, Button, Dialog, Input, PageHeader, Textarea, useToast } from '../ui';
import { PosBuffetPrices, PosBuffetReport } from './pos/PosBuffet';
import { PosCart, type PaymentReferenceKey } from './pos/PosCart';
import { PosCatalog } from './pos/PosCatalog';
import { PosHistory, PosOrderDetailPanel, type PosHistoryFiltersState } from './pos/PosHistory';
import { PosOpenShift } from './pos/PosOpenShift';
import { PosReceipt } from './pos/PosReceipt';
import {
    catalogFromProducts,
    catalogFromTiers,
    moneyText,
    newIdempotencyKey,
    openPrintWindow,
    openServerHtmlWindow,
    ordersPrintHtml,
    PAYMENT_FIELDS,
    POS_FAVORITES_LIMIT,
    POS_ROLES,
    readPosFavorites,
    roleIn,
    writePosFavorites,
    SELL_ROLES,
    HISTORY_ROLES,
    VOID_ROLES,
    CATALOG_IMAGE_ROLES,
    DAY_CLOSE_ROLES,
    BUFFET_ADMIN_ROLES,
    type CatalogItem,
    type PaymentKey,
} from './pos/pos-ui';

type View = 'cashier' | 'history' | 'order-detail' | 'buffet-prices' | 'buffet-report';

const EMPTY_DISCOUNT: PosDiscount = { type: '', value: '0' };
const EMPTY_PAYMENTS: Record<PaymentKey, string> = { cash: '0.00', card: '0', wallet: '0', bank_transfer: '0' };
const EMPTY_REFERENCES: Record<PaymentReferenceKey, string> = { card: '', wallet: '', bank_transfer: '' };
const EMPTY_FILTERS: PosHistoryFiltersState = { dateFrom: '', dateTo: '', status: '', search: '' };
const EMPTY_SALES_INDEX: Record<string, number> = {};

const MAX_TABS = 5;
let tabSequence = 0;

/** طلب متوازٍ: سلة ودفع وإيصال ومفتاح منع تكرار مستقل لكل عميل. */
interface PosTab {
    id: string;
    cart: PosCartLine[];
    discount: PosDiscount;
    payments: Record<PaymentKey, string>;
    references: Record<PaymentReferenceKey, string>;
    paymentsTouched: boolean;
    receipt: PosSaleResult | null;
    saleKey: string;
}

function newPosTab(): PosTab {
    tabSequence += 1;
    return {
        id: `pos-tab-${String(tabSequence)}`,
        cart: [],
        discount: EMPTY_DISCOUNT,
        payments: EMPTY_PAYMENTS,
        references: EMPTY_REFERENCES,
        paymentsTouched: false,
        receipt: null,
        saleKey: '',
    };
}

function freshPosTab(tab: PosTab): PosTab {
    return {
        id: tab.id,
        cart: [],
        discount: EMPTY_DISCOUNT,
        payments: EMPTY_PAYMENTS,
        references: EMPTY_REFERENCES,
        paymentsTouched: false,
        receipt: null,
        saleKey: '',
    };
}

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
    const [mobilePane, setMobilePane] = useState<'catalog' | 'cart'>('catalog');
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]!;
    const cart = activeTab.cart;
    const discount = activeTab.discount;
    const payments = activeTab.payments;
    const references = activeTab.references;
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

    const productsQuery = useQuery({
        queryKey: ['pos-products', shift?.departmentId ?? ''],
        queryFn: ({ signal }) => fetchPosProducts(shift?.departmentId ?? '', signal),
        enabled: canAccess && Boolean(shift) && !buffet,
    });
    /* مبيعات 14 يومًا تُرتَّب بها البطاقات — فشلها لا يعطّل البيع (ترتيب أبجدي). */
    const salesRankQuery = useQuery({
        queryKey: ['pos-sales-ranking'],
        queryFn: ({ signal }) => fetchSalesQuantities(14, signal),
        enabled: canAccess && Boolean(shift) && !buffet,
        staleTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: false,
    });
    const buffetConfigQuery = useQuery({
        queryKey: ['pos-buffet-config'],
        queryFn: ({ signal }) => fetchBuffetConfig(signal),
        enabled: canAccess && Boolean(shift) && buffet,
        refetchOnWindowFocus: false,
    });
    const heldQuery = useQuery({
        queryKey: ['pos-held', shift?.sessionId ?? ''],
        queryFn: ({ signal }) => fetchHeldOrders(shift?.sessionId ?? '', signal),
        enabled: canAccess && Boolean(shift),
    });
    const buffetLiveQuery = useQuery({
        queryKey: ['pos-buffet-live', shift?.sessionId ?? ''],
        queryFn: ({ signal }) => fetchBuffetLive(riyadhToday(), shift?.sessionId ?? null, signal),
        enabled: canAccess && Boolean(shift) && buffet,
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

    const totals = useMemo(() => calculatePosTotals(cart, discount), [cart, discount]);

    useEffect(() => {
        if (activeTab.paymentsTouched) {
            return;
        }
        const tabId = activeTab.id;
        setTabs((current) =>
            current.map((tab) =>
                tab.id === tabId && !tab.paymentsTouched
                    ? { ...tab, payments: { ...tab.payments, cash: totals.total.toFixed(2) } }
                    : tab,
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
                    ? tab.cart.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, quantity: row.quantity + 1 } : row,
                      )
                    : [
                          ...tab.cart,
                          { id: item.id, name: item.name, price: item.price, vatRate: item.vatRate, quantity: 1 },
                      ];
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
        const entries = PAYMENT_FIELDS.map((field) => ({
            method: field.key,
            amount: parsePosMoney(payments[field.key]),
            reference: field.key === 'cash' ? null : references[field.key].trim() || null,
        }));
        if (entries.some((entry) => !Number.isFinite(entry.amount))) {
            toast({ title: 'أدخل مبالغ دفع صحيحة غير سالبة.', variant: 'error' });
            return;
        }
        const salePayments: PosPaymentInput[] = entries
            .filter((entry) => entry.amount > 0)
            .map((entry) => ({ method: entry.method, amount: entry.amount, reference: entry.reference }));
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
            setTabs((current) =>
                current.map((tab) => (tab.id === settledTabId ? { ...tab, saleKey } : tab)),
            );
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
            setTabs((current) =>
                current.map((tab) => (tab.id === settledTabId ? { ...freshPosTab(tab), receipt: result } : tab)),
            );
            toast({ title: 'تم تسجيل البيع؛ حالة الطباعة وZATCA معروضة حسب رد الخادم.', variant: 'success' });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-buffet-config'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-buffet-live'] }),
            ]);
        } catch (error) {
            toast({ title: `فشل إتمام البيع ولم تُفرّغ السلة: ${errorMessage(error)}`, variant: 'error' });
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
                    tab.id === recalledTabId
                        ? { ...freshPosTab(tab), cart: recalledCart, discount: recalledDiscount }
                        : tab,
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
            const neighbor = tabs[index + 1] ?? tabs[index - 1] ?? tabs[0]!;
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
                case 'F5':
                    event.preventDefault();
                    shortcutActions.current.complete();
                    break;
                case 'F6':
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

    return (
        <div className={`flex flex-col gap-md premium-screen pos-entry pos-entry--workspace pos-entry--pane-${mobilePane}`}>
            <h1 className="sr-only">الكاشير — نقطة البيع</h1>
            {shift ? (
                <header className="pos-console" aria-label="شريط الكاشير">
                    <div className="pos-console__identity">
                        <span className="pos-console__status" aria-hidden="true" />
                        <div className="pos-console__copy">
                            <strong>{shift.deptName || 'نقطة البيع'}</strong>
                            <small>
                                وردية #{shift.sessionId}
                                {buffet ? ' · بوفيه مفتوح' : ''}
                            </small>
                        </div>
                    </div>
                    <div className="pos-console__actions">
                        {canHistory ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                    setView('history');
                                }}
                            >
                                سجل الفواتير
                            </Button>
                        ) : null}
                        {buffet && canManageBuffet ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                    setView('buffet-prices');
                                }}
                            >
                                أسعار البوفيه
                            </Button>
                        ) : null}
                        {buffet ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                    setView('buffet-report');
                                }}
                            >
                                تقرير البوفيه
                            </Button>
                        ) : null}
                        {canDayClose ? (
                            <Button size="sm" variant="secondary" onClick={() => void runDayClose()} disabled={dayCloseBusy}>
                                إقفال اليوم Z
                            </Button>
                        ) : null}
                        <Button size="sm" variant="secondary" onClick={() => void refreshAll()}>
                            تحديث
                        </Button>
                        <Button size="sm" variant="secondary" onClick={openCloseShiftDialog} disabled={!canSell || busy}>
                            إغلاق الوردية
                        </Button>
                    </div>
                </header>
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

                    {shift ? (
                        catalogLoading ? (
                            <StateLoading label={buffet ? 'جارٍ تحميل فئات البوفيه…' : 'جارٍ تحميل أصناف الوصفات…'} />
                        ) : catalogError ? (
                            <StateError message={errorMessage(catalogError)} onRetry={catalogRetry} />
                        ) : (
                            <>
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
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={tabs.length >= MAX_TABS || busy}
                                        onClick={addTab}
                                    >
                                        + طلب جديد
                                    </Button>
                                    <span className="pos-tabs__hint" aria-hidden="true">
                                        Ctrl+1…5 تبديل · F2 بحث · F3 تعليق · F5 إتمام · F6 السجل
                                    </span>
                                </div>
                                <div className="pos-pane-switch" role="tablist" aria-label="عرض شاشة الكاشير">
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
                                    heldOrders={heldQuery.data ?? []}
                                    heldError={heldQuery.isError ? errorMessage(heldQuery.error) : ''}
                                    buffetLive={buffetLiveQuery.data ?? null}
                                    sales={salesRankQuery.data ?? EMPTY_SALES_INDEX}
                                    query={query}
                                    onQuery={setQuery}
                                    selectedCategory={selectedCategory}
                                    onCategory={setSelectedCategory}
                                    onAdd={addItem}
                                    onBarcodeEnter={barcodeEnter}
                                    searchInputRef={searchInputRef}
                                    favorites={favorites}
                                    onToggleFavorite={toggleFavorite}
                                    canSell={canSell}
                                    canManageCatalog={canManageCatalog}
                                    imagePending={imagePending}
                                    onUploadImage={(item, file) => {
                                        void uploadImage(item, file);
                                    }}
                                    onRecall={(order) => {
                                        void recallOrder(order);
                                    }}
                                    onDeleteHeld={(order) => {
                                        void removeHeldOrder(order);
                                    }}
                                    busy={busy || buffetBusy || dayCloseBusy}
                                />
                                <div className="pos-entry__side">
                                    <PosCart
                                        cart={cart}
                                        totals={totals}
                                        discount={discount}
                                        onDiscount={setDiscountValue}
                                        payments={payments}
                                        paymentsTouched={paymentsTouched}
                                        onPayment={setPayment}
                                        references={references}
                                        onReference={setReference}
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
                                        onOpenDrawer={() => {
                                            void openDrawer();
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
                <div
                    className="pos-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label={overlayTitle}
                    data-pos-overlay="true"
                >
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
        </div>
    );
}
