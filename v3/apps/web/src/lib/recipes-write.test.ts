import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createRecipe,
    deleteRecipe,
    RECIPE_DELETE_ROLES,
    RECIPE_WRITE_ROLES,
    recipeDeleteVisible,
    recipeWriteVisible,
    updateRecipe,
} from './recipes-write';

/**
 * كتابة الوصفات — العقد من `backend/schema-registry.js:436`:
 *   writeable: ['name', 'deptId', 'sellingPrice', 'totalCost', 'costRatio']
 *   required : ['name']
 *
 * `filterBody` (`schema-registry.js:630`) يُسقط ما خارج القائمة ويُرجع
 * 400 INVALID_PAYLOAD — فكل حقل يرسله العميل يجب أن يكون داخلها حرفيًّا.
 * `costRatio` يشتقّه الخادم عند حفظ المكونات
 * (`backend/cashier-module/shift-routes.js:568`) فلا يُرسل من هنا.
 */

vi.mock('./auth', () => ({ getAccessToken: () => 'test-token', getAppKey: () => null }));

/** نسخة حرفيّة من قائمة الخادم — أي انحراف عنها يظهر في الاختبار. */
const SERVER_WRITEABLE = ['name', 'deptId', 'sellingPrice', 'totalCost', 'costRatio'];

type FetchCall = { url: string; init: RequestInit };

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response): FetchCall[] {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown, init?: RequestInit) => {
            const request = init ?? {};
            calls.push({ url: String(input), init: request });
            return handler(String(input), request);
        }),
    );
    return calls;
}

function bodyOf(call: FetchCall | undefined): Record<string, unknown> {
    const raw = call?.init.body;
    return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الوصفات — الأدوار (أضيق من قائمة الخادم admin|manager|kitchen|sous_chef)', () => {
    it('قائمة الكتابة admin|manager وقائمة الحذف admin', () => {
        expect([...RECIPE_WRITE_ROLES]).toEqual(['admin', 'manager']);
        expect([...RECIPE_DELETE_ROLES]).toEqual(['admin']);
    });

    it('بوابات الظهور لا تُظهر زرًّا لغير المخوَّل', () => {
        expect(recipeWriteVisible('admin')).toBe(true);
        expect(recipeWriteVisible('manager')).toBe(true);
        expect(recipeWriteVisible('accountant')).toBe(false);
        expect(recipeWriteVisible('kitchen')).toBe(false);
        expect(recipeWriteVisible(null)).toBe(false);

        expect(recipeDeleteVisible('admin')).toBe(true);
        expect(recipeDeleteVisible('manager')).toBe(false);
        expect(recipeDeleteVisible('kitchen')).toBe(false);
    });
});

describe('الوصفات — حمولة الإنشاء', () => {
    it('POST /api/recipes بحقول الخادم لا snake_case', async () => {
        const calls = stubFetch(() => json({ id: 7 }, 201));
        await createRecipe({ name: '  شرائح الدجاج  ', deptId: 'KITCHEN', sellingPrice: 45, totalCost: 30 });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('/api/recipes');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({
            name: 'شرائح الدجاج',
            deptId: 'KITCHEN',
            sellingPrice: 45,
            totalCost: 30,
        });
    });

    it('كل مفتاح مرسل داخل قائمة الخادم المسموحة', async () => {
        const calls = stubFetch(() => json({ id: 7 }, 201));
        await createRecipe({ name: 'وصفة', deptId: null, sellingPrice: 10, totalCost: 5 });
        for (const key of Object.keys(bodyOf(calls[0]))) {
            expect(SERVER_WRITEABLE).toContain(key);
        }
    });

    it('لا حقل active ولا حقول snake_case — الخادم يرفضها بـ 400', async () => {
        const calls = stubFetch(() => json({ id: 7 }, 201));
        await createRecipe({ name: 'وصفة', deptId: null, sellingPrice: 10, totalCost: 5 });
        const body = bodyOf(calls[0]);
        expect(body).not.toHaveProperty('active');
        expect(body).not.toHaveProperty('selling_price');
        expect(body).not.toHaveProperty('total_cost');
        expect(body).not.toHaveProperty('department_code');
        expect(body).not.toHaveProperty('costRatio');
    });

    it('القسم الفارغ يُرسل null لا نصًا فارغًا', async () => {
        const calls = stubFetch(() => json({ id: 7 }, 201));
        await createRecipe({ name: 'وصفة', deptId: '   ', sellingPrice: 10, totalCost: 5 });
        expect(bodyOf(calls[0]).deptId).toBeNull();
    });
});

describe('الوصفات — حمولة التعديل', () => {
    it('PUT /api/recipes/:id بالحقول المُرسَلة فقط', async () => {
        const calls = stubFetch(() => json({ id: 7 }));
        await updateRecipe(7, { name: '  اسم جديد  ', sellingPrice: 55 });

        expect(calls[0]?.url).toBe('/api/recipes/7');
        expect(calls[0]?.init.method).toBe('PUT');
        expect(bodyOf(calls[0])).toEqual({ name: 'اسم جديد', sellingPrice: 55 });
    });

    it('لا حقول غائبة عن التحديث', async () => {
        const calls = stubFetch(() => json({ id: 7 }));
        await updateRecipe(7, { totalCost: 12 });
        expect(bodyOf(calls[0])).toEqual({ totalCost: 12 });
    });

    it('القسم الفارغ في التعديل يُرسل null', async () => {
        const calls = stubFetch(() => json({ id: 7 }));
        await updateRecipe(7, { deptId: '' });
        expect(bodyOf(calls[0])).toEqual({ deptId: null });
    });
});

describe('الوصفات — الحذف', () => {
    it('DELETE /api/recipes/:id بلا حمولة', async () => {
        const calls = stubFetch(() => json({ ok: true }));
        await deleteRecipe(7);
        expect(calls[0]?.url).toBe('/api/recipes/7');
        expect(calls[0]?.init.method).toBe('DELETE');
        expect(calls[0]?.init.body).toBeUndefined();
    });
});
