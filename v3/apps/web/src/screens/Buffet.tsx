import './Buffet.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Card, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import {
    type AutofillDraft,
    autofillDish,
    type BuffetDish,
    type BuffetLine,
    type BuffetNutrition,
    dishStatus,
    fetchBuffetOverview,
    fetchBuffetRematch,
    LINE_STATE_AR,
    type RematchBest,
    searchInventoryForLink,
    useBuffetAddWeekSlotMutation,
    useBuffetCreateDishMutation,
    useBuffetDeleteDishMutation,
    useBuffetLinkGroupMutation,
    useBuffetLinkMutation,
    useBuffetRematchApplyMutation,
    useBuffetRemoveWeekSlotMutation,
    useBuffetUnlinkMutation,
    useBuffetUpdateDishMutation,
} from '../lib/buffet';
import { printAllCards, printBoard, printDishCard } from '../lib/buffet-prints';
import { formatInt } from '../lib/inventory-register';
import { type OfficialSheetColumn, printOfficialSheet } from '../lib/official-print';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';

/**
 * كوست أصناف بوفيه الشرفة العالمي — كل التكاليف **محسوبة حيًّا من أسعار المخزن**.
 *
 *  • الجدول الرئيسي: 65 صنفًا مع تكلفة السفنديش كاملًا وحصة الشخص (تقديري 35–40)
 *  • «＋ صنف جديد» + المساعد الشخصي: يكمل المكونات والوصف والقيم الغذائية تلقائيًا
 *  • مسببات الحساسية حسب EU FIC 1169/2011 — مشتقة من المكوّنات لا من خيال
 *  • طباعة: تقرير كوست A4 · ورقة السبورة لغداء/عشاء · كروت البوفيه العالمية
 *  • الربط بالصلاحيات: الإدارة والمطبخ (حسب العملية) — الخادم هو الحكم
 */

