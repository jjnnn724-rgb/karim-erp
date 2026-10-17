/**
 * V2 — Recipes write repository (باب الكتابة الوحيد لدورة الوصفات)
 * ═══════════════════════════════════════════════════════════════════════
 * WHY A SECOND FILE (ولماذا لا نكتب في recipes-repo.js)
 *   data/recipes-repo.js يبقى قراءةً خالصة: tests/v2-registers.test.js:74
 *   يفرض «repos السجلات لا تكتب — لا POST/PUT/DELETE في نص أي منها».
 *   نفس تفريق finance-repo (قراءة) عن dept-detail (كتابة).
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   POST   /recipes        server.js:1772 → 201 بالصف المنشأ (:1762).
 *   PUT    /recipes/:id    server.js:2029 → 200 بالصف المحدَّث (:2021).
 *   DELETE /recipes/:id    server.js:2278 → { message: 'Deleted successfully' } (:2330).
 *     recipes ليست في PROTECTED_DELETE_ENTITIES (schema-registry.js:818).
 *   الحقول القابلة للكتابة: name, deptId, sellingPrice, totalCost, costRatio
 *     والمطلوب name وحده — schema-registry.js:416-417.
 *   الأدوار: OPEN_ENTITY_WRITE_ROLES.recipes (schema-registry.js:791) +
 *     صلاحية kitchen.edit — server.js:1770-1772.
 *   guardCreate (submit-guard.js:19) يعدّ recipes كيان تكرار: إنشاءان
 *     متطابقان خلال 10 ثوانٍ يُردّان 409 برسالة عربية (submit-guard.js:98-108)
 *     — تُعرض كما ترد، لا حارس مكرر في المتصفح.
 *
 *   المكوّنات وصورة الصنف تعيش في وحدة الكاشير بأدوار أخرى (manager|admin):
 *     POST   /pos/recipes/sync-legacy        shift-routes.js:362 → { recipe_id, product, synced }
 *     GET    /pos/products/:id/ingredients   :385 → صفوف تحمل extended_cost
 *            وquantity_in_inventory_units وunit_error — من الخادم، لا حساب هنا
 *     PUT    /pos/products/:id/ingredients   :411 → { product_id, ingredient_count, total_cost }
 *            والخادم يحدّث recipes.totalCost/costRatio بنفسه (:479-489)
 *     GET    /pos/ingredients                :350، GET /pos/recipe-units :333
 *     POST   /pos/products/:id/image         :295 (multipart)، DELETE :320
 *
 * TWO THINGS THIS FILE DELIBERATELY DOES NOT DO
 *   1) لا حساب وحدات في المتصفح. التحويل والتحقق في backend/unit-conversion.js،
 *      وPUT يردّ 422 INCOMPATIBLE_UNITS برسالة عربية (shift-routes.js:450-454).
 *      الواجهة تقترح وحدة افتراضية فقط (defaultUnitFor) والخادم يحكم.
 *   2) لا PUT ثانٍ على /recipes بعد حفظ المكوّنات. القديم (kitchen.js:1433)
 *      كان يكرّره، لكن PUT المكوّنات يحدّث recipes بنفسه (:479-489) —
 *      تكراره كتابة زائدة بلا أثر.
 *
 * costRatio في قاعدة البيانات نسبة مئوية لا كسر: العمود NUMERIC(10,2)
 *   (database/migrations/001_schema.sql:175)، والكتّاب الثلاثة يكتبون
 *   (cost/price*100) — shift-routes.js:482، kitchen-production-routes.js:238،
 *   features/kitchen.js:1444. لذلك costRatioPercent هنا يردّ نسبة مئوية.
 */

import { apiFetch, API_BASE } from '../../core/api.js?v=4.9.152';

/** مرآة OPEN_ENTITY_WRITE_ROLES.recipes (schema-registry.js:791). */
export const RECIPE_WRITE_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'];

/** مرآة requireRole('manager','admin') على مسارات المكوّنات والصورة (shift-routes.js:295/:362/:411). */
export const RECIPE_BOM_ROLES = ['admin', 'manager'];

