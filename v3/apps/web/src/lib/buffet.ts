import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { useWriteMutation } from './write';

/**
 * buffet.ts — بيانات «كوست أصناف بوفيه الشرفة العالمي» من /api/buffet/*.
 *
 *  • GET /api/buffet/overview      — الحمولة الكاملة (الأصناف + التكلفة المحسوبة حيًّا من المخزن + خطة الأسبوع)
 *  • GET /api/buffet/search?q=     — بحث أصناف المخزن للربط (مع تقدير ر.س/كجم من التعبئة)
 *  • PUT /api/buffet/ingredients/:id/link      — ربط سطر واحد
 *  • PUT /api/buffet/ingredients/link-group    — ربط كل الأسطر بنفس الاسم الخام
 *  • DELETE /api/buffet/ingredients/:id/link   — فك الربط
 *
 * كل الأرقام القادمة من الخادم **محسوبة حيًّا من inventory.avgCost** وقت الطلب —
 * لا قيم ثابتة تُعرض هنا. أي سطر بلا تسعير يظهر بحالة واضحة، لا برقم مُقدَّر.
 */

const moneyValue = z.union([z.string(), z.number()]).transform((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
});
const nullableMoney = z.union([z.string(), z.number(), z.null()]).transform((v) => {
    if (v === null) {
        return null;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
});

export const buffetLineSchema = z.object({
    id: z.union([z.string(), z.number()]).nullable().optional(),
    position: z.number().nullable().optional(),
    name: z.string(),
    qty: moneyValue,
    unit: z.string(),
    state: z.enum(['ok', 'unlinked', 'unconvertible', 'no_price']),
    cost: nullableMoney,
    packUsed: z.boolean().optional(),
    avgCost: nullableMoney.optional(),
    packKg: nullableMoney.optional(),
    inventoryId: z.union([z.string(), z.number()]).nullable().optional(),
    inventory: z
        .object({ id: z.any().optional(), name: z.string(), unit: z.string(), avgCost: nullableMoney.optional() })
        .nullable()
        .optional(),
});
export type BuffetLine = z.infer<typeof buffetLineSchema>;

export const buffetNutritionSchema = z
    .object({
        totals: z
            .object({ kcal: moneyValue, protein: moneyValue, carbs: moneyValue, fat: moneyValue, fiber: moneyValue, sodium: moneyValue })
            .passthrough(),
        perServing: z
            .object({
                low: z
                    .object({
                        kcal: moneyValue,
                        protein: moneyValue,
                        carbs: moneyValue,
                        fat: moneyValue,
                        fiber: moneyValue,
                        sodium: moneyValue,
                    })
                    .passthrough()
                    .nullable()
                    .optional(),
                high: z
                    .object({
                        kcal: moneyValue,
                        protein: moneyValue,
                        carbs: moneyValue,
                        fat: moneyValue,
                        fiber: moneyValue,
                        sodium: moneyValue,
                    })
                    .passthrough()
                    .nullable()
                    .optional(),
                guestsLow: z.number().optional(),
                guestsHigh: z.number().optional(),
            })
            .passthrough(),
        allergens: z.array(z.string()),
        allergenLabels: z.array(z.string()),
        matchedCount: z.number().optional(),
        unmatched: z.array(z.string()),
        sourceNote: z.string().nullable().optional(),
        unmatchedNote: z.string().nullable().optional(),
    })
    .passthrough();
export type BuffetNutrition = z.infer<typeof buffetNutritionSchema>;

export const buffetDishSchema = z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    name_en: z.string().nullable().optional(),
    category: z.string(),
    freq: z.number(),
    yields: z.string(),
    notes: z.string(),
    description: z.string().nullable().optional(),
    description_en: z.string().nullable().optional(),
    nutrition: buffetNutritionSchema.nullable().optional(),
    batchCost: moneyValue,
    pricedLines: z.number(),
    unpricedLines: z.number(),
    totalLines: z.number(),
    perPerson: z
        .object({
            low: moneyValue,
            high: moneyValue,
            guestsLow: z.number(),
            guestsHigh: z.number(),
        })
        .nullable(),
    lines: z.array(buffetLineSchema),
});
export type BuffetDish = z.infer<typeof buffetDishSchema>;

