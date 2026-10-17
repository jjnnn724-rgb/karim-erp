/**
 * v2-recipes-write.test.js — عقد دورة الوصفات في V2 (كتابة كاملة)
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-returns.test.js: المستودع يُحمَّل في vm وبوابته
 * apiFetch مزيفة، والشاشة تُقرأ كعقد مصدر (testEnvironment:'node').
 *
 * المثبَّت هنا:
 *   • الفصل البنيوي: data/recipes-repo.js يبقى قراءةً خالصة (يفرضه
 *     v2-registers.test.js:74)، والكتابة في data/recipes-edit-repo.js وحده —
 *     نفس تفريق finance-repo عن dept-detail.
 *   • ثوابت الأدوار مرايا الخادم: OPEN_ENTITY_WRITE_ROLES.recipes
 *     (schema-registry.js:791) وrequireRole على مسارات المكوّنات والصورة
 *     الأربعة (shift-routes.js:295/:320/:362/:411) وقارئاتها.
 *   • خريطة الأسماء المستعارة للوحدات مرآةً حرفية لـ backend/unit-conversion.js:8
 *     — تُستخدم لتطبيع الوحدة الافتراضية فقط، بلا أي تحويل في المتصفح.
 *   • costRatio نسبةٌ مئوية في العمود (NUMERIC(10,2)، shift-routes.js:482):
 *     الإدخال يُحسب (cost/price*100) والعرض لا يضربه في 100 مرة ثانية —
 *     الخلل القديم كان يُظهر 3000% لوصفة 30%.
 *   • الأبواب: POST/PUT/DELETE /recipes، وsync-legacy، والمكوّنات، والوحدات،
 *     والمخزون، والصورة (multipart بـ fetch خام + رأس المصادقة).
 *   • الشاشة: لا fetch ولا apiFetch ولا معالج سطري، حارس isConnected، destroy،
 *     بلا ادعاء «قراءة فقط»، وطباعة واحدة وwindow.confirm واحدة كسقوط احتياطي.
 *   • الأرقام قرار الخادم: لا حساب تكلفة سطر ولا معامل تحويل في الشاشة.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const EDIT_REPO = path.join(V2, 'data', 'recipes-edit-repo.js');
const READ_REPO = path.join(V2, 'data', 'recipes-repo.js');
const SCREEN = path.join(V2, 'screens', 'recipes.js');
const HOST = path.join(V2, 'preview.js');
const V2_HTML = path.join(APP, 'v2.html');
const ICONS = path.join(APP, 'js', 'icons.js');
const LEGACY = path.join(APP, 'js', 'features', 'kitchen.js');
const SR = path.join(__dirname, '..', 'backend', 'schema-registry.js');
const SHIFT = path.join(__dirname, '..', 'backend', 'cashier-module', 'shift-routes.js');
const UC = path.join(__dirname, '..', 'backend', 'unit-conversion.js');
const OPS_CSS = path.join(APP, 'css', 'v2', 'erp-dashboard.css');

/** المراجعة مشتقة من الوسم الحيّ في v2.html — مصدر واحد للحقيقة. */
const REV = (fs.readFileSync(V2_HTML, 'utf8').match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

const EXPORTS = ['RECIPE_WRITE_ROLES', 'RECIPE_BOM_ROLES', 'UNIT_ALIASES',
    'normalizeRecipeUnit', 'costRatioPercent', 'recipePayload',
    'createRecipe', 'updateRecipe', 'removeRecipe', 'syncRecipeToCashier',
    'fetchProductIngredients', 'fetchRecipeInventory', 'fetchRecipeUnits',
    'saveProductIngredients', 'uploadProductImage', 'removeProductImage',
    'ingredientLine', 'newIngredientLine', 'defaultUnitFor'];

const source = (f) => fs.readFileSync(f, 'utf8');

function loadEsm(file, injections = {}, collect = []) {
    const stripped = source(file)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl, encodeURIComponent, URLSearchParams,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoStub(impl, extra = {}) {
    const calls = [];
    const bodies = [];
    const methods = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push(p);
        methods.push(opts && opts.method);
        if (opts && opts.body) {bodies.push({ path: p, body: opts.body, method: opts.method });}
        return typeof impl === 'function' ? impl(p, opts) : impl;
    });
    const repo = loadEsm(EDIT_REPO, { apiFetch, ...extra }, EXPORTS);
    return { calls, bodies, methods, repo };
}

