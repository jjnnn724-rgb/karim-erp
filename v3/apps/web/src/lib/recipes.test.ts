import { describe, expect, it, vi } from 'vitest';
import {
    costRatioText,
    fetchRecipes,
    fetchRecipesCatalog,
    indexCatalog,
    type Recipe,
    type RecipeCatalogRow,
    recipeCatalogSchema,
    recipeSchema,
    recipeToRow,
    recipeTotals,
    searchRecipes,
} from './recipes';

/**
 * عقد الوصفات — مطابق لـ `frontend/app/js/v2/data/recipes-repo.js`:
 * السعر والتكلفة والنسبة من صفّ الوصفة وبها فراغًا من كتالوج الكاشير،
 * وعدد المكوّنات والصورة والربط من الكتالوج، ونسبة التكلفة نقاط مئوية
 * كما يخزّنها الخادم (24 ⇒ 24٪ لا 2400٪).
 */

function recipe(raw: Record<string, unknown>): Recipe {
    return recipeSchema.parse(raw);
}

function catalogRow(raw: Record<string, unknown>): RecipeCatalogRow {
    return recipeCatalogSchema.parse(raw);
}

const deptNames = new Map([
    ['external_sales', 'قسم البيع الخارجي'],
    ['kitchen', 'المطبخ'],
]);

const meat = recipe({
    id: 1,
    name: 'كبسة لحم',
    deptId: 'external_sales',
    sellingPrice: '20.00',
    totalCost: '0.00',
    costRatio: '0.00',
});

const kofta = recipe({
    id: 2,
    name: 'كفتة',
    deptId: 'kitchen',
    sellingPrice: '50.00',
    totalCost: '12.00',
    costRatio: '24.00',
});

const spare = recipe({ id: 3, name: '', deptId: null });

const catalog = indexCatalog([
    catalogRow({
        recipe_id: 1,
        name: 'كبسة لحم',
        sellingPrice: '20.00',
        totalCost: '0.00',
        costRatio: '0.00',
        product_id: 11,
        image_url: '/uploads/meat.png',
        ingredient_count: 3,
    }),
]);

describe('عقد الوصفات — الصفّ', () => {
    it('يحوّل الصفّ ويحلّ اسم القسم من دليل الأقسام', () => {
        expect(recipeToRow(meat, catalog, deptNames)).toEqual({
            id: '1',
            name: 'كبسة لحم',
            deptCode: 'external_sales',
            deptName: 'قسم البيع الخارجي',
            sellingPrice: '20.00',
            totalCost: '0.00',
            costRatio: 0,
            imageUrl: '/uploads/meat.png',
            productLinked: true,
            ingredients: 3,
        });
    });

    it('يطابق الرقم ويقبل id نصًا — والنسبة نقاط مئوية لا تُضرب', () => {
        const row = recipeToRow(recipe({ ...kofta, id: '2' }), catalog, deptNames);
        expect(row.id).toBe('2');
        expect(row.costRatio).toBe(24);
        expect(costRatioText(row.costRatio)).toBe('24.0%');
        expect(costRatioText(Number.NaN)).toBe('0.0%');
    });

    it('بلا كتالوج: لا صورة ولا ربط ولا مكوّنات، والسعر من الصفّ كما هو', () => {
        const row = recipeToRow(kofta, new Map(), deptNames);
        expect(row.productLinked).toBe(false);
        expect(row.ingredients).toBe(0);
        expect(row.imageUrl).toBe('');
        expect(row.sellingPrice).toBe('50.00');
        expect(row.deptName).toBe('المطبخ');
    });

    it('الاسم الغائب يأتي من الكتالوج ثم «—»، والقسم الغائب نصٌّ فارغ', () => {
        const fromCatalog = recipeToRow(spare, catalog, deptNames);
        expect(fromCatalog.name).toBe('—');
        expect(fromCatalog.deptName).toBe('');
        const named = recipeToRow(recipe({ id: 9 }), indexCatalog([catalogRow({ recipe_id: 9, name: 'شوربة' })]));
        expect(named.name).toBe('شوربة');
    });
});