export const buffetWeekEntrySchema = z.object({
    day: z.string(),
    meal: z.string(),
    position: z.number(),
    dishId: z.union([z.string(), z.number()]),
    name: z.string(),
    batchCost: moneyValue,
    priced: z.boolean(),
});
export type BuffetWeekEntry = z.infer<typeof buffetWeekEntrySchema>;

export const buffetOverviewSchema = z
    .object({
        ok: z.boolean().optional(),
        generatedAt: z.string(),
        totals: z.object({
            total: z.number(),
            pricedFull: z.number(),
            pricedPartial: z.number(),
            unpriced: z.number(),
            unpricedLineCount: z.number(),
            batchCostSum: moneyValue,
        }),
        dishes: z.array(buffetDishSchema),
        week: z.array(buffetWeekEntrySchema),
        unpriced: z
            .array(
                z.object({
                    dish: z.string(),
                    name: z.string(),
                    qty: moneyValue,
                    unit: z.string(),
                    state: z.string(),
                }),
            )
            .optional(),
    })
    .passthrough();
export type BuffetOverview = z.infer<typeof buffetOverviewSchema>;

export const inventorySearchItemSchema = z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    unit: z.string(),
    category: z.string().nullable().optional(),
    qty: moneyValue,
    avgCost: nullableMoney,
    perKg: nullableMoney,
});
export type InventorySearchItem = z.infer<typeof inventorySearchItemSchema>;
export const inventorySearchSchema = z.object({ ok: z.boolean().optional(), items: z.array(inventorySearchItemSchema) });

/** سطر بدون تسعير؟ */
export function isFullyPriced(dish: BuffetDish): boolean {
    return dish.totalLines > 0 && dish.unpricedLines === 0;
}

/** الحالة العامة للصنف — للشارة والفلتر */
export function dishStatus(dish: BuffetDish): 'priced' | 'partial' | 'unpriced' {
    if (dish.totalLines > 0 && dish.unpricedLines === 0) {
        return 'priced';
    }
    if (dish.pricedLines > 0) {
        return 'partial';
    }
    return 'unpriced';
}

/** تسمية حالة السطر */
export const LINE_STATE_AR: Record<BuffetLine['state'], string> = {
    ok: 'مسعر',
    unlinked: 'بدون ربط',
    unconvertible: 'بدون تحويل وحدة',
    no_price: 'بلا سعر في المخزن',
};

const idAsString = (v: string | number | null | undefined): string | null => (v == null ? null : String(v));

export async function fetchBuffetOverview(signal?: AbortSignal): Promise<BuffetOverview> {
    return fetchJson(buffetOverviewSchema, '/api/buffet/overview', getAccessToken(), signal ? { signal } : {});
}

/** ─── إدارة الأصناف ─────────────────────────────────────────────── */

export const dishPayloadSchema = z.object({
    name: z.string().trim().min(1, 'اكتب اسم الصنف'),
    name_en: z.string().trim().default(''),
    category: z.string().trim().min(1, 'اختر الفئة'),
    freq: z.coerce.number().int().min(0).default(1),
    yields: z.string().trim().default('سفنديش 5 سم — تكفي 35–40 شخص'),
    notes: z.string().trim().default(''),
    description: z.string().trim().default(''),
    description_en: z.string().trim().default(''),
    ingredients: z
        .array(
            z
                .object({
                    id: z.union([z.string(), z.number()]).nullish(),
                    name: z.string().trim().min(1),
                    qty: z.coerce.number().min(0),
                    unit: z.string().trim().min(1),
                    inventoryId: z.union([z.string(), z.number()]).nullable().optional(),
                    packKg: z.coerce.number().min(0).nullable().optional(),
                })
                .passthrough(),
        )
        .default([]),
});
export type DishPayload = z.infer<typeof dishPayloadSchema>;

export const autofillDraftSchema = z
    .object({
        ok: z.boolean().optional(),
        draft: z
            .object({
                name: z.string(),
                category: z.string().nullable().optional(),
                yields: z.string().default(''),
                description: z.string().default(''),
                ingredients: z.array(z.object({ name: z.string(), qty: moneyValue, unit: z.string() }).passthrough()),
                nutrition: z
                    .object({
                        totals: z
                            .object({
                                kcal: moneyValue,
                                protein: moneyValue,
                                carbs: moneyValue,
                                fat: moneyValue,
                                fiber: moneyValue,
                                sodium: moneyValue,
                            })
                            .passthrough(),
                        perServing: z
                            .object({ low: z.any(), high: z.any(), guestsLow: z.number().optional(), guestsHigh: z.number().optional() })
                            .passthrough(),
                        allergens: z.array(z.string()),
                        allergenLabels: z.array(z.string()),
                        matchedCount: z.number().optional(),
                        unmatched: z.array(z.string()),
                        sourceNote: z.string().nullable().optional(),
                        unmatchedNote: z.string().nullable().optional(),
                    })
                    .passthrough(),
                model: z.string().nullable().optional(),
            })
            .passthrough(),
    })
    .passthrough();