describe('recipes-edit-repo — الفصل البنيوي وأسماء الأبواب', () => {
    test('كل ما تستورده الشاشة مُصدَّر فعلًا', () => {
        const src = source(EDIT_REPO);
        for (const name of EXPORTS) {
            expect(src).toMatch(new RegExp(`export (async function|function|const) ${name}\\b`));
        }
    });

    test('recipes-repo يبقى قراءةً خالصة — والكتابة هنا وحدها', () => {
        const read = source(READ_REPO);
        expect(read).not.toMatch(/method:\s*'(POST|PUT|DELETE)'/);
        expect(read).not.toMatch(/\bfetch\s*\(/);
        expect(source(EDIT_REPO)).toMatch(/method:\s*'(POST|PUT|DELETE)'/);
    });

    test('قوائم الأدوار مرايا الخادم — ولا دور خارجها', () => {
        const { repo } = repoStub({});
        expect(repo.RECIPE_WRITE_ROLES).toEqual(['admin', 'manager', 'kitchen', 'sous_chef']);
        expect(source(SR)).toMatch(/recipes:\s*\['admin', 'manager', 'kitchen', 'sous_chef'\],/);
        expect([...repo.RECIPE_BOM_ROLES].sort()).toEqual(['admin', 'manager']);
        const shift = source(SHIFT);
        for (const line of [
            "router.get('/recipe-units', jwtAuth, requireRole('manager','admin','auditor')",
            "router.get('/recipes/catalog', jwtAuth, requireRole('manager','admin','auditor','kitchen','sous_chef')",
            "router.get('/ingredients', jwtAuth, requireRole('manager','admin')",
            "router.post('/recipes/sync-legacy', jwtAuth, requireRole('manager','admin')",
            "router.get('/products/:id/ingredients', jwtAuth, requireRole('manager','admin','auditor')",
            "router.put('/products/:id/ingredients', jwtAuth, requireRole('manager','admin')",
            "router.post('/products/:id/image', jwtAuth, requireRole('manager','admin')",
            "router.delete('/products/:id/image', jwtAuth, requireRole('manager','admin')",
        ]) {expect(shift).toContain(line);}
        // المطبخ يكتب الوصفة لكن لا يلمس مكوّناتها (أدوار وحدة الكاشير ليست له)
        expect(repo.RECIPE_WRITE_ROLES).toContain('kitchen');
        expect(repo.RECIPE_BOM_ROLES).not.toContain('kitchen');
        for (const outsider of ['cashier', 'warehouse', 'hr', 'accountant', 'auditor', 'dept_head', '']) {
            expect(repo.RECIPE_WRITE_ROLES).not.toContain(outsider);
            expect(repo.RECIPE_BOM_ROLES).not.toContain(outsider);
        }
    });
});

describe('recipes-edit-repo — الوحدات: مرآة الخادم بلا تحويل', () => {
    test('UNIT_ALIASES مرآة حرفية لـ ALIASES في backend/unit-conversion.js', () => {
        const pick = (src, name) => (src.match(new RegExp(`const ${name} = (\\{[^}]*\\});`)) || [])[1];
        const mine = pick(source(EDIT_REPO), 'UNIT_ALIASES');
        const theirs = pick(source(UC), 'ALIASES');
        expect(mine).toBeTruthy();
        expect(theirs).toBeTruthy();
        expect(mine).toBe(theirs);
    });

    test('normalizeRecipeUnit: الأسماء المستعارة والمجهول يبقى كما هو', () => {
        const { repo } = repoStub({});
        expect(repo.normalizeRecipeUnit(' كيلو ')).toBe('kg');
        expect(repo.normalizeRecipeUnit('KG')).toBe('kg');
        expect(repo.normalizeRecipeUnit('جرام')).toBe('g');
        expect(repo.normalizeRecipeUnit('حبة')).toBe('piece');
        expect(repo.normalizeRecipeUnit('كرتون')).toBe('كرتون');
        expect(repo.normalizeRecipeUnit('')).toBe('piece');
        expect(repo.normalizeRecipeUnit(null)).toBe('piece');
    });

    test('defaultUnitFor: وحدة المخزون إن كانت من وحدات الخادم، وإلا قطعة', () => {
        const { repo } = repoStub({});
        const units = [{ value: 'g' }, { value: 'kg' }, { value: 'piece' }];
        expect(repo.defaultUnitFor({ unit: 'كجم' }, units)).toBe('kg');
        expect(repo.defaultUnitFor({ unit: 'كرتون' }, units)).toBe('piece');
        expect(repo.defaultUnitFor({ unit: 'لتر' }, [{ value: 'l' }])).toBe('l');
        expect(repo.defaultUnitFor({ unit: 'كرتون' }, [{ value: 'g' }])).toBe('g');
        expect(repo.defaultUnitFor(null, units)).toBe('piece');
    });

    test('الشاشة لا تحوّل ولا تحسب: لا معامل كثافة ولا دالة تحويل', () => {
        const s = source(SCREEN);
        expect(s).not.toMatch(/convertQuantity|density|كثافة/);
        expect(s).not.toMatch(/avgCost|avg_cost/);
    });
});

describe('recipes-edit-repo — الحمولات والأرقام', () => {
    test('costRatio نسبةٌ مئوية مقرَّبة لخانتين (عمود NUMERIC(10,2))', () => {
        const { repo } = repoStub({});
        expect(repo.costRatioPercent(1000, 300)).toBe(30);
        expect(repo.costRatioPercent('1000', '300')).toBe(30);
        expect(repo.costRatioPercent(1000, 333.3333)).toBe(33.33);
        expect(repo.costRatioPercent(0, 300)).toBe(0);
        expect(repo.costRatioPercent(null, null)).toBe(0);
    });

    test('recipePayload: الحقول المسموحة وحدها، بلا id وبلا حقل مخترَع', () => {
        const { repo } = repoStub({});
        const p = repo.recipePayload({ name: '  بيتزا  ', deptId: ' kitchen ', sellingPrice: '1000', totalCost: '300', id: 99, evil: 1 });
        expect(p).toEqual({ name: 'بيتزا', deptId: 'kitchen', sellingPrice: 1000, totalCost: 300, costRatio: 30 });
        expect(p).not.toHaveProperty('id');
        expect(p).not.toHaveProperty('evil');
        const bare = repo.recipePayload({ name: 'x' });
        expect(bare).toEqual({ name: 'x', sellingPrice: 0, totalCost: 0, costRatio: 0 });
        expect(bare).not.toHaveProperty('deptId');   // لا نص فارغ يُكتب في العمود
    });

    test('صف المكوّن: الأرقام كما ترد، والغائب null لا صفر', () => {
        const { repo } = repoStub({});
        const line = repo.ingredientLine({
            inventory_id: '5', inventory_name: 'طماطم', inventory_unit: 'كجم',
            quantity_per_unit: '2.5', unit: 'kg', waste_percent: '5',
            extended_cost: '41.2', unit_error: null, id: 7, product_id: 3,
        });
        expect(line).toEqual({
            inventory_id: 5, inventory_name: 'طماطم', inventory_unit: 'كجم',
            quantity_per_unit: 2.5, unit: 'kg', waste_percent: 5,
            extended_cost: 41.2, unit_error: null,
        });
        const sparse = repo.ingredientLine({ inventory_id: 9, quantity_per_unit: 1 });
        expect(sparse.extended_cost).toBeNull();
        expect(sparse.unit_error).toBeNull();
        expect(sparse.unit).toBe('piece');
        const broken = repo.ingredientLine({ inventory_id: 9, unit_error: 'وحدات غير متوافقة' });
        expect(broken.unit_error).toBe('وحدات غير متوافقة');
    });

    test('سطر مكوّن جديد: كمية 1 وهدر 0 ووحدة المخزون المطبَّعة', () => {
        const { repo } = repoStub({});
        const line = repo.newIngredientLine({ id: '4', name: 'أرز', unit: 'كجم' }, [{ value: 'kg' }, { value: 'piece' }]);
        expect(line).toEqual({
            inventory_id: 4, inventory_name: 'أرز', inventory_unit: 'كجم',
            quantity_per_unit: 1, unit: 'kg', waste_percent: 0,
            extended_cost: null, unit_error: null,
        });
    });
});

describe('recipes-edit-repo — أبواب الشبكة', () => {
    test('الإنشاء: POST /recipes بحمولة الخادم، والاسم وحده مطلوب', async () => {
        const c = repoStub({ id: 12 });
        const saved = await c.repo.createRecipe({ name: 'شاورما', deptId: 'kitchen', sellingPrice: 20, totalCost: 7 });
        expect(c.calls).toEqual(['/recipes']);
        expect(c.methods).toEqual(['POST']);
        expect(JSON.parse(c.bodies[0].body)).toEqual({ name: 'شاورما', deptId: 'kitchen', sellingPrice: 20, totalCost: 7, costRatio: 35 });
        expect(saved).toEqual({ id: 12 });
        await expect(c.repo.createRecipe({ name: '   ' })).rejects.toThrow('أدخل اسم الوصفة');
        expect(c.calls).toHaveLength(1);   // لم تخرج شبكة بلا اسم
    });

    test('التعديل والحذف: المعرّف مُشفَّرًا في المسار — ولا حمولة في الحذف', async () => {
        const u = repoStub({});
        await u.repo.updateRecipe('7/8', { name: 'x', sellingPrice: 1, totalCost: 1 });
        expect(u.calls).toEqual(['/recipes/7%2F8']);
        expect(u.methods).toEqual(['PUT']);
        expect(JSON.parse(u.bodies[0].body)).toEqual({ name: 'x', sellingPrice: 1, totalCost: 1, costRatio: 100 });
        await expect(u.repo.updateRecipe(3, { name: '' })).rejects.toThrow('أدخل اسم الوصفة');

        const d = repoStub({});
        await d.repo.removeRecipe('7');
        expect(d.calls).toEqual(['/recipes/7']);
        expect(d.methods).toEqual(['DELETE']);
        expect(d.bodies).toHaveLength(0);
    });

    test('مزامنة الكاشير: recipe_id رقمًا، والصنف يعود أو null', async () => {
        const s = repoStub({ recipe_id: 3, product: { id: 55, image_url: '/uploads/menu/a.png' }, synced: true });
        const product = await s.repo.syncRecipeToCashier('3');
        expect(s.calls).toEqual(['/pos/recipes/sync-legacy']);
        expect(s.methods).toEqual(['POST']);
        expect(JSON.parse(s.bodies[0].body)).toEqual({ recipe_id: 3 });
        expect(product).toEqual({ id: 55, image_url: '/uploads/menu/a.png' });
        const none = repoStub({ recipe_id: 3, synced: false });
        expect(await none.repo.syncRecipeToCashier(3)).toBeNull();
    });

    test('قراءات المكوّنات والمخزون والوحدات: مساراتها وضغط غير المصفوفة', async () => {
        const r = repoStub({});
        expect(await r.repo.fetchProductIngredients('9')).toEqual([]);
        expect(await r.repo.fetchRecipeInventory()).toEqual([]);
        expect(await r.repo.fetchRecipeUnits()).toEqual([]);
        expect(r.calls).toEqual(['/pos/products/9/ingredients', '/pos/ingredients', '/pos/recipe-units']);
        expect(await repoStub({ data: [{ id: 1 }] }).repo.fetchRecipeInventory()).toEqual([]);
        expect(await repoStub([{ id: 1 }]).repo.fetchProductIngredients(1)).toEqual([{ id: 1 }]);
    });

    test('حفظ المكوّنات: PUT بسطور مُطبَّعة — notes دائمًا null', async () => {
        const s = repoStub({ product_id: 9, ingredient_count: 2, total_cost: 41.5 });
        const res = await s.repo.saveProductIngredients(9, [
            { inventory_id: '3', quantity_per_unit: '2.5', unit: 'kg', waste_percent: '5', notes: 'مهمَل' },
            { inventory_id: 4, quantity_per_unit: 1 },
        ]);
        expect(s.calls).toEqual(['/pos/products/9/ingredients']);
        expect(s.methods).toEqual(['PUT']);
        expect(JSON.parse(s.bodies[0].body)).toEqual({ ingredients: [
            { inventory_id: 3, quantity_per_unit: 2.5, unit: 'kg', waste_percent: 5, notes: null },
            { inventory_id: 4, quantity_per_unit: 1, unit: 'piece', waste_percent: 0, notes: null },
        ] });
        expect(res).toEqual({ product_id: 9, ingredient_count: 2, total_cost: 41.5 });
    });

    test('صورة الصنف: multipart بـ fetch خام ورأس المصادقة بلا Content-Type', async () => {
        const win = { location: { origin: 'http://srv' }, _jwt: 'T', _appKey: 'K' };
        const file = Object.assign(new Blob(['x'], { type: 'image/png' }), { name: 'a.png' });
        const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ id: 9, image_url: '/uploads/menu/x.png' }) }));
        const r = repoStub({}, { window: win, API_BASE: 'http://srv/api', FormData, Blob, fetch: fetchMock });
        const up = await r.repo.uploadProductImage(9, file);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('http://srv/api/pos/products/9/image');
        expect(opts.method).toBe('POST');
        expect(opts.headers.Authorization).toBe('Bearer T');
        expect(opts.headers['x-api-key']).toBe('K');
        expect(opts.headers['Content-Type']).toBeUndefined();
        expect(opts.body).toBeInstanceOf(FormData);
        expect(up).toEqual({ id: 9, image_url: '/uploads/menu/x.png' });

        const fail = jest.fn(async () => ({ ok: false, json: async () => ({ error: 'IMAGE_REQUIRED', message: 'اختر صورة للصنف أولاً' }) }));
        const f = repoStub({}, { window: win, API_BASE: 'http://srv/api', FormData, Blob, fetch: fail });
        await expect(f.repo.uploadProductImage(9, file)).rejects.toThrow('اختر صورة للصنف أولاً');

        const d = repoStub({ id: 9, image_url: null });
        await d.repo.removeProductImage(9);
        expect(d.calls).toEqual(['/pos/products/9/image']);
        expect(d.methods).toEqual(['DELETE']);
    });

    test('لا fetch خام إلا للصورة: كل باقي الأبواب تمر من apiFetch', () => {
        const src = source(EDIT_REPO);
        const raw = src.match(/\bfetch\s*\(/g) || [];
        expect(raw).toHaveLength(1);   // uploadProductImage وحدها
        expect(src.match(/apiFetch\(/g).length).toBeGreaterThan(6);
    });
});