describe('عقد الوصفات — المجاميع', () => {
    it('يعدّ المرتبط وغير المرتبط والأقسام والمكوّنات', () => {
        const rows = [meat, kofta, spare].map((item) => recipeToRow(item, catalog, deptNames));
        expect(recipeTotals(rows)).toEqual({
            total: 3,
            linked: 1,
            unlinked: 2,
            departmentCodes: ['external_sales', 'kitchen'],
            ingredients: 3,
        });
        expect(recipeTotals([])).toEqual({
            total: 0,
            linked: 0,
            unlinked: 0,
            departmentCodes: [],
            ingredients: 0,
        });
    });
});

describe('عقد الوصفات — البحث', () => {
    const rows = [meat, kofta, spare].map((item) => recipeToRow(item, catalog, deptNames));

    it('يطابق الاسم تامًّا أولًا ثم الاسم والقسم', () => {
        const exact = searchRecipes(rows, 'كفتة');
        expect(exact.rows.map((row) => row.id)).toEqual(['2']);
        expect(exact.exact).toBe(1);
        expect(searchRecipes(rows, 'البيع الخارجي').rows.map((row) => row.id)).toEqual(['1']);
        expect(searchRecipes(rows, 'kitchen').rows.map((row) => row.id)).toEqual(['2']);
    });

    it('يطبّع الحروف العربية ويعلن التطبيع', () => {
        const hit = searchRecipes(rows, 'كبسه');
        expect(hit.rows.map((row) => row.id)).toEqual(['1']);
        expect(hit.folded).toBe(true);
    });

    it('كل كلمة يجب أن تلاقي موضعًا، والبحث بلا كلمة يعيد الكل', () => {
        expect(searchRecipes(rows, 'كبسة خارجي').rows.map((row) => row.id)).toEqual(['1']);
        expect(searchRecipes(rows, 'كبسة المطبخ').rows).toEqual([]);
        const all = searchRecipes(rows, '  ');
        expect(all.rows).toHaveLength(3);
        expect(all.matched).toBe(false);
    });
});

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('عقد الوصفات — الجلب', () => {
    it('يمشي صفحات /api/recipes تصاعديًا بـid ويقف عند آخر صفحة', async () => {
        const urls: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                urls.push(String(url));
                if (String(url).includes('page=1')) {
                    return json({
                        data: Array.from({ length: 1000 }, (_, index) => ({ id: index + 1, name: 'وصفة' })),
                        pagination: { totalPages: 2 },
                    });
                }
                return json({ data: [{ id: 1001, name: 'أخيرة' }], pagination: { totalPages: 2 } });
            }),
        );
        try {
            const rows = await fetchRecipes();
            expect(rows).toHaveLength(1001);
            expect(urls[0]).toContain('page=1&limit=1000&sort=id&order=asc');
            expect(urls[1]).toContain('page=2&limit=1000&sort=id&order=asc');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('الكتالوج الفاشل يعود فارغًا ولا يُسقط السجل', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ error: 'FORBIDDEN', message: 'لا صلاحية' }, 403)),
        );
        try {
            await expect(fetchRecipesCatalog()).resolves.toEqual([]);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('الكتالوج الناجح يُقرأ مصفوفة أو {data}', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json([{ recipe_id: 1, ingredient_count: 2 }])),
        );
        try {
            const rows = await fetchRecipesCatalog();
            expect(rows).toHaveLength(1);
            const map = indexCatalog(rows);
            expect(map.get('1')?.ingredient_count).toBe(2);
        } finally {
            vi.unstubAllGlobals();
        }

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ data: [{ recipe_id: '4' }] })),
        );
        try {
            const rows = await fetchRecipesCatalog();
            expect(rows.map((row) => row.recipe_id)).toEqual(['4']);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