export type AutofillResponse = z.infer<typeof autofillDraftSchema>;
export type AutofillDraft = AutofillResponse['draft'];

export async function autofillDish(input: { name: string; category?: string; yields?: string }): Promise<AutofillResponse> {
    return fetchJson(autofillDraftSchema, '/api/buffet/dishes/autofill', getAccessToken(), {
        method: 'POST',
        body: input,
    });
}

export function useBuffetCreateDishMutation() {
    return useWriteMutation<DishPayload, { id: string | number }>({
        mutationFn: async (payload) => {
            const r = await fetchJson(
                z.object({ ok: z.boolean().optional(), id: z.union([z.string(), z.number()]) }).passthrough(),
                '/api/buffet/dishes',
                getAccessToken(),
                {
                    method: 'POST',
                    body: payload,
                },
            );
            return { id: r.id };
        },
        successTitle: 'أُضيف الصنف إلى البوفيه',
        invalidate: [['buffet', 'overview']],
    });
}

export function useBuffetUpdateDishMutation() {
    return useWriteMutation<{ id: string | number } & DishPayload, void>({
        mutationFn: async ({ id, ...payload }) => {
            await fetchJson(z.object({ ok: z.boolean().optional() }).passthrough(), `/api/buffet/dishes/${id}`, getAccessToken(), {
                method: 'PUT',
                body: payload,
            });
        },
        successTitle: 'حُفظت تعديلات الصنف',
        invalidate: [['buffet', 'overview']],
    });
}

export function useBuffetDeleteDishMutation() {
    return useWriteMutation<{ id: string | number; name?: string }, void>({
        mutationFn: async ({ id }) => {
            await fetchJson(z.object({ ok: z.boolean().optional() }).passthrough(), `/api/buffet/dishes/${id}`, getAccessToken(), {
                method: 'DELETE',
            });
        },
        successTitle: ({ name }: { name?: string }) => (name ? `حُذف «${name}» من البوفيه` : 'حُذف الصنف'),
        invalidate: [['buffet', 'overview']],
    });
}

/** ─── محرك الربط الآلي ─────────────────────────────────────────── */

export const rematchBestSchema = z
    .object({
        inventoryId: z.union([z.string(), z.number()]).transform((v) => String(v)),
        name: z.string(),
        unit: z.string(),
        avgCost: nullableMoney,
        score: moneyValue,
        reasons: z.array(z.string()).default([]),
        packKg: nullableMoney,
    })
    .passthrough();
export type RematchBest = z.infer<typeof rematchBestSchema>;

export const rematchGroupSchema = z
    .object({
        name: z.string(),
        norm: z.string(),
        count: z.number(),
        lines: z.array(z.union([z.string(), z.number()]).transform((v) => Number(v))),
        best: rematchBestSchema.nullable(),
        alternatives: z.array(rematchBestSchema).default([]),
        autoApply: z.boolean(),
    })
    .passthrough();
export type RematchGroup = z.infer<typeof rematchGroupSchema>;

export const rematchResultSchema = z
    .object({
        ok: z.boolean().optional(),
        dryRun: z.boolean().optional(),
        threshold: z.number(),
        generatedAt: z.string(),
        inventoryCount: z.number(),
        unlinkedBefore: z.number(),
        summary: z.object({
            totalGroups: z.number(),
            autoGroups: z.number(),
            autoLines: z.number(),
            reviewGroups: z.number(),
        }),
        groups: z.array(rematchGroupSchema),
    })
    .passthrough();
export type RematchResponse = z.infer<typeof rematchResultSchema>;

export async function fetchBuffetRematch(): Promise<RematchResponse> {
    return fetchJson(rematchResultSchema, '/api/buffet/rematch', getAccessToken(), { method: 'POST', body: {} });
}

export interface RematchLinkInput {
    name: string;
    inventoryId: string | number;
    lines: number[];
    rule: string;
    score?: number | undefined;
    packKg?: number | null | undefined;
}