describe('شاشة الوصفات — العقد المصدر', () => {
    test('لا شبكة من الشاشة ولا معالج سطري ولا ادعاء «قراءة فقط»', () => {
        const s = source(SCREEN);
        expect(s).not.toMatch(/\bfetch\s*\(/);
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/\son[a-z]+=/gi);
        expect(s).not.toMatch(/قراءة فقط/);
        expect(s).toContain("from '../data/recipes-repo.js?v=");
        expect(s).toContain("from '../data/recipes-edit-repo.js?v=");
    });

    test('بوابة الأزرار من canWrite على قوائم الخادم نفسها', () => {
        const s = source(SCREEN);
        expect(s).toContain('canWrite(ctx.role, RECIPE_WRITE_ROLES)');
        expect(s).toContain('canWrite(ctx.role, RECIPE_BOM_ROLES)');
        expect(s).toMatch(/template\(canEdit\)/);
        expect(s).toContain('data-v2-rec-add');
    });

    test('كل أبواب الدورة مستدعاة من الشاشة — بلا باب ميت', () => {
        const s = source(SCREEN).replace(/import[\s\S]*?from '[^']+';/g, '');
        for (const fn of ['createRecipe', 'updateRecipe', 'removeRecipe', 'syncRecipeToCashier',
            'fetchProductIngredients', 'fetchRecipeInventory', 'fetchRecipeUnits',
            'saveProductIngredients', 'uploadProductImage', 'removeProductImage',
            'costRatioPercent', 'ingredientLine', 'newIngredientLine']) {
            expect(s).toMatch(new RegExp(`\\b${fn}\\b`));
        }
    });

    test('أحداث مفوَّضة لكل إجراء — من نفس الجذر', () => {
        const s = source(SCREEN);
        for (const sel of ['[data-v2-rec-add]', '[data-v2-rec-edit]', '[data-v2-rec-del]',
            '[data-v2-rec-bom]', '[data-v2-close]', '[data-v2-save]',
            '[data-v2-bom-add]', '[data-v2-bom-save]', '[data-v2-bom-rm]',
            '[data-v2-bom-upload]', '[data-v2-bom-imgdel]']) {
            expect(s).toContain(`closest('${sel}')`);
        }
        expect(s).toContain("el.addEventListener('click'");
        expect(s).toContain("el.addEventListener('change'");
        expect(s).toContain("el.addEventListener('input'");
    });

    test('إصلاح نسبة التكلفة: لا ضرب ثانٍ في 100', () => {
        const s = source(SCREEN);
        expect(s).not.toMatch(/costRatio\s*\|\|\s*0\)\s*\*\s*100/);
        expect(s).toContain('ratioText(r.costRatio)');
        expect(s).toContain('costRatioPercent');
    });

    test('الطباعة مرة واحدة والحوار من المضيف مع سقوط احتياطي واحد', () => {
        const s = source(SCREEN);
        expect(s.match(/window\.print\(/g)).toHaveLength(1);
        expect(s.match(/window\.confirm\(/g)).toHaveLength(1);
        expect(s).toContain("typeof ctx.confirmFn === 'function'");
        expect(s).toContain("await confirmFn('حذف الوصفة؟')");
        expect(s).toContain("await confirmFn('حذف صورة الصنف؟')");
    });

    test('اللوحة خارج الورق وعمود الإجراءات كذلك', () => {
        const s = source(SCREEN);
        expect(s).toContain('<div class="erp-no-print" data-v2-editor hidden></div>');
        expect(s).toContain("key: 'actions', header: 'إجراءات'");
        expect(s).toContain("className: 'erp-no-print'");
        expect(source(OPS_CSS)).toMatch(/@media print \{[\s\S]*?erp-no-print[\s\S]*?\}/);
    });

    test('كلمات التحقق والنجاح منسوخة من القديم حرفًا', () => {
        const s = source(SCREEN);
        const legacy = source(LEGACY);
        for (const phrase of ['أدخل اسم الوصفة', 'حذف الوصفة؟', 'تم الحذف',
            'هذا المكون موجود بالفعل', 'كل كميات المكونات يجب أن تكون أكبر من صفر',
            'تعذر إنشاء صنف الكاشير للوصفة', 'اختر صورة أولاً', 'تعذر رفع الصورة',
            'تم حفظ صورة الوصفة في قاعدة البيانات', 'تم إضافة الوصفة', 'تم التحديث',
            'تم حفظ الوصفة لكن تعذر مزامنتها مع الكاشير', 'تعذر حفظ مكونات الوصفة']) {
            expect(s).toContain(phrase);
            expect(legacy).toContain(phrase);
        }
    });

    test('حراس الفشل كما تفرضها سجلات V2', () => {
        const s = source(SCREEN);
        expect(s).toMatch(/if \(!el\.isConnected\)\s*\{\s*return;\s*\}/);
        expect(s).toMatch(/table\.destroy\(\);/);
        expect(s).toMatch(/el\.remove\(\);/);
        expect(s).toContain('انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.');
        expect(s).toMatch(/e\.code === 'FORBIDDEN'/);
        expect(s).toContain('تعذّر تحميل الوصفات: ');
    });

    test('الرموز الساكنة كلها موجودة في وحدة الرموز', () => {
        const s = source(SCREEN);
        const icons = source(ICONS);
        const names = new Set();
        for (const m of s.matchAll(/data-i="([a-z0-9-]+)"/g)) {names.add(m[1]);}
        expect(names.size).toBeGreaterThan(5);
        for (const n of names) {expect(icons).toContain(`'${n}':`);}
    });

    test('حارس أحدث تجهيز للوحة: إغلاق يلغي أي قراءة جارية', () => {
        const s = source(SCREEN);
        expect(s).toMatch(/const seq = \+\+panelSeq;/);
        expect(s).toMatch(/if \(!el\.isConnected \|\| panelSeq !== seq\) \{ return; \}/);
        expect(s).toMatch(/panelSeq \+= 1;/);
    });

    test('المراجعة الواحدة في كل استيراد نسبي', () => {
        const drifting = [];
        for (const f of [SCREEN, EDIT_REPO]) {
            for (const m of source(f).matchAll(/from\s*'(\.[^']*)'/g)) {
                if (!m[1].endsWith(`.js?v=${REV}`)) {drifting.push(`${path.basename(f)} → ${m[1]}`);}
            }
        }
        expect(drifting).toEqual([]);
    });
});

describe('شاشة الوصفات — المضيف', () => {
    test('تُركَّب بمضيف السجلات المشترك وبالهوية كاملة', () => {
        const h = source(HOST);
        expect(h).toMatch(/import \{ mountRecipesScreen \} from '\.\/screens\/recipes\.js\?v=/);
        expect(h).toMatch(/renderLiveRegisterScreen\(\{ key: 'recipes', title: 'الوصفات', mount: mountRecipesScreen/);
        expect(h).toMatch(/role: session\.role,/);
        expect(h).toMatch(/confirmFn: \(message\) => window\.confirm\(message\),/);
        expect(h).toMatch(/notify: notifyTo\(note\),/);
    });

    test('المغادرة تُتلف الشاشة — لا شبح يكتب على DOM بعد التنقّل', () => {
        const h = source(HOST);
        expect(h).toMatch(/function teardownRecipesScreen\(\) \{[\s\S]{0,120}recipesScreen\.destroy\(\);[\s\S]{0,60}recipesScreen = null;/);
        expect(h).toMatch(/teardownRecipesScreen\(\);/);
    });
});
