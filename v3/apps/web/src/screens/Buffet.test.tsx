import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Buffet } from './Buffet';

/**
 * كوست البوفيه — الخادم هو مصدر الحقيقة: كل الأرقام تُحسب من /api/buffet/overview
 * وقت الطلب. هذه الاختبارات تحاكي الاستجابة وتتحقق من العرض والتفاعل
 * (فتح السطر والربط) — بدون رقم واحد من اختراع الواجهة.
 */

const mocks = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'مدير النظام', username: 'test', role: mocks.role },
    }),
}));

const overview = {
    generatedAt: '2026-11-16T20:00:00.000Z',
    totals: { total: 2, pricedFull: 1, pricedPartial: 1, unpriced: 0, unpricedLineCount: 1, batchCostSum: 150 },
    dishes: [
        {
            id: 1,
            name: 'شوربة عدس',
            category: 'شوربات خفيفة (كلير)',
            freq: 2,
            yields: 'سفنديش 5 سم — تكفي 35–40 شخص',
            notes: '',
            batchCost: 100,
            pricedLines: 2,
            unpricedLines: 0,
            totalLines: 2,
            perPerson: { low: 2.5, high: 2.857, guestsLow: 35, guestsHigh: 40 },
            lines: [
                { id: 11, position: 1, name: 'عدس أصفر', qty: 1.5, unit: 'كيلو', state: 'ok', cost: 42.5, packUsed: false, avgCost: 28.33, inventoryId: 700, inventory: { id: 700, name: 'عدس احمر - كيس', unit: 'كيس', avgCost: 56.11 } },
                { id: 12, position: 2, name: 'ملح', qty: 2, unit: 'ملعقة كبيرة', state: 'ok', cost: 0.44, packUsed: true, avgCost: 0.44, packKg: 50, inventoryId: 710, inventory: { id: 710, name: 'ملح ناعم 50 كيلو-كيس', unit: 'كيس', avgCost: 22 } },
            ],
        },
        {
            id: 2,
            name: 'أرز مكسيكي',
            category: 'أرز',
            freq: 3,
            yields: 'سفنديش 5 سم — تكفي 35–40 شخص',
            notes: '',
            batchCost: 50,
            pricedLines: 1,
            unpricedLines: 1,
            totalLines: 2,
            perPerson: { low: 1.25, high: 1.428, guestsLow: 35, guestsHigh: 40 },
            lines: [
                { id: 21, position: 1, name: 'أرز بسمتي', qty: 3, unit: 'كيلو', state: 'ok', cost: 16.5, packUsed: true, avgCost: 5.5, packKg: 20, inventoryId: 720, inventory: { id: 720, name: 'ارز بسمتي20 كيلو بالشدة اليسرة', unit: 'شدة', avgCost: 110.05 } },
                { id: 22, position: 2, name: 'مرق دجاج صافي', qty: 4.75, unit: 'لتر', state: 'unlinked', cost: null, inventoryId: null },
            ],
        },
    ],
    week: [
        { day: 'السبت', meal: 'غداء', position: 1, dishId: 1, name: 'شوربة عدس', batchCost: 100, priced: true },
        { day: 'السبت', meal: 'غداء', position: 2, dishId: 2, name: 'أرز مكسيكي', batchCost: 50, priced: false },
    ],
    unpriced: [{ dish: 'أرز مكسيكي', name: 'مرق دجاج صافي', qty: 4.75, unit: 'لتر', state: 'unlinked' }],
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type RecordedCall = { url: string; method: string; body: Record<string, unknown> };

function stubFetch(): RecordedCall[] {
    const calls: RecordedCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const target = String(url);
        if (target.includes('/api/buffet/overview')) {return json(overview);}
        if (target.includes('/api/buffet/search')) {
            return json({ items: [{ id: 800, name: 'أرز بسمتي20 كيلو', unit: 'شدة', category: 'أرز', qty: 12, avgCost: 110.05, perKg: 5.5 }] });
        }
        if (target.includes('/api/buffet/ingredients/')) {
            calls.push({
                url: target,
                method: init?.method ?? 'GET',
                body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {},
            });
            return json({ ok: true, updated: 1 }, 200);
        }
        if (target.includes('/api/buffet/week/slot') && init?.method === 'DELETE') {
            calls.push({
                url: target,
                method: init?.method ?? 'GET',
                body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {},
            });
            return json({ ok: true }, 200);
        }
        if (target.includes('/api/buffet/dishes/autofill')) {
            return json({
                ok: true,
                draft: {
                    name: 'حلزونة',
                    category: 'أرز',
                    yields: 'سفنديش 5 سم — تكفي 35–40 شخص',
                    description: 'يوخ حقيقي بأرز بسمتي',
                    ingredients: [{ name: 'أرز بسمتي', qty: 3, unit: 'كيلو' }],
                    nutrition: {
                        totals: { kcal: 3000, protein: 50, carbs: 600, fat: 40, fiber: 15, sodium: 1000 },
                        perServing: { low: { kcal: 80, protein: 1.4, carbs: 17, fat: 1.1, fiber: 0.4, sodium: 27 }, high: { kcal: 91, protein: 1.6, carbs: 19.4, fat: 1.3, fiber: 0.5, sodium: 31 }, guestsLow: 35, guestsHigh: 40 },
                        allergens: [],
                        allergenLabels: [],
                        matchedCount: 1,
                        unmatched: [],
                        sourceNote: 'test',
                        unmatchedNote: null,
                    },
                    model: 'qwen-test',
                },
            });
        }
        if (target.endsWith('/api/buffet/dishes') && init?.method === 'POST') {
            calls.push({
                url: target,
                method: 'POST',
                body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {},
            });
            return json({ ok: true, id: 99 }, 201);
        }
        return json({ error: 'NOT_FOUND', message: target }, 404);
    }));
    return calls;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <Buffet />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