export function useBuffetRematchApplyMutation() {
    return useWriteMutation<{ links: RematchLinkInput[] }, { applied: number; skipped: Array<{ reason?: string }> }>({
        mutationFn: async (input) => {
            const r = await fetchJson(
                z.object({ ok: z.boolean().optional(), applied: z.number(), skipped: z.array(z.any()).default([]) }).passthrough(),
                '/api/buffet/rematch/apply',
                getAccessToken(),
                { method: 'POST', body: input },
            );
            return { applied: r.applied, skipped: r.skipped };
        },
        successTitle: (vars) => `تم الربط — ${vars.links.reduce((sum, l) => sum + (l.lines?.length ?? 0), 0)} سطر`,
        invalidate: [['buffet', 'overview']],
    });
}
export function useBuffetAddWeekSlotMutation() {
    return useWriteMutation<{ day: string; meal: string; dishId: string | number }, void>({
        mutationFn: async ({ day, meal, dishId }) => {
            await fetchJson(
                z.object({ ok: z.boolean().optional(), position: z.number().optional() }).passthrough(),
                '/api/buffet/week/slot',
                getAccessToken(),
                {
                    method: 'POST',
                    body: { day, meal, dishId: Number(dishId) },
                },
            );
        },
        successTitle: 'أُضيف الصنف للوصفة',
        invalidate: [['buffet', 'overview']],
    });
}

export function useBuffetRemoveWeekSlotMutation() {
    return useWriteMutation<{ day: string; meal: string; dishId: string | number }, void>({
        mutationFn: async ({ day, meal, dishId }) => {
            await fetchJson(z.object({ ok: z.boolean().optional() }).passthrough(), '/api/buffet/week/slot', getAccessToken(), {
                method: 'DELETE',
                body: { day, meal, dishId: Number(dishId) },
            });
        },
        successTitle: 'أُزيل الصنف من الوجبة',
        invalidate: [['buffet', 'overview']],
    });
}

export async function searchInventoryForLink(q: string, signal?: AbortSignal): Promise<InventorySearchItem[]> {
    if (q.trim().length < 2) {
        return [];
    }
    const r = await fetchJson(
        inventorySearchSchema,
        `/api/buffet/search?q=${encodeURIComponent(q.trim())}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
    return r.items;
}

/** ربط سطر واحد بصنف مخزن (مع pack_kg تلقائي من الخادم عندما يلزم). */
export function useBuffetLinkMutation() {
    return useWriteMutation<{ lineId: string | number; inventoryId: string | number | null; packKg?: number | null }, void>({
        mutationFn: async ({ lineId, inventoryId, packKg }) => {
            await fetchJson(
                z.object({ ok: z.boolean().optional() }).passthrough(),
                `/api/buffet/ingredients/${lineId}/link`,
                getAccessToken(),
                {
                    method: 'PUT',
                    body: { inventoryId: idAsString(inventoryId), ...(packKg != null ? { packKg } : {}) },
                },
            );
        },
        successTitle: 'تم ربط السطر بالمخزن',
        invalidate: [['buffet', 'overview']],
    });
}

/** ربط كل الأسطر التي تحمل نفس الاسم الخام. */
export function useBuffetLinkGroupMutation() {
    return useWriteMutation<{ name: string; inventoryId: string | number | null }, { updated: number }>({
        mutationFn: async ({ name, inventoryId }) => {
            const r = await fetchJson(
                z.object({ ok: z.boolean().optional(), updated: z.number().optional() }).passthrough(),
                '/api/buffet/ingredients/link-group',
                getAccessToken(),
                {
                    method: 'PUT',
                    body: { name, inventoryId: idAsString(inventoryId) },
                },
            );
            return { updated: Number(r.updated) || 0 };
        },
        successTitle: 'تم ربط كل الأسطر',
        invalidate: [['buffet', 'overview']],
    });
}

/** فك ربط سطر. */
export function useBuffetUnlinkMutation() {
    return useWriteMutation<{ lineId: string | number }, void>({
        mutationFn: async ({ lineId }) => {
            await fetchJson(
                z.object({ ok: z.boolean().optional() }).passthrough(),
                `/api/buffet/ingredients/${lineId}/link`,
                getAccessToken(),
                { method: 'DELETE' },
            );
        },
        successTitle: 'فُك الربط',
        invalidate: [['buffet', 'overview']],
    });
}