/**
 * مرآة ALIASES في backend/unit-conversion.js:8 حرفًا بحرف — تُستخدم لتطبيع
 * الوحدة الافتراضية فقط، ولا تحوّل شيئًا.
 */
export const UNIT_ALIASES = { g:'g', gram:'g', grams:'g', جرام:'g', غرام:'g', جم:'g', kg:'kg', kilo:'kg', kilogram:'kg', كيلو:'kg', كجم:'kg', كغ:'kg', كيلوجرام:'kg', ml:'ml', milliliter:'ml', مليلتر:'ml', مل:'ml', l:'l', liter:'l', litre:'l', لتر:'l', piece:'piece', pieces:'piece', unit:'piece', وحدة:'piece', قطعة:'piece', حبة:'piece' };

/** تطبيع اسم وحدة كما backend/unit-conversion.js:9 — بلا تحويل قيمة. */
export function normalizeRecipeUnit(value) {
    const key = String(value == null ? '' : value).trim().toLowerCase();
    return UNIT_ALIASES[key] || key || 'piece';
}

/**
 * نسبة التكلفة المئوية كما يخزّنها الخادم (features/kitchen.js:1444 حرفيًا،
 * والتقريب لخانتين مطابق للعمود NUMERIC(10,2) وROUND الخادم shift-routes.js:482).
 */
export function costRatioPercent(price, cost) {
    const p = Number(price) || 0;
    const c = Number(cost) || 0;
    return p > 0 ? Number(((c / p) * 100).toFixed(2)) : 0;
}

/**
 * حمولة الوصفة كما يفرضها schema-registry.js:416 — ولا حقل زائد يُرفض 400.
 * deptId الفارغ يُسقط (لا نخترع نصًا فارغًا في العمود).
 * @returns {{name:string, deptId?:string, sellingPrice:number, totalCost:number, costRatio:number}}
 */
export function recipePayload(form = {}) {
    const name = String(form.name == null ? '' : form.name).trim();
    const deptId = String(form.deptId == null ? '' : form.deptId).trim();
    const sellingPrice = Number(form.sellingPrice) || 0;
    const totalCost = Number(form.totalCost) || 0;
    const body = { name, sellingPrice, totalCost, costRatio: costRatioPercent(sellingPrice, totalCost) };
    if (deptId) {body.deptId = deptId;}
    return body;
}

/** POST /recipes — 201 بالصف المنشأ. */
export async function createRecipe(form) {
    const body = recipePayload(form);
    if (!body.name) {throw new Error('أدخل اسم الوصفة');}
    return apiFetch('/recipes', { method: 'POST', body: JSON.stringify(body) });
}

/** PUT /recipes/:id — 200 بالصف المحدَّث. */
export async function updateRecipe(id, form) {
    const body = recipePayload(form);
    if (!body.name) {throw new Error('أدخل اسم الوصفة');}
    return apiFetch(`/recipes/${encodeURIComponent(String(id))}`, { method: 'PUT', body: JSON.stringify(body) });
}