const money = (n: number | null | undefined): string =>
    n == null ? '—' : `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
const moneyPlain = (n: number | null | undefined): string => (n == null ? '0.00' : Number(n).toFixed(2));
const numSigned = (n: number): string => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safeNum = (n: number | null | undefined): string => (n == null || Number.isNaN(Number(n)) ? '—' : String(Math.round(Number(n))));

const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'] as const;
const MEALS = ['غداء', 'عشاء'] as const;
const UNITS = [
    'كيلو',
    'جرام',
    'لتر',
    'مل',
    'عدد / حبة',
    'علبة',
    'كيس',
    'زجاجة',
    'كوب',
    'ملعقة كبيرة',
    'ملعقة صغيرة',
    'رشة',
    'عبوة',
    'باكت',
    'شدة',
    'كرتون',
    'جالون',
    'تنك',
    'قطعة',
];

type Tab = 'dishes' | 'week' | 'cards';
type StatusFilter = 'all' | 'priced' | 'partial' | 'unpriced';
type SortKey = 'name' | 'cost' | 'status';

const STATUS_LABEL: Record<SortKey | StatusFilter, string> = {
    name: 'الاسم',
    cost: 'التكلفة',
    status: 'التسعير',
    all: 'الكل',
    priced: 'مُسعَّرة بالكامل',
    partial: 'جزئية',
    unpriced: 'بدون تسعير',
};

const STATUS_PILL: Record<'priced' | 'partial' | 'unpriced', string> = {
    priced: 'bf-pill bf-pill--ok',
    partial: 'bf-pill bf-pill--partial',
    unpriced: 'bf-pill bf-pill--none',
};

type FormIngredient = { name: string; qty: number; unit: string };
const emptyForm = () => ({
    name: '',
    name_en: '',
    category: '',
    freq: 1,
    yields: 'سفنديش 5 سم — تكفي 35–40 شخص',
    notes: '',
    description: '',
    description_en: '',
    ingredients: [{ name: '', qty: 1, unit: 'كيلو' }] as FormIngredient[],
});

export function Buffet() {
    const auth = useAuthState();
    const { toast } = useToast();
    const role = String(auth.user?.role || '');
    const canLink = role === 'admin' || role === 'owner' || role === 'manager';
    const canWrite = ['admin', 'owner', 'manager', 'kitchen', 'sous_chef'].includes(role);
    const canDelete = ['admin', 'owner', 'manager'].includes(role);

    const [tab, setTab] = useState<Tab>('dishes');
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [sort, setSort] = useState<SortKey>('cost');
    const [openDishId, setOpenDishId] = useState<string | number | null>(null);
    const [linkLineId, setLinkLineId] = useState<string | number | null>(null);
    const [linkQuery, setLinkQuery] = useState('');
    const [linkAll, setLinkAll] = useState(true);

    // نموذج الإضافة/التعديل + المساعد الشخصي
    const [dishOpen, setDishOpen] = useState(false);
    const [editingDish, setEditingDish] = useState<BuffetDish | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [draftNutrition, setDraftNutrition] = useState<BuffetNutrition | null>(null);
    const [autofilling, setAutofilling] = useState(false);

    // خطة الأسبوع + الطابعات + محرك الربط
    const [weekPick, setWeekPick] = useState<Record<string, string>>({});
    const [boardDay, setBoardDay] = useState<(typeof DAYS)[number]>('السبت');
    const [proPrints, setProPrints] = useState(true);
    const [rematchOpen, setRematchOpen] = useState(false);
    const [rematchFilter, setRematchFilter] = useState<'all' | 'auto' | 'review'>('auto');
    const [rematchSearch, setRematchSearch] = useState('');
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [choices, setChoices] = useState<Record<string, string>>({});

    const query = useQuery({
        queryKey: ['buffet', 'overview'],
        queryFn: ({ signal }) => fetchBuffetOverview(signal),
        staleTime: 30_000,
    });
    const data = query.data;

    const linkOne = useBuffetLinkMutation();
    const linkGroup = useBuffetLinkGroupMutation();
    const unlink = useBuffetUnlinkMutation();
    const createDish = useBuffetCreateDishMutation();
    const updateDish = useBuffetUpdateDishMutation();
    const deleteDish = useBuffetDeleteDishMutation();
    const addWeekSlot = useBuffetAddWeekSlotMutation();
    const removeWeekSlot = useBuffetRemoveWeekSlotMutation();
    const applyRematch = useBuffetRematchApplyMutation();

    const linkResults = useQuery({
        queryKey: ['buffet', 'search', linkQuery],
        queryFn: ({ signal }) => searchInventoryForLink(linkQuery, signal),
        enabled: linkLineId != null && linkQuery.trim().length >= 2,
        staleTime: 60_000,
    });

    // محرك الربط — dry-run عند فتح النافذة
    const rematchQuery = useQuery({
        queryKey: ['buffet', 'rematch'],
        queryFn: () => fetchBuffetRematch(),
        enabled: rematchOpen,
        staleTime: 60_000,
        retry: false,
    });
    const rematchGroups = rematchQuery.data?.groups ?? [];
    const filteredGroups = useMemo(() => {
        const q = rematchSearch.trim();
        return rematchGroups.filter((g) => {
            if (rematchFilter === 'auto' && !g.autoApply) {
                return false;
            }
            if (rematchFilter === 'review' && g.autoApply) {
                return false;
            }
            if (q && !g.name.includes(q) && !(g.best?.name ?? '').includes(q)) {
                return false;
            }
            return true;
        });
    }, [rematchGroups, rematchFilter, rematchSearch]);
    const checkedCount = useMemo(
        () => rematchGroups.filter((g) => checked[g.norm]).reduce((sum, g) => sum + g.count, 0),
        [rematchGroups, checked],
    );
    // تهيئة الاختيارات الافتراضية عند وصول النتائج — ≥0.8 مُعتمدة، والباقي للمراجعة
    useEffect(() => {
        if (!rematchQuery.data) {
            return;
        }
        const nextChecked: Record<string, boolean> = {};
        const nextChoices: Record<string, string> = {};
        for (const g of rematchQuery.data.groups) {
            nextChecked[g.norm] = g.autoApply;
            nextChoices[g.norm] = g.best?.inventoryId ?? '';
        }
        setChecked(nextChecked);
        setChoices(nextChoices);
    }, [rematchQuery.data]);

    const dishes = useMemo(() => data?.dishes ?? [], [data]);
    const categories = useMemo(() => {
        const seen = new Map<string, number>();
        for (const d of dishes) {
            seen.set(d.category, (seen.get(d.category) ?? 0) + 1);
        }
        return [...seen.entries()];
    }, [dishes]);
    const categoryList = useMemo(() => [...new Set(dishes.map((d) => d.category))], [dishes]);

    const filtered = useMemo(() => {
        const q = search.trim();
        let rows = dishes.filter((d) => {
            if (category && d.category !== category) {
                return false;
            }
            if (statusFilter !== 'all' && dishStatus(d) !== statusFilter) {
                return false;
            }
            if (q && !d.name.includes(q)) {
                return false;
            }
            return true;
        });
        if (sort === 'cost') {
            rows = [...rows].sort((a, b) => b.batchCost - a.batchCost);
        } else if (sort === 'name') {
            rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        } else {
            rows = [...rows].sort((a, b) => a.unpricedLines - b.unpricedLines);
        }
        return rows;
    }, [dishes, search, category, statusFilter, sort]);

    const weekByDay = useMemo(() => {
        const byDay = new Map<string, Map<string, NonNullable<typeof data>['week']>>();
        for (const entry of data?.week ?? []) {
            if (!byDay.has(entry.day)) {
                byDay.set(entry.day, new Map());
            }
            const meals = byDay.get(entry.day)!;
            if (!meals.has(entry.meal)) {
                meals.set(entry.meal, []);
            }
            meals.get(entry.meal)!.push(entry);
        }
        return byDay;
    }, [data]);
    const weekBatchSum = useMemo(() => (data?.week ?? []).reduce((sum, entry) => sum + Number(entry.batchCost || 0), 0), [data]);

    const openDish = useMemo(
        () => (openDishId == null ? null : (dishes.find((d) => String(d.id) === String(openDishId)) ?? null)),
        [dishes, openDishId],
    );
    const openLines = openDish?.lines ?? [];
    const linkTargetLine = useMemo(
        () => (linkLineId == null ? null : (openLines.find((l) => String(l.id) === String(linkLineId)) ?? null)),
        [openLines, linkLineId],
    );
    const sameNameCount = useMemo(() => {
        if (!linkTargetLine) {
            return 1;
        }
        const target = linkTargetLine.name.trim();
        return dishes.reduce((sum, dish) => sum + dish.lines.filter((l) => l.name.trim() === target).length, 0);
    }, [dishes, linkTargetLine]);

    useEffect(() => {
        setLinkLineId(null);
        setLinkQuery('');
        setLinkAll(true);
    }, [openDishId]);

    const doLink = (line: BuffetLine, inventoryId: string | number | null) => {
        if (linkAll && sameNameCount > 1 && line.name.trim()) {
            linkGroup.mutate({ name: line.name.trim(), inventoryId });
        } else if (line.id != null) {
            linkOne.mutate({ lineId: line.id, inventoryId });
        }
        setLinkLineId(null);
        setLinkQuery('');
    };

    /** فتح نموذج إضافة صنف جديد (فارغ) */
    const openAdd = () => {
        setEditingDish(null);
        setForm(emptyForm());
        setDraftNutrition(null);
        setDishOpen(true);
    };
    /** فتح نموذج تعديل صنف موجود */
    const openEdit = (dish: BuffetDish) => {
        setEditingDish(dish);
        setForm({
            name: dish.name,
            name_en: dish.name_en ?? '',
            category: dish.category,
            freq: dish.freq,
            yields: dish.yields,
            notes: dish.notes,
            description: dish.description ?? '',
            description_en: dish.description_en ?? '',
            ingredients: dish.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit })),
        });
        setDraftNutrition(dish.nutrition ?? null);
        setDishOpen(true);
    };

    const runAutofill = async () => {
        const name = form.name.trim();
        if (!name) {
            toast({ title: 'اكتب اسم الصنف أولًا', variant: 'error' });
            return;
        }
        setAutofilling(true);
        try {
            const afInput: { name: string; category?: string; yields?: string } = { name };
            if (form.category.trim()) {
                afInput.category = form.category.trim();
            }
            if (form.yields.trim()) {
                afInput.yields = form.yields.trim();
            }
            const res = await autofillDish(afInput);
            const draft: AutofillDraft = res.draft;
            setForm((prev) => ({
                ...prev,
                description: draft.description || prev.description,
                yields: draft.yields || prev.yields,
                ingredients: draft.ingredients.length
                    ? draft.ingredients.map((ing) => ({ name: ing.name, qty: Number(ing.qty) || 0, unit: ing.unit || 'كيلو' }))
                    : prev.ingredients,
            }));
            setDraftNutrition(draft.nutrition as BuffetNutrition);
            toast({ title: 'أكمل المساعد الشخصي المسودة', description: 'راجع المكونات والقيم قبل الحفظ', variant: 'success' });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'تعذر على المساعد توليد المسودة';
            toast({ title: message, variant: 'error' });
        } finally {
            setAutofilling(false);
        }
    };

    const saveDish = () => {
        const ingredients = form.ingredients.filter((ing) => ing.name.trim() && Number(ing.qty) > 0);
        if (!form.name.trim()) {
            toast({ title: 'اكتب اسم الصنف', variant: 'error' });
            return;
        }
        if (!form.category.trim()) {
            toast({ title: 'اختر الفئة', variant: 'error' });
            return;
        }
        const payload = {
            name: form.name.trim(),
            name_en: form.name_en.trim(),
            category: form.category.trim(),
            freq: Number(form.freq) || 1,
            yields: form.yields.trim(),
            notes: form.notes.trim(),
            description: form.description.trim(),
            description_en: form.description_en.trim(),
            ingredients,
        };
        if (editingDish) {
            updateDish.mutate({ id: editingDish.id, ...payload }, { onSuccess: () => setDishOpen(false) });
        } else {
            createDish.mutate(payload, { onSuccess: () => setDishOpen(false) });
        }
    };

    const addIngredientRow = () => setForm((prev) => ({ ...prev, ingredients: [...prev.ingredients, { name: '', qty: 1, unit: 'كيلو' }] }));
    const removeIngredientRow = (index: number) =>
        setForm((prev) => ({ ...prev, ingredients: prev.ingredients.filter((_, i) => i !== index) }));
    const updateIngredientRow = (index: number, patch: Partial<FormIngredient>) =>
        setForm((prev) => ({ ...prev, ingredients: prev.ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)) }));

    const applyRematchLinks = () => {
        const links = rematchGroups
            .filter((g) => checked[g.norm])
            .map((g) => {
                const chosenId = choices[g.norm] ?? g.best?.inventoryId ?? '';
                const options = [g.best, ...(g.alternatives ?? [])].filter(Boolean) as RematchBest[];
                const chosen = options.find((o) => o.inventoryId === chosenId) ?? options[0] ?? null;
                return {
                    name: g.name,
                    inventoryId: chosenId,
                    lines: g.lines,
                    rule: 'rematch-ui v1',
                    score: chosen?.score,
                    packKg: chosen?.packKg ?? null,
                };
            })
            .filter((l) => l.inventoryId);
        applyRematch.mutate(
            { links },
            {
                onSuccess: () => {
                    setRematchOpen(false);
                    void query.refetch();
                },
            },
        );
    };

    const applyAllReady = () => {
        const links = rematchGroups
            .filter((g) => g.autoApply)
            .map((g) => ({
                name: g.name,
                inventoryId: g.best?.inventoryId ?? '',
                lines: g.lines,
                rule: 'rematch-ui auto',
                score: g.best?.score,
                packKg: g.best?.packKg ?? null,
            }))
            .filter((l) => l.inventoryId);
        if (!links.length) {
            toast({ title: 'لا توجد نتائج جاهزة للاعتماد حاليًا', variant: 'error' });
            return;
        }
        applyRematch.mutate(
            { links },
            {
                onSuccess: () => {
                    setRematchOpen(false);
                    void query.refetch();
                },
            },
        );
    };

    const boardDishesFor = (day: string, meal: string): BuffetDish[] => {
        const ids = (weekByDay.get(day)?.get(meal) ?? []).map((entry) => String(entry.dishId));
        const byId = new Map(dishes.map((d) => [String(d.id), d] as const));
        return ids.map((id) => byId.get(id)).filter((d): d is BuffetDish => d !== undefined);
    };

    const printOfficial = () => {
        if (!data) {
            return;
        }
        const t = data.totals;
        const unpricedCounts = (data.unpriced ?? []).reduce<Record<string, number>>((acc, item) => {
            acc[item.state] = (acc[item.state] ?? 0) + 1;
            return acc;
        }, {});
        const dishRows = dishes.map((d) => ({
            name: d.name,
            category: d.category,
            batch: money(d.batchCost),
            perPerson: d.perPerson ? `${numSigned(d.perPerson.low)} – ${numSigned(d.perPerson.high)}` : '—',
            priced: `${d.pricedLines}/${d.totalLines}`,
            note: isFullyPricedNote(d),
        }));
        const weekRows = DAYS.flatMap((day) =>
            MEALS.map((meal) => {
                const entries = weekByDay.get(day)?.get(meal) ?? [];
                const sum = entries.reduce((s, e) => s + Number(e.batchCost || 0), 0);
                return { day, meal, count: String(entries.length), cost: money(sum) };
            }),
        );
        const printed = printOfficialSheet({
            title: 'كوست أصناف بوفيه الشرفة العالمي',
            englishTitle: 'BUFFET COST — AL SHURFA AL ALAMI',
            subtitle: 'التكلفة محسوبة حيًّا من أسعار المخزن بتاريخ الطباعة',
            kpis: [
                { label: 'الأصناف', value: String(t.total) },
                { label: 'تكلفة تشغيل الأسبوع (batch)', value: money(weekBatchSum), hint: 'كل صنف = سفنديش واحد' },
                { label: 'مُسعَّرة بالكامل', value: `${t.pricedFull}/${t.total}` },
                { label: 'سطور بلا تسعير', value: String(t.unpricedLineCount) },
            ],
            sections: [
                {
                    heading: 'كوست الأصناف (تكفي 35–40 شخص غالبًا)',
                    columns: [
                        { key: 'name', header: 'الصنف', width: '30%' },
                        { key: 'category', header: 'الفئة' },
                        { key: 'batch', header: 'التكلفة (سفنديش)', align: 'end' },
                        { key: 'perPerson', header: 'للشخص (35–40) — تقديري', align: 'end' },
                        { key: 'priced', header: 'التسعير', align: 'center' },
                        { key: 'note', header: 'ملاحظة' },
                    ] as OfficialSheetColumn[],
                    rows: dishRows,
                    totalsRow: [
                        {
                            name: 'الإجمالي (تشغيل الـ 65 صنفًا مرة واحدة)',
                            category: '',
                            batch: money(t.batchCostSum),
                            perPerson: '',
                            priced: '',
                            note: '',
                        },
                    ],
                },
                {
                    heading: 'خطة الأسبوع — تكلفة كل وجبة كاملة (سفنديش واحد لكل صنف)',
                    columns: [
                        { key: 'day', header: 'اليوم', width: '18%' },
                        { key: 'meal', header: 'الوجبة', width: '12%' },
                        { key: 'count', header: 'عدد الأصناف', align: 'center', width: '15%' },
                        { key: 'cost', header: 'تكلفة الوجبة', align: 'end' },
                    ] as OfficialSheetColumn[],
                    rows: weekRows,
                    totalsRow: [{ day: 'الإجمالي الأسبوعي', meal: '', count: '', cost: money(weekBatchSum) }],
                },
            ],
            notes: [
                'التكلفة تُحسب حيًّا من أسعار المخزن (avgCost) وقت الطباعة — أي تغيير في الأسعار ينعكس تلقائيًا دون إعادة إدخال.',
                'أصناف المطبخ الطازجة (غير المدرجة في المخزن بعد) تُحتسب تلقائيًا فور اعتمادها في المخزن.',
                'سطور التكلفة موسومة «بدون تسعير» (بدون ربط / بدون تحويل وحدة / بلا سعر) ولا تُقدَّر بأرقام افتراضية.',
                `السطور بلا تسعير: بدون ربط ${unpricedCounts.unlinked ?? 0} · بدون تحويل ${unpricedCounts.unconvertible ?? 0} · بلا سعر ${unpricedCounts.no_price ?? 0} — تُعالج من شاشة «كوست البوفيه» بزر «ربط».`,
                'حصة الشخص تقديرية مبنية على عائد الوعاء الموضح في كل صنف (غالبًا 35–40 شخص).',
            ],
            signatures: [{ role: 'إعداد المحاسب' }, { role: 'مراجعة الشيف' }, { role: 'اعتماد الإدارة' }],
        });
        if (!printed) {
            toast({ title: 'تعذر فتح نافذة الطباعة', variant: 'error' });
        }
    };

    if (query.isPending) {
        return (
            <Card aria-labelledby="buffet-title">
                <StateLoading label="جارٍ حساب كوست البوفيه من أسعار المخزن…" />
                <TableSkeleton rows={10} columns={6} />
            </Card>
        );
    }
    if (query.isError) {
        return (
            <Card aria-labelledby="buffet-title">
                <StateError
                    title="تعذر حساب الكوست"
                    message={query.error instanceof Error ? query.error.message : 'تعذر الاتصال بالخادم'}
                    onRetry={() => void query.refetch()}
                />
            </Card>
        );
    }

    const totals = data?.totals;
    const coveragePct = totals && totals.total > 0 ? Math.round((totals.pricedFull / totals.total) * 100) : 0;

    return (
        <section className="bf-screen" aria-labelledby="buffet-title">
            {/* ═══ Hero ═══ */}
            <header className="bf-hero">
                <div className="bf-hero__text">
                    <span className="bf-hero__eyebrow">Al Shurfa Al Alami · Buffet Cost</span>
                    <h2 id="buffet-title" className="bf-hero__title">
                        كوست أصناف بوفيه الشرفة العالمي
                    </h2>
                    <p className="bf-hero__sub">
                        كل التكاليف تُحسب <b>حيًّا من أسعار المخزن</b> — أي تغيير سعر ينعكس تلقائيًا.
                        <b>المساعد الشخصي</b> يكمل المكونات والوصف والقيم الغذائية تلقائيًا، لا رقم واحد هنا مُقدَّر بدون مصدر.
                    </p>
                </div>
                <div className="bf-hero__side">
                    <span className="bf-live">
                        <i className="bf-live__dot" aria-hidden="true" />
                        لايف — أسعار المخزن
                    </span>
                    <span className="bf-hero__note">
                        آخر حساب:{' '}
                        {data?.generatedAt
                            ? new Date(data.generatedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
                            : '—'}
                    </span>
                    <Button onClick={printOfficial} variant="secondary" size="sm">
                        🖨 طباعة التقرير الرسمي
                    </Button>
                </div>
            </header>

            {/* ═══ KPIs ═══ */}
            <div className="bf-kpis">
                <div className="bf-kpi bf-kpi--gold">
                    <span className="bf-kpi__label">الأصناف المستوردة</span>
                    <span className="bf-kpi__value">{formatInt(totals?.total ?? 0)}</span>
                    <span className="bf-kpi__hint">موزعة على 10 فئات — من ملف الوصفات المعتمد</span>
                </div>
                <div className="bf-kpi bf-kpi--green">
                    <span className="bf-kpi__label">تكلفة تشغيل الأسبوع (batch)</span>
                    <span className="bf-kpi__value">{money(weekBatchSum)}</span>
                    <span className="bf-kpi__hint">سفنديش واحد لكل خانة من الـ 14 — للتحليل لا للاقتطاع</span>
                </div>
                <div className="bf-kpi bf-kpi--green">
                    <span className="bf-kpi__label">أصناف مُسعَّرة بالكامل</span>
                    <span className="bf-kpi__value">
                        {formatInt(totals?.pricedFull ?? 0)}
                        <small> / {totals?.total ?? 0}</small>
                    </span>
                    <span className="bf-kpi__hint">{coveragePct}% من الأصناف بأسعار مخزن معتمدة</span>
                </div>
                <div className="bf-kpi bf-kpi--amber">
                    <span className="bf-kpi__label">سطور بلا تسعير / تحويل</span>
                    <span className="bf-kpi__value">{formatInt(totals?.unpricedLineCount ?? 0)}</span>
                    <span className="bf-kpi__hint">وليس صنف «رخيص» — تحتاج ربط بالمخزن أو وحدة وزن/حجم</span>
                </div>
            </div>

            {/* ═══ أدوات ═══ */}
            <div className="bf-toolbar">
                <div className="bf-seg" role="tablist" aria-label="عرض">
                    {(
                        [
                            ['dishes', 'الأصناف'],
                            ['week', 'خطة الأسبوع'],
                            ['cards', 'الكروت العالمية'],
                        ] as const
                    ).map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={tab === key}
                            className={`bf-seg__btn${tab === key ? ' is-active' : ''}`}
                            onClick={() => setTab(key)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {canWrite ? (
                    <button type="button" className="bf-add-btn" onClick={openAdd}>
                        ＋ صنف جديد
                    </button>
                ) : null}
                {canLink ? (
                    <button type="button" className="bf-link-btn" onClick={() => setRematchOpen(true)}>
                        🔗 مراجعة ربط المخزن
                    </button>
                ) : null}
                {tab === 'dishes' ? (
                    <>
                        <div className="bf-search">
                            <Input
                                aria-label="ابحث عن صنف"
                                placeholder="ابحث عن صنف… مثال: ملوخية، مكرونة"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        <div className="bf-chips" role="group" aria-label="فلتر الفئة">
                            <button
                                type="button"
                                className={`bf-chip${category === null ? ' is-active' : ''}`}
                                onClick={() => setCategory(null)}
                            >
                                الكل
                            </button>
                            {categories.map(([name, count]) => (
                                <button
                                    key={name}
                                    type="button"
                                    className={`bf-chip${category === name ? ' is-active' : ''}`}
                                    onClick={() => setCategory(category === name ? null : name)}
                                >
                                    {name}
                                    <span className="bf-chip__count">{count}</span>
                                </button>
                            ))}
                        </div>
                        <select
                            aria-label="فلتر حالة التسعير"
                            className="erp-control"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                        >
                            {(['all', 'priced', 'partial', 'unpriced'] as StatusFilter[]).map((key) => (
                                <option key={key} value={key}>
                                    {STATUS_LABEL[key]}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label="ترتيب"
                            className="erp-control"
                            value={sort}
                            onChange={(e) => setSort(e.target.value as SortKey)}
                        >
                            {(['cost', 'name', 'status'] as SortKey[]).map((key) => (
                                <option key={key} value={key}>
                                    ترتيب: {STATUS_LABEL[key]}
                                </option>
                            ))}
                        </select>
                    </>
                ) : null}
                {tab === 'week' ? (
                    <div className="bf-printbar">
                        <select
                            aria-label="اليوم المراد طباعته"
                            className="erp-control"
                            value={boardDay}
                            onChange={(e) => setBoardDay(e.target.value as (typeof DAYS)[number])}
                        >
                            {DAYS.map((day) => (
                                <option key={day} value={day}>
                                    {day}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            className="bf-mini-btn bf-mini-btn--gold"
                            onClick={() => printBoard(boardDay, 'غداء', boardDishesFor(boardDay, 'غداء'), { pro: proPrints })}
                        >
                            🖨 سبورة الغداء
                        </button>
                        <button
                            type="button"
                            className="bf-mini-btn bf-mini-btn--gold"
                            onClick={() => printBoard(boardDay, 'عشاء', boardDishesFor(boardDay, 'عشاء'), { pro: proPrints })}
                        >
                            🖨 سبورة العشاء
                        </button>
                        <label className="bf-check">
                            <input type="checkbox" checked={proPrints} onChange={(e) => setProPrints(e.target.checked)} />
                            طبعة احترافية (مع المصادر)
                        </label>
                    </div>
                ) : null}
                {tab === 'cards' ? (
                    <div className="bf-printbar">
                        <button
                            type="button"
                            className="bf-mini-btn bf-mini-btn--gold"
                            onClick={() => printAllCards(dishes, { pro: proPrints })}
                        >
                            🖨 طباعة كل الكروت (A4 — 2×2)
                        </button>
                        <label className="bf-check">
                            <input type="checkbox" checked={proPrints} onChange={(e) => setProPrints(e.target.checked)} />
                            طبعة احترافية (مع المصادر)
                        </label>
                    </div>
                ) : null}
            </div>

            {/* ═══ تبويب الأصناف ═══ */}
            {tab === 'dishes' ? (
                <div className="bf-table-wrap">
                    <TableScroll label="جدول كوست الأصناف">
                        <table className="bf-table">
                            <thead>
                                <tr>
                                    <th>
                                        الصنف{' '}
                                        <span dir="ltr" style={{ opacity: 0.6 }}>
                                            ({filtered.length})
                                        </span>
                                    </th>
                                    <th>الفئة</th>
                                    <th>التكلفة (السفنديش)</th>
                                    <th>لكل شخص (35–40) — تقديري</th>
                                    <th>التسعير</th>
                                    <th>الحالة</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((d) => {
                                    const st = dishStatus(d);
                                    const pct = d.totalLines > 0 ? Math.round((d.pricedLines / d.totalLines) * 100) : 0;
                                    return (
                                        <tr key={String(d.id)} onClick={() => setOpenDishId(d.id)} aria-label={`فتح مكوّنات ${d.name}`}>
                                            <td>
                                                <span className="bf-dish">{d.name}</span>
                                                <span className="bf-yields">{d.yields}</span>
                                            </td>
                                            <td>
                                                <span className="bf-cat">{d.category}</span>
                                            </td>
                                            <td className="bf-num">{money(d.batchCost)}</td>
                                            <td className="bf-per">
                                                {d.perPerson ? `${numSigned(d.perPerson.low)} – ${numSigned(d.perPerson.high)} ر.س` : '—'}
                                            </td>
                                            <td>
                                                <span className="bf-meter">
                                                    <span className="bf-meter__bar">
                                                        <span className="bf-meter__fill" style={{ width: `${pct}%` }} />
                                                    </span>
                                                    <span className="bf-meter__num">
                                                        {d.pricedLines}/{d.totalLines}
                                                    </span>
                                                </span>
                                            </td>
                                            <td>
                                                <span className={STATUS_PILL[st]}>
                                                    <i className="bf-pill__dot" aria-hidden="true" />
                                                    {st === 'priced' ? 'مُسعَّر' : st === 'partial' ? 'جزئي' : 'بدون تسعير'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} style={{ textAlign: 'center', padding: '28px 12px', color: '#87928b' }}>
                                            لا أصناف مطابقة — عدّل البحث أو الفئة.
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </TableScroll>
                </div>
            ) : null}

            {/* ═══ تبويب خطة الأسبوع (قابلة للتعديل) ═══ */}
            {tab === 'week' ? (
                <div className="bf-week">
                    {DAYS.map((day) => {
                        const meals = weekByDay.get(day);
                        const dayTotal = MEALS.flatMap((m) => meals?.get(m) ?? []).reduce((s, e) => s + Number(e.batchCost || 0), 0);
                        return (
                            <div key={day} className="bf-day">
                                <div className="bf-day__head">
                                    <span>{day}</span>
                                    <span className="bf-day__total">{money(dayTotal)}</span>
                                </div>
                                {MEALS.map((meal) => {
                                    const entries = meals?.get(meal) ?? [];
                                    const sum = entries.reduce((s, e) => s + Number(e.batchCost || 0), 0);
                                    const pickKey = `${day}|${meal}`;
                                    const pickValue = weekPick[pickKey] ?? '';
                                    const pickable = dishes.filter((d) => !entries.some((e) => String(e.dishId) === String(d.id)));
                                    return (
                                        <div key={meal} className="bf-meal">
                                            <div className="bf-meal__title">
                                                <span>{meal}</span>
                                                <span className="bf-meal__sum">{money(sum)}</span>
                                            </div>
                                            {entries.length === 0 ? (
                                                <p className="bf-day__empty">يوم مفتوح — أضف من القائمة أدناه</p>
                                            ) : null}
                                            {entries.map((entry) => (
                                                <div key={`${day}-${meal}-${entry.position}`} className="bf-slot">
                                                    <i
                                                        className={`bf-slot__dot bf-slot__dot--${entry.priced ? 'ok' : 'none'}`}
                                                        aria-hidden="true"
                                                    />
                                                    <span className="bf-slot__name">{entry.name}</span>
                                                    <span className="bf-slot__cost">{moneyPlain(entry.batchCost)}</span>
                                                    {canWrite ? (
                                                        <button
                                                            type="button"
                                                            className="bf-slot__del"
                                                            aria-label={`حذف ${entry.name} من ${meal} ${day}`}
                                                            onClick={() => removeWeekSlot.mutate({ day, meal, dishId: entry.dishId })}
                                                        >
                                                            ✕
                                                        </button>
                                                    ) : null}
                                                </div>
                                            ))}
                                            {canWrite ? (
                                                <div className="bf-slot-add">
                                                    <select
                                                        aria-label={`إضافة صنف إلى ${meal} ${day}`}
                                                        className="erp-control"
                                                        value={pickValue}
                                                        onChange={(e) => {
                                                            const value = e.target.value;
                                                            setWeekPick((prev) => ({ ...prev, [pickKey]: '' }));
                                                            if (value) {
                                                                addWeekSlot.mutate({ day, meal, dishId: value });
                                                            }
                                                        }}
                                                    >
                                                        <option value="">＋ أضف صنفًا…</option>
                                                        {pickable.map((d) => (
                                                            <option key={String(d.id)} value={String(d.id)}>
                                                                {d.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            ) : null}

            {/* ═══ تبويب الكروت العالمية ═══ */}
            {tab === 'cards' ? (
                <div className="bf-cards-grid">
                    {dishes.map((d) => {
                        const kcal = d.nutrition?.perServing?.low?.kcal;
                        return (
                            <article key={String(d.id)} className="bf-card-tile">
                                <div className="bf-card-tile__ribbon" aria-hidden="true">
                                    <span className="bf-card-tile__brand" dir="ltr">
                                        AL&nbsp;SHURFA <b>AL&nbsp;ALAMI</b>
                                    </span>
                                    <span className="bf-card-tile__eyebrow" dir="ltr">
                                        BUFFET
                                    </span>
                                </div>
                                <div className="bf-card-tile__body">
                                    <h3 className="bf-card-tile__name">{d.name}</h3>
                                    {d.name_en ? (
                                        <p className="bf-card-tile__name-en" lang="en" dir="ltr">
                                            {d.name_en}
                                        </p>
                                    ) : null}
                                    {d.description ? <p className="bf-card-tile__desc">{d.description}</p> : null}
                                    {d.description_en ? (
                                        <p className="bf-card-tile__desc-en" lang="en" dir="ltr">
                                            {d.description_en}
                                        </p>
                                    ) : null}
                                </div>
                                <div className="bf-card-tile__meta">
                                    <span className="bf-cat">{d.category}</span>
                                    {kcal != null && !Number.isNaN(Number(kcal)) ? (
                                        <span className="bf-card-tile__kcal" dir="ltr">
                                            <b>{String(Math.round(Number(kcal)))}</b> <small>سعرة / حصة</small>
                                        </span>
                                    ) : null}
                                </div>
                                <div className="bf-card-tile__foot">
                                    <button
                                        type="button"
                                        className="bf-mini-btn bf-mini-btn--gold"
                                        onClick={() => printDishCard(d, { pro: proPrints })}
                                    >
                                        طباعة الكرت
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            ) : null}

            <p className="bf-footer-note">
                <b>كيف تُحسب؟</b> كل صنف يبدأ من سفنديش كامل حسب الوصفة — الشدة 5 سم تكفي 35–40 شخصًا غالبًا، لذلك تُعرض «لكل شخص» كحدّين
                تقديريين. السطر بلا سعر لا يُحسب برقم افتراضي: يظهر موسومًا (بدون ربط / بدون تحويل وحدة / بلا سعر في المخزن). عند إضافة أصناف
                المطبخ الطازجة إلى المخزن (غدًا بإذن الله) تُحتسب كل التكاليف تلقائيًا حيًّا — دون لمس هذا الملف أو إعادة استيراد.
            </p>

            {/* ═══ Drawer: مكوّنات الصنف + القيم ═══ */}
            {openDish ? (
                <>
                    <div className="bf-overlay" role="presentation" onClick={() => setOpenDishId(null)} />
                    <aside className="bf-drawer" role="dialog" aria-modal="true" aria-label={`مكوّنات ${openDish.name}`}>
                        <div className="bf-drawer__head">
                            <div>
                                <h3 className="bf-drawer__title">{openDish.name}</h3>
                                {openDish.name_en ? (
                                    <p className="bf-drawer__name-en" lang="en" dir="ltr">
                                        {openDish.name_en}
                                    </p>
                                ) : null}
                                <p className="bf-drawer__meta">
                                    {openDish.category} · {openDish.yields} · يتكرر في الأسبوع ×{openDish.freq}
                                </p>
                            </div>
                            <button type="button" className="bf-drawer__close" aria-label="إغلاق" onClick={() => setOpenDishId(null)}>
                                ✕
                            </button>
                        </div>
                        <div className="bf-drawer__ref">
                            <span>BUFFET / {String(openDish.id)}</span>
                            <span>KOST · حي من المخزن</span>
                        </div>
                        <div className="bf-drawer__body">
                            {openDish.description ? <p className="bf-drawer__desc">{openDish.description}</p> : null}
                            {openDish.description_en ? (
                                <p className="bf-drawer__desc-en" lang="en" dir="ltr">
                                    {openDish.description_en}
                                </p>
                            ) : null}

                            <div className="bf-costbar">
                                <div className="bf-costbar__cell">
                                    <div className="bf-costbar__label">تكلفة السفنديش</div>
                                    <div className="bf-costbar__value">{money(openDish.batchCost)}</div>
                                </div>
                                <div className="bf-costbar__cell">
                                    <div className="bf-costbar__label">لكل شخص (35–40)</div>
                                    <div className="bf-costbar__value">
                                        {openDish.perPerson
                                            ? `${numSigned(openDish.perPerson.low)}–${numSigned(openDish.perPerson.high)}`
                                            : '—'}
                                    </div>
                                </div>
                                <div className="bf-costbar__cell">
                                    <div className="bf-costbar__label">سطور مُسعَّرة</div>
                                    <div className="bf-costbar__value">
                                        {openDish.pricedLines}/{openDish.totalLines}
                                    </div>
                                </div>
                            </div>

                            {/* ═══ القيم الغذائية + المسببات ═══ */}
                            {openDish.nutrition ? (
                                <div className="bf-nutrition">
                                    <div className="bf-nutrition__head">
                                        <span>القيم الغذائية للحصة — تقديري USDA</span>
                                        <small>{openDish.nutrition.sourceNote}</small>
                                    </div>
                                    <div className="bf-nutrition__grid">
                                        <div className="bf-nutrition__cell">
                                            <b>{safeNum(openDish.nutrition.perServing?.low?.kcal)}</b>
                                            <span>سعرات</span>
                                        </div>
                                        <div className="bf-nutrition__cell">
                                            <b>{numSigned(openDish.nutrition.perServing?.low?.protein ?? 0)}</b>
                                            <span>بروتين (ج)</span>
                                        </div>
                                        <div className="bf-nutrition__cell">
                                            <b>{numSigned(openDish.nutrition.perServing?.low?.carbs ?? 0)}</b>
                                            <span>كارب (ج)</span>
                                        </div>
                                        <div className="bf-nutrition__cell">
                                            <b>{numSigned(openDish.nutrition.perServing?.low?.fat ?? 0)}</b>
                                            <span>دهون (ج)</span>
                                        </div>
                                        <div className="bf-nutrition__cell">
                                            <b>{numSigned(openDish.nutrition.perServing?.low?.fiber ?? 0)}</b>
                                            <span>ألياف (ج)</span>
                                        </div>
                                        <div className="bf-nutrition__cell">
                                            <b>{safeNum(openDish.nutrition.perServing?.low?.sodium)}</b>
                                            <span>صوديوم (ملجم)</span>
                                        </div>
                                    </div>
                                    <div className="bf-allergens">
                                        <b>⚠ مسببات الحساسية:</b>{' '}
                                        {openDish.nutrition.allergenLabels.length
                                            ? openDish.nutrition.allergenLabels.join(' · ')
                                            : 'لا توجد مسببات معروفة (حسب المكونات المسجّلة)'}
                                        {openDish.nutrition.unmatched.length ? (
                                            <small className="bf-allergens__miss">
                                                مكوّنات خارج جدول USDA: {openDish.nutrition.unmatched.length} — تُراجع لاحقًا.
                                            </small>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}

                            {openLines.map((line) => (
                                <div key={String(line.id)} className="bf-line">
                                    <div className="bf-line__top">
                                        <span className="bf-line__name">{line.name}</span>
                                        <span className="bf-line__qty">
                                            {line.qty} {line.unit}
                                        </span>
                                        <span className={`bf-line__state bf-line__state--${line.state}`}>{LINE_STATE_AR[line.state]}</span>
                                    </div>
                                    <div className="bf-line__linked">
                                        {line.state === 'ok' ? (
                                            <span>
                                                {line.inventory?.name ?? '—'}
                                                {line.packUsed
                                                    ? ` · ≈ ${money(line.avgCost)} / كجم (عبوة ${line.packKg} كجم)`
                                                    : ` · ${money(line.avgCost)} / ${line.inventory?.unit ?? ''}`}
                                            </span>
                                        ) : (
                                            <span>
                                                {line.state === 'unlinked'
                                                    ? 'غير مربوط بالمخزن بعد'
                                                    : line.state === 'unconvertible'
                                                      ? 'وحدة غير قابلة للتحويل'
                                                      : 'بدون سعر معتمد في المخزن'}
                                            </span>
                                        )}
                                        <span className="bf-line__cost">{line.state === 'ok' ? money(line.cost) : '—'}</span>
                                    </div>
                                    {line.packUsed ? (
                                        <span className="bf-line__pack">السعر = تكلفة العبوة ÷ كجم التعبئة (تقديري موسوم)</span>
                                    ) : null}
                                    <div className="bf-line__actions">
                                        {canLink ? (
                                            <>
                                                <button
                                                    type="button"
                                                    className="bf-mini-btn bf-mini-btn--gold"
                                                    onClick={() => setLinkLineId(linkLineId === line.id ? null : (line.id ?? null))}
                                                >
                                                    {linkLineId === line.id ? 'إغلاق الربط' : '🔗 ربط بالمخزن'}
                                                </button>
                                                {line.inventoryId != null ? (
                                                    <button
                                                        type="button"
                                                        className="bf-mini-btn"
                                                        onClick={() => line.id != null && unlink.mutate({ lineId: line.id })}
                                                        disabled={unlink.isPending}
                                                    >
                                                        فك الربط
                                                    </button>
                                                ) : null}
                                            </>
                                        ) : (
                                            <span className="bf-line__pack">الربط متاح للإدارة فقط — تواصل مع المدير</span>
                                        )}
                                    </div>

                                    {linkLineId === line.id && canLink ? (
                                        <div className="bf-linkpanel">
                                            {sameNameCount > 1 ? (
                                                <label
                                                    style={{
                                                        display: 'flex',
                                                        gap: 8,
                                                        alignItems: 'center',
                                                        fontSize: 11,
                                                        color: '#4e5a53',
                                                    }}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={linkAll}
                                                        onChange={(e) => setLinkAll(e.target.checked)}
                                                    />
                                                    ربط <b>كل الأسطر {sameNameCount}</b> باسم «{line.name.trim()}» بنفس الصنف
                                                </label>
                                            ) : null}
                                            <Input
                                                aria-label="ابحث في المخزن لربط السطر"
                                                placeholder="ابحث في المخزن… مثال: سكر، دقيق"
                                                value={linkQuery}
                                                onChange={(e) => setLinkQuery(e.target.value)}
                                                autoFocus
                                            />
                                            <div className="bf-results">
                                                {linkQuery.trim().length >= 2 &&
                                                    (linkResults.data ?? []).map((item) => (
                                                        <button
                                                            key={String(item.id)}
                                                            type="button"
                                                            className="bf-result"
                                                            onClick={() => doLink(line, item.id)}
                                                        >
                                                            <span className="bf-result__name">{item.name}</span>
                                                            <span className="bf-result__meta">
                                                                {item.unit}
                                                                {item.perKg != null ? ` · ≈${item.perKg.toFixed(2)}/كجم` : ''}
                                                            </span>
                                                            <span className="bf-result__cost">{money(item.avgCost)}</span>
                                                        </button>
                                                    ))}
                                                {linkQuery.trim().length >= 2 &&
                                                (linkResults.data ?? []).length === 0 &&
                                                !linkResults.isPending ? (
                                                    <p style={{ padding: '10px 12px', fontSize: 11, color: '#87928b' }}>
                                                        لا أصناف مطابقة — تأكد من الاسم أو أضف الصنف في المخزن أولًا.
                                                    </p>
                                                ) : null}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ))}

                            {/* ═══ أزرار الصنف ═══ */}
                            <div className="bf-dish-actions">
                                <button
                                    type="button"
                                    className="bf-mini-btn bf-mini-btn--gold"
                                    onClick={() => printDishCard(openDish, { pro: proPrints })}
                                >
                                    🖨 كرت الصنف
                                </button>
                                {canWrite ? (
                                    <button type="button" className="bf-mini-btn" onClick={() => openEdit(openDish)}>
                                        ✎ تعديل الصنف
                                    </button>
                                ) : null}
                                {canDelete ? (
                                    <button
                                        type="button"
                                        className="bf-mini-btn bf-mini-btn--danger"
                                        disabled={deleteDish.isPending}
                                        onClick={() => {
                                            if (window.confirm(`حذف «${openDish.name}» نهائيًا من البوفيه؟ (يمكن إعادة إنشائه)`)) {
                                                deleteDish.mutate(
                                                    { id: openDish.id, name: openDish.name },
                                                    { onSuccess: () => setOpenDishId(null) },
                                                );
                                            }
                                        }}
                                    >
                                        {deleteDish.isPending ? 'جارٍ الحذف…' : '🗑 حذف'}
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    </aside>
                </>
            ) : null}

            {/* ═══ Dialog: مراجعة ربط المكونات بالمخزن ═══ */}
            <Dialog
                open={rematchOpen}
                onOpenChange={setRematchOpen}
                title="مراجعة ربط المكوّنات بالمخزن"
                size="lg"
                description="المحرك يحلل كل سطر بلا ربط ويقترح أقرب صنف مخزن مع درجته وسببه — أنت تراجع وتعتمد، ولا يُطبّق شيء دون إذنك."
                footer={
                    <div className="bf-dialog-foot">
                        <Button variant="secondary" onClick={() => setRematchOpen(false)}>
                            إغلاق
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={applyAllReady}
                            disabled={applyRematch.isPending || (rematchQuery.data?.summary.autoLines ?? 0) === 0}
                        >
                            {`تطبيق الجاهز (${rematchQuery.data?.summary.autoLines ?? 0} سطور)`}
                        </Button>
                        <Button onClick={applyRematchLinks} disabled={checkedCount === 0 || applyRematch.isPending}>
                            {applyRematch.isPending ? 'جارٍ الربط…' : `تطبيق المحدد (${checkedCount} سطور)`}
                        </Button>
                    </div>
                }
            >
                {rematchQuery.isLoading ? (
                    <StateLoading label="المحرك يحلل السطور بلا ربط…" />
                ) : rematchQuery.isError ? (
                    <StateError
                        title="تعذر تشغيل المحرك"
                        message={rematchQuery.error instanceof Error ? rematchQuery.error.message : 'تعذر الاتصال بالخادم'}
                        onRetry={() => void rematchQuery.refetch()}
                    />
                ) : (
                    <div className="bf-rematch">
                        <div className="bf-rematch__head">
                            <span className="bf-live">
                                <i className="bf-live__dot" aria-hidden="true" />
                                المحرك جاهز
                            </span>
                            <div className="bf-rematch__stats">
                                <span>
                                    <b>{rematchQuery.data?.summary.totalGroups ?? 0}</b> صنف فريد
                                </span>
                                <span>
                                    <b>{rematchQuery.data?.summary.autoLines ?? 0}</b> سطور بدرجة ≥0.8
                                </span>
                                <span>
                                    <b>{rematchQuery.data?.unlinkedBefore ?? 0}</b> سطر بلا ربط
                                </span>
                            </div>
                            <div className="bf-rematch__filters">
                                <select
                                    aria-label="فلتر الدرجة"
                                    className="erp-control"
                                    value={rematchFilter}
                                    onChange={(e) => setRematchFilter(e.target.value as 'all' | 'auto' | 'review')}
                                >
                                    <option value="all">الكل ({rematchQuery.data?.summary.totalGroups ?? 0})</option>
                                    <option value="auto">جاهزة للاعتماد ({rematchQuery.data?.summary.autoGroups ?? 0})</option>
                                    <option value="review">تتطلب مراجعة ({rematchQuery.data?.summary.reviewGroups ?? 0})</option>
                                </select>
                                <Input
                                    aria-label="ابحث في الاقتراحات"
                                    placeholder="ابحث عن مكوّن أو صنف مخزن…"
                                    value={rematchSearch}
                                    onChange={(e) => setRematchSearch(e.target.value)}
                                />
                                <button
                                    type="button"
                                    className="bf-mini-btn"
                                    onClick={() => {
                                        const next: Record<string, boolean> = {};
                                        for (const g of filteredGroups) {
                                            next[g.norm] = true;
                                        }
                                        setChecked((prev) => ({ ...prev, ...next }));
                                    }}
                                >
                                    اعتماد الظاهر
                                </button>
                            </div>
                        </div>
                        <div className="bf-rematch__list" role="list">
                            {filteredGroups.map((g) => {
                                const chosenId = choices[g.norm] ?? g.best?.inventoryId ?? '';
                                const options = [g.best, ...(g.alternatives ?? [])].filter(Boolean) as RematchBest[];
                                const chosen = options.find((o) => o.inventoryId === chosenId) ?? null;
                                return (
                                    <label key={g.norm} className={`bf-rematch-row${checked[g.norm] ? ' is-checked' : ''}`}>
                                        <input
                                            type="checkbox"
                                            checked={Boolean(checked[g.norm])}
                                            onChange={(e) => setChecked((p) => ({ ...p, [g.norm]: e.target.checked }))}
                                            aria-label={`اعتماد ${g.name}`}
                                        />
                                        <div className="bf-rematch-row__main">
                                            <div className="bf-rematch-row__head">
                                                <b>{g.name}</b>
                                                <span className="bf-rematch-row__count">{g.count} سطر</span>
                                            </div>
                                            <div className="bf-rematch-row__proposal">
                                                <select
                                                    className="erp-control"
                                                    value={chosenId}
                                                    onChange={(e) => setChoices((p) => ({ ...p, [g.norm]: e.target.value }))}
                                                    onClick={(e) => e.preventDefault()}
                                                    aria-label={`صنف المخزن المقترح لـ ${g.name}`}
                                                >
                                                    {options.map((o) => (
                                                        <option key={o.inventoryId} value={o.inventoryId}>
                                                            {o.name} — {o.avgCost != null ? `${o.avgCost} ر.س` : 'بلا سعر'} / {o.unit}
                                                        </option>
                                                    ))}
                                                </select>
                                                {chosen ? (
                                                    <span
                                                        className={`bf-score bf-score--${chosen.score >= 0.8 ? 'hi' : chosen.score >= 0.6 ? 'mid' : 'lo'}`}
                                                        title="درجة المطابقة"
                                                    >
                                                        {chosen.score.toFixed(2)}
                                                    </span>
                                                ) : null}
                                            </div>
                                            {chosen?.packKg ? (
                                                <div className="bf-rematch-row__pack">
                                                    عبوة معلومة الوزن {chosen.packKg} كجم — السعر للكيلو = العبوة ÷ {chosen.packKg}
                                                </div>
                                            ) : null}
                                            {chosen?.reasons?.length ? (
                                                <div className="bf-rematch-row__reasons">{chosen.reasons.join(' · ')}</div>
                                            ) : null}
                                        </div>
                                    </label>
                                );
                            })}
                            {filteredGroups.length === 0 ? (
                                <p className="bf-rematch__empty">لا مجموعات مطابقة — جرّب فلتر «الكل» أو امسح البحث.</p>
                            ) : null}
                        </div>
                    </div>
                )}
            </Dialog>

            {/* ═══ Dialog: إضافة/تعديل صنف + المساعد الشخصي ═══ */}
            <Dialog
                open={dishOpen}
                onOpenChange={setDishOpen}
                title={editingDish ? `تعديل «${editingDish.name}»` : 'صنف جديد للبوفيه'}
                size="lg"
                description="املأ الاسم والفئة — المساعد الشخصي يكمل الوصف والمكونات والقيم تلقائيًا من مصادر موثوقة (USDA SR Legacy)، وأنت تراجع قبل الحفظ."
                footer={
                    <div className="bf-dialog-foot">
                        <Button variant="secondary" onClick={() => setDishOpen(false)}>
                            إلغاء
                        </Button>
                        <Button onClick={saveDish} disabled={createDish.isPending || updateDish.isPending}>
                            {editingDish ? 'حفظ التعديلات' : 'إضافة الصنف'}
                        </Button>
                    </div>
                }
            >
                <div className="bf-form">
                    <div className="bf-form__row">
                        <Input
                            label="اسم الصنف *"
                            placeholder="مثال: ملوخية باللحم"
                            value={form.name}
                            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                        />
                        <Input
                            id="bf-name-en"
                            dir="ltr"
                            label="English name — for the global card"
                            placeholder="e.g. Molokhia with Lamb"
                            value={form.name_en}
                            onChange={(e) => setForm((p) => ({ ...p, name_en: e.target.value }))}
                        />
                    </div>
                    <div className="bf-form__row">
                        <div className="bf-field">
                            <label htmlFor="bf-cat-input" className="bf-label">
                                الفئة *
                            </label>
                            <Input
                                id="bf-cat-input"
                                list="bf-categories"
                                placeholder="اختر أو اكتب فئة جديدة"
                                value={form.category}
                                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                            />
                            <datalist id="bf-categories">
                                {categoryList.map((cat) => (
                                    <option key={cat} value={cat} />
                                ))}
                            </datalist>
                        </div>
                    </div>
                    <div className="bf-form__row">
                        <Input
                            label="مرات التكرار في الأسبوع"
                            type="number"
                            min={0}
                            max={14}
                            value={String(form.freq)}
                            onChange={(e) => setForm((p) => ({ ...p, freq: Number(e.target.value) || 0 }))}
                        />
                        <Input
                            label="الوعاء / العائد"
                            value={form.yields}
                            onChange={(e) => setForm((p) => ({ ...p, yields: e.target.value }))}
                        />
                    </div>
                    <div className="bf-field">
                        <label htmlFor="bf-desc" className="bf-label">
                            نبذة الصنف — يظهر على الكرت والسبورة
                        </label>
                        <textarea
                            id="bf-desc"
                            className="erp-control bf-textarea"
                            rows={2}
                            maxLength={600}
                            placeholder="وصف احترافي من ٢-٣ أسطر…"
                            value={form.description}
                            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                        />
                    </div>
                    <div className="bf-field">
                        <label htmlFor="bf-desc-en" className="bf-label">
                            English description — for the global card and guests
                        </label>
                        <textarea
                            id="bf-desc-en"
                            className="erp-control bf-textarea bf-textarea--en"
                            rows={2}
                            maxLength={600}
                            dir="ltr"
                            placeholder="Professional English description — 1–2 lines…"
                            value={form.description_en}
                            onChange={(e) => setForm((p) => ({ ...p, description_en: e.target.value }))}
                        />
                    </div>
                    <div className="bf-field">
                        <div className="bf-form__label-row">
                            <label className="bf-label">المكونات (وعاء سفنديش 5 سم)</label>
                            <button type="button" className="bf-ai-btn" onClick={() => void runAutofill()} disabled={autofilling}>
                                {autofilling ? '⏳ المساعد يعمل…' : '✨ أكمل بالمساعد الشخصي'}
                            </button>
                        </div>
                        <div className="bf-ing-rows">
                            {form.ingredients.map((ing, index) => (
                                <div key={index} className="bf-ing-row">
                                    <input
                                        className="erp-control"
                                        placeholder="اسم المكوّن"
                                        value={ing.name}
                                        onChange={(e) => updateIngredientRow(index, { name: e.target.value })}
                                        aria-label={`اسم المكوّن ${index + 1}`}
                                    />
                                    <input
                                        className="erp-control bf-ing-row__qty"
                                        type="number"
                                        min={0}
                                        step="any"
                                        value={String(ing.qty)}
                                        onChange={(e) => updateIngredientRow(index, { qty: Number(e.target.value) || 0 })}
                                        aria-label={`الكمية ${index + 1}`}
                                    />
                                    <select
                                        className="erp-control bf-ing-row__unit"
                                        value={ing.unit}
                                        onChange={(e) => updateIngredientRow(index, { unit: e.target.value })}
                                        aria-label={`الوحدة ${index + 1}`}
                                    >
                                        {UNITS.map((u) => (
                                            <option key={u} value={u}>
                                                {u}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        className="bf-ing-row__del"
                                        aria-label={`حذف المكوّن ${index + 1}`}
                                        onClick={() => removeIngredientRow(index)}
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                        <button type="button" className="bf-mini-btn" onClick={addIngredientRow}>
                            ＋ مكوّن
                        </button>
                        {draftNutrition ? (
                            <div className="bf-nutrition bf-nutrition--draft">
                                <div className="bf-nutrition__head">
                                    <span>معاينة القيم (حسب USDA — تقديري)</span>
                                </div>
                                <div className="bf-nutrition__grid">
                                    <div className="bf-nutrition__cell">
                                        <b>{safeNum(draftNutrition.perServing?.low?.kcal)}</b>
                                        <span>سعرات/حصة</span>
                                    </div>
                                    <div className="bf-nutrition__cell">
                                        <b>{numSigned(draftNutrition.perServing?.low?.protein ?? 0)}</b>
                                        <span>بروتين</span>
                                    </div>
                                    <div className="bf-nutrition__cell">
                                        <b>{numSigned(draftNutrition.perServing?.low?.carbs ?? 0)}</b>
                                        <span>كارب</span>
                                    </div>
                                    <div className="bf-nutrition__cell">
                                        <b>{numSigned(draftNutrition.perServing?.low?.fat ?? 0)}</b>
                                        <span>دهون</span>
                                    </div>
                                </div>
                                {draftNutrition.allergenLabels.length ? (
                                    <div className="bf-allergens">
                                        <b>⚠ المسببات:</b> {draftNutrition.allergenLabels.join(' · ')}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    <div className="bf-field">
                        <label htmlFor="bf-notes" className="bf-label">
                            ملاحظات المطبخ
                        </label>
                        <textarea
                            id="bf-notes"
                            className="erp-control bf-textarea"
                            rows={2}
                            maxLength={2000}
                            placeholder="خطوات التحضير، نقاط حرجة، بدائل…"
                            value={form.notes}
                            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                        />
                    </div>
                </div>
            </Dialog>
        </section>
    );
}

function isFullyPricedNote(d: BuffetDish): string {
    if (d.totalLines === 0) {
        return 'بدون مكونات؟';
    }
    if (d.unpricedLines === 0) {
        return 'مكتمل التسعير';
    }
    return `ناقص ${d.unpricedLines} سطر`;
}