describe('كوست أصناف البوفيه', () => {
    it('يعرض المؤشرات الأربعة وأرقام الأصناف من استجابة الخادم', async () => {
        stubFetch();
        renderScreen();
        expect(await screen.findByText('شوربة عدس')).toBeTruthy();
        expect(screen.getByText('أرز مكسيكي')).toBeTruthy();
        expect(screen.getByText('كوست أصناف بوفيه الشرفة العالمي')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy(); // الأصناف
        expect(screen.getByText('1/2')).toBeTruthy(); // مُسعَّرة بالكامل
        expect(screen.getByText('150.00 ر.س')).toBeTruthy(); // تكلفة تشغيل الأسبوع
        expect(screen.getByText('100.00 ر.س')).toBeTruthy(); // تكلفة شوربة عدس
    });

    it('يفتح السطر عند النقر ويعرض المكوّنات بحالاتها', async () => {
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByText('أرز مكسيكي'));
        const drawer = await screen.findByRole('dialog', { name: /أرز مكسيكي/ });
        expect(within(drawer).getByText('مرق دجاج صافي')).toBeTruthy();
        expect(within(drawer).getByText('بدون ربط')).toBeTruthy();
        expect(within(drawer).getByText('أرز بسمتي')).toBeTruthy();
        expect(within(drawer).getByText('مسعر')).toBeTruthy();
    });

    it('يربط السطر بالمخزن عبر PUT على مسار ربط السطر', async () => {
        const calls = stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByText('أرز مكسيكي'));
        const drawer = await screen.findByRole('dialog', { name: /أرز مكسيكي/ });
        // زر الربط الثاني = السطر غير المرتبط «مرق دجاج صافي» (الترتيب حسب position)
        fireEvent.click(within(drawer).getAllByRole('button', { name: /ربط بالمخزن/ })[1] as HTMLElement);
        const input = within(drawer).getByLabelText('ابحث في المخزن لربط السطر');
        fireEvent.change(input, { target: { value: 'أرز' } });
        const item = await within(drawer).findByRole('button', { name: /أرز بسمتي20/ });
        fireEvent.click(item);
        await waitFor(() => {
            expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/api/buffet/ingredients/22/link'))).toBe(true);
        });
    });

    it('يبدّل تبويب خطة الأسبوع ويعرض تجميع الوجبة', async () => {
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('tab', { name: 'خطة الأسبوع' }));
        expect((await screen.findAllByText('غداء')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('السبت').length).toBeGreaterThan(0);
    });

    it('يحذف صنفًا من خانة الوجبة عبر زر ✕', async () => {
        const calls = stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('tab', { name: 'خطة الأسبوع' }));
        const del = await screen.findAllByRole('button', { name: /حذف شوربة عدس من غداء السبت/ });
        fireEvent.click(del[0] as HTMLElement);
        await waitFor(() => {
            expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/api/buffet/week/slot'))).toBe(true);
        });
    });

    it('يفتح نموذج الصنف ويملؤه المساعد الشخصي ويحفظ عبر POST', async () => {
        const calls = stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: '＋ صنف جديد' }));
        const dialog = await screen.findByRole('dialog', { name: /صنف جديد/ });
        fireEvent.change(within(dialog).getByLabelText(/اسم الصنف/), { target: { value: 'حلزونة' } });
        fireEvent.change(within(dialog).getByLabelText(/الفئة/), { target: { value: 'أرز' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /أكمل بالمساعد الشخصي/ }));
        await waitFor(() => {
            expect(within(dialog).getByDisplayValue('يوخ حقيقي بأرز بسمتي')).toBeTruthy();
        });
        fireEvent.click(within(dialog).getByRole('button', { name: 'إضافة الصنف' }));
        await waitFor(() => {
            expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/buffet/dishes'))).toBe(true);
        });
        const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/buffet/dishes'));
        expect(post?.body?.name).toBe('حلزونة');
        expect((post?.body?.ingredients as unknown[]).length).toBe(1);
    });
});