/** DELETE /recipes/:id — { message: 'Deleted successfully' }. */
export async function removeRecipe(id) {
    return apiFetch(`/recipes/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
}

/**
 * POST /pos/recipes/sync-legacy — ينشئ/يحدّث صنف الكاشير المرتبط بالوصفة
 * ويعيده (shift-routes.js:362-383). بلا صنف لا محرّر مكوّنات ولا صورة.
 */
export async function syncRecipeToCashier(recipeId) {
    const res = await apiFetch('/pos/recipes/sync-legacy', {
        method: 'POST', body: JSON.stringify({ recipe_id: Number(recipeId) }),
    });
    return (res && res.product) || null;
}

/** GET /pos/products/:id/ingredients — صفوف بأرقام الخادم (extended_cost/unit_error). */
export async function fetchProductIngredients(productId) {
    const res = await apiFetch(`/pos/products/${encodeURIComponent(String(productId))}/ingredients`);
    return Array.isArray(res) ? res : [];
}

/** GET /pos/ingredients — أصناف المخزن المتاحة للمكوّنات (shift-routes.js:350). */
export async function fetchRecipeInventory() {
    const res = await apiFetch('/pos/ingredients');
    return Array.isArray(res) ? res : [];
}

/** GET /pos/recipe-units — [{ value, label, family }] (shift-routes.js:333). */
export async function fetchRecipeUnits() {
    const res = await apiFetch('/pos/recipe-units');
    return Array.isArray(res) ? res : [];
}

/**
 * PUT /pos/products/:id/ingredients — الخادم يتحقق من كل سطر ويحوّل ويحسب
 * التكلفة، ويرفض 422 INVALID_INGREDIENT / DUPLICATE_INGREDIENT /
 * INCOMPATIBLE_UNITS برسالة عربية (shift-routes.js:411-497).
 */
export async function saveProductIngredients(productId, lines) {
    const ingredients = (lines || []).map((line) => ({
        inventory_id: Number(line.inventory_id),
        quantity_per_unit: Number(line.quantity_per_unit),
        unit: String(line.unit || 'piece'),
        waste_percent: Number(line.waste_percent) || 0,
        notes: null,
    }));
    return apiFetch(`/pos/products/${encodeURIComponent(String(productId))}/ingredients`, {
        method: 'PUT', body: JSON.stringify({ ingredients }),
    });
}

/**
 * POST /pos/products/:id/image — multipart، فيلزم fetch خام مع رأس
 * المصادقة (apiFetch يفرض Content-Type: application/json — core/api.js:12).
 * نفس نمط settings-repo.uploadBackup:161-170.
 */
export async function uploadProductImage(productId, file) {
    const form = new FormData();
    form.append('image', file, file.name);
    const headers = {};
    if (typeof window !== 'undefined' && window._jwt) {headers.Authorization = `Bearer ${window._jwt}`;}
    if (typeof window !== 'undefined' && window._appKey) {headers['x-api-key'] = window._appKey;}
    const res = await fetch(`${API_BASE}/pos/products/${encodeURIComponent(String(productId))}/image`, {
        method: 'POST', headers, body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {throw new Error(data.message || data.error || 'تعذر رفع الصورة');}
    return data;
}

/** DELETE /pos/products/:id/image (shift-routes.js:320). */
export async function removeProductImage(productId) {
    return apiFetch(`/pos/products/${encodeURIComponent(String(productId))}/image`, { method: 'DELETE' });
}

/** صف مكوّن الخادم → صف المحرّر: الكمية والوحدة والهدر كما ترد، والتكلفة من الخادم. */
export function ingredientLine(row = {}) {
    return {
        inventory_id: Number(row.inventory_id),
        inventory_name: String(row.inventory_name || ''),
        inventory_unit: String(row.inventory_unit || ''),
        quantity_per_unit: Number(row.quantity_per_unit) || 0,
        unit: String(row.unit || 'piece'),
        waste_percent: Number(row.waste_percent) || 0,
        extended_cost: row.extended_cost == null ? null : Number(row.extended_cost),
        unit_error: row.unit_error || null,
    };
}

/** سطر مكوّن جديد — صنف المخزن يحدّده المستخدم، والكمية 1 والهدر صفر. */
export function newIngredientLine(inventory, unitValues) {
    const inv = inventory || {};
    return {
        inventory_id: Number(inv.id),
        inventory_name: String(inv.name || ''),
        inventory_unit: String(inv.unit || ''),
        quantity_per_unit: 1,
        unit: defaultUnitFor(inv, unitValues),
        waste_percent: 0,
        extended_cost: null,
        unit_error: null,
    };
}

/**
 * الوحدة الافتراضية لسطر: وحدة المخزون نفسها بعد تطبيع اسمٍ مستعار إن كانت
 * من وحدات الخادم (shift-routes.js:333)، وإلا 'piece'. اختيار عرضٍ لا تحويل.
 */
export function defaultUnitFor(inventory, unitValues) {
    const known = (unitValues || []).map((u) => String(u && u.value)).filter(Boolean);
    const normalized = normalizeRecipeUnit(inventory && inventory.unit);
    if (known.includes(normalized)) {return normalized;}
    return known.includes('piece') ? 'piece' : (known[0] || 'piece');
}
