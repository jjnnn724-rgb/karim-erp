/**
 * V2 — Recipes repository (الباب إلى /api/recipes + /api/pos/recipes/catalog)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /recipes → { data, pagination } (generic entity API, server.js:1454-1521).
 *     kitchen edit roles: admin|manager|kitchen|sous_chef (+perm kitchen.edit),
 *     schema-registry.js:776. writeable: name, deptId, sellingPrice,
 *     totalCost, costRatio (required: name) — :415.
 *   GET /pos/recipes/catalog (cashier-module/shift-routes.js:338) → raw array
 *     of { recipe_id, name, deptId, sellingPrice, totalCost, costRatio,
 *     product_id, image_url, pos_price, pos_cost_price, ingredient_count }.
 *     Read roles: manager|admin|auditor|kitchen|sous_chef (same file :338).
 *   storage.js:187-193 normalises each recipe into { ...recipe,
 *   sellingPrice:Number, totalCost:Number, costRatio:Number } — the V2
 *   row reproduces this, additionally falling back to the catalog for the
 *   image + price when the generic record has none.
 *
 * THIS FILE NEVER WRITES.
 */

import { apiFetch } from '../../core/api.js?v=4.9.148';

export async function fetchRecipes() {
    const rows = [];
    for (let page = 1; page <= 8; page += 1) {
        const res = await apiFetch(`/recipes?page=${page}&limit=1000&sort=id&order=asc`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows;
}

export async function fetchRecipesCatalog() {
    try {
        const res = await apiFetch('/pos/recipes/catalog');
        return Array.isArray(res) ? res : [];
    } catch (_) {
        return [];
    }
}

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

export function recipeToRow(r = {}, catalogMap = {}) {
    const id = r.id;
    const cat = catalogMap && catOf(catalogMap, id);
    return {
        id,
        name: (r.name ? String(r.name) : (cat && cat.name ? String(cat.name) : '—')),
        deptCode: (r.deptId !== undefined && r.deptId !== null) ? String(r.deptId) : '',
        sellingPrice: num(r.sellingPrice ?? (cat && cat.sellingPrice)),
        totalCost: num(r.totalCost ?? r.protected?.totalCost ?? (cat && cat.totalCost)),
        costRatio: num(r.costRatio ?? (cat && cat.costRatio)),
        imageUrl: (r.image_url || r.imageUrl || (cat && cat.image_url)) || '',
        productLinked: !!(r.product_id || (cat && cat.product_id)),
        ingredients: (cat && cat.ingredient_count) || 0,
    };
}

function catOf(map, id) {
    if (!map || !Object.prototype.hasOwnProperty.call(map, id)) {return null;}
    return map[id];
}

/** Builds { id: catalogRow } once. */
export function indexCatalog(list) {
    const out = {};
    (list || []).forEach((c) => {
        if (c && c.recipe_id != null) {out[String(c.recipe_id)] = c;}
    });
    return out;
}
