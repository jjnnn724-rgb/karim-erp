#!/usr/bin/env node
'use strict';

/**
 * import-buffet.js — يستورد أصناف بوفيه الشرفة العالمي من الملف إلى الداتابيس.
 *
 *   node scripts/import-buffet.js <repo-path> --dry-run   عرض فقط — بلا كتابة
 *   node scripts/import-buffet.js <repo-path>             ينفّذ الترحيل (BEGIN…COMMIT)
 *
 * المدخلات: "بوفيه-الشرفة-المنيو-والوصفات.html" (ضعه في DESKTOP أو مرر المسار بـ --src=).
 * المخرجات: تقرير ربط (مطبوع + ملف JSON في مجلد النظام المؤقت).
 *
 * قواعد الربط الآلي (محافظة — لا تخمين):
 *   1. تطابق كامل بعد التطبيع (همزات/تاء مربوطة/تشكيل) → ربط.
 *   2. تطابق كامل بعد حذف وصف التحضير (مكعبات/شرائح/مفروم…) → ربط.
 *   3. مجموعات التوكن: كل توكن من الطرف الأصغر موجود في الأكبر
 *      وبنسبة ≥ 0.6 + أطول توكن مشترك ≥ 4 أحرف → ربط.
 *   4. أي اسم مخزن يحتوي علامات مصنّع/مجفف (بودر/مجفف/مطحون/مسحوق)
 *      والمكوّن لا يحتويها → لا ربط.
 *   باقي الأسطر تُترك inventory_id = NULL (شاشة الربط تعالجها لاحقًا).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const repo = process.argv[2];
const args = process.argv.slice(3);
const DRY = args.includes('--dry-run');
const srcArg = args.find((a) => a.startsWith('--src='));
const SRC = srcArg
    ? srcArg.slice('--src='.length)
    : 'C:/Users/Administrator/Desktop/بوفيه-الشرفة-العالمي/بوفيه-الشرفة-المنيو-والوصفات.html';

if (!repo) {
    console.error('الاستخدام: node scripts/import-buffet.js <repo-path> [--dry-run] [--src=<ملف.html>]');
    process.exit(1);
}

require(path.join(repo, 'node_modules', 'dotenv')).config({ path: path.join(repo, '.env'), quiet: true });
const { Pool } = require(path.join(repo, 'node_modules', 'pg'));
const { normalizeName, stripPrep, parsePackKg, FACTORY_MARKERS } = require(path.join(repo, 'backend', 'buffet-logic.js'));

const src = fs.readFileSync(SRC, 'utf8');
const dishMatch = src.match(/const SEED_DISHES = (\[.*?\]);\r?\n/s);
const weekMatch = src.match(/const SEED_WEEK = (\[.*?\]);\r?\n/s);
if (!dishMatch || !weekMatch) {
    console.error('تعذر استخراج SEED_DISHES/SEED_WEEK من الملف', SRC);
    process.exit(1);
}
const dishes = JSON.parse(dishMatch[1]);
const week = JSON.parse(weekMatch[1]);

const PREP_ONLY_TOKENS = new Set(['للتزيين', 'للتقديم', 'اه']);

const tokens = (s) => normalizeName(s).split(' ').filter((t) => t.length >= 3 && !PREP_ONLY_TOKENS.has(t));

function hasFactory(text) {
    const n = normalizeName(text);
    return FACTORY_MARKERS.some((m) => n.includes(m));
}

function pickMatch(ingredientName, inventory) {
    const rawNorm = normalizeName(ingredientName);
    const stripped = stripPrep(ingredientName);
    if (!rawNorm) {return null;}
    const ingHasFactory = hasFactory(ingredientName);
    const acceptable = (item) => ingHasFactory || !hasFactory(item.name); // مكوّن خام لا يرتبط بمصنّع

    // 1) تطابق كامل خام
    for (const item of inventory) {
        if (acceptable(item) && normalizeName(item.name) === rawNorm) {return { item, rule: 'exact' };}
    }
    // 2) تطابق كامل بعد حذف وصف التحضير
    if (stripped) {
        for (const item of inventory) {
            if (acceptable(item) && stripPrep(item.name) === stripped) {return { item, rule: 'stripped' };}
        }
    }
    const ingTokens = tokens(stripped || rawNorm);
    if (ingTokens.length === 0) {return null;}
    const ingSet = new Set(ingTokens);

    let best = null;
    for (const item of inventory) {
        if (!acceptable(item)) {continue;}
        const invTokens = new Set(tokens(item.name));
        if (invTokens.size === 0) {continue;}
        const [small, big] = ingSet.size <= invTokens.size ? [ingSet, invTokens] : [invTokens, ingSet];
        let shared = 0;
        let longest = 0;
        for (const t of small) {
            if (big.has(t)) {
                shared += 1;
                longest = Math.max(longest, t.length);
            }
        }
        if (shared !== small.size) {continue;}      // كل توكن الأصغر موجود في الأكبر
        if (longest < 4) {continue;}                 // أطول توكن مشترك ≥ 4 أحرف
        const ratio = shared / big.size;             // نسبة التغطية
        if (ratio < 0.6) {continue;}                 // منع «بصل → بصل بودر أبيض»
        if (!best || ratio > best.ratio || (ratio === best.ratio && invTokens.size < best.size)) {
            best = { item, rule: `tokens:${ratio.toFixed(2)}`, ratio, size: invTokens.size };
        }
    }
    return best ? { item: best.item, rule: best.rule } : null;
}

(async () => {
    const pool = new Pool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectionTimeoutMillis: 10000,
    });
    const inventory = (await pool.query('SELECT id, name, unit, "avgCost", category FROM inventory ORDER BY id')).rows;
    console.log(`المخزن: ${inventory.length} صنفًا · ${dishes.length} صنف بوفيه · ${week.length} خانة أسبوع`);

    // ── الربط الآلي + التقرير ─────────────────────────────────────
    // pack_kg: عبوات الكيلو المعلومة وزنها (كيس 50 كيلو مثلاً) — تُمكّن سعر الكيلو من سعر التعبئة
    const isKgFamilyU = (u) => {
        const n = normalizeName(u);
        return ['kg', 'كيلو', 'كيلو جرام', 'كيلوجرام', 'كيلو غرام', 'جرام', 'جم', 'غرام', 'g', 'mg'].includes(n);
    };
    const attach = (ing, hit) => {
        if (!hit || !hit.item) {return null;}
        const pack = isKgFamilyU(ing.unit) && !isKgFamilyU(hit.item.unit) ? parsePackKg(hit.item.name) : null;
        return { ...hit, packKg: pack };
    };
    const accepted = [];
    const unmatched = [];
    for (const dish of dishes) {
        for (const ing of dish.ingredients) {
            const hit = attach(ing, pickMatch(ing.name, inventory));
            if (hit && hit.item) {
                accepted.push({ dish: dish.name, ing: ing.name, unit: ing.unit, invId: String(hit.item.id), invName: hit.item.name, invUnit: hit.item.unit, avgCost: hit.item.avgCost, rule: hit.rule, packKg: hit.packKg });
            } else {
                unmatched.push({ dish: dish.name, ing: ing.name, unit: ing.unit, qty: ing.qty });
            }
        }
    }
    const total = dishes.reduce((n, d) => n + d.ingredients.length, 0);
    console.log(`الربط الآلي: ${accepted.length}/${total} (${((accepted.length / total) * 100).toFixed(1)}%) · بدون ربط: ${unmatched.length}`);

    const report = { at: new Date().toISOString(), source: SRC, accepted, unmatched };
    const reportPath = path.join(os.tmpdir(), 'buffet-import-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
    console.log('التقرير:', reportPath);

    if (DRY) {
        console.log('\n── روابط مقبولة (عينة 80) ──');
        for (const a of accepted.slice(0, 80)) {
            const pack = a.packKg ? ` · تعبئة ${a.packKg} كجم` : '';
            console.log(`  ${String(a.ing).padEnd(28)} [${a.unit}] ← ${a.invName} [${a.invUnit}] (${a.avgCost})${pack} · ${a.rule}`);
        }
        console.log('\n── بدون ربط (الكل) ──');
        for (const u of unmatched) console.log(`  ${u.dish} :: ${u.ing} [${u.unit}] (${u.qty})`);
        await pool.end();
        process.exit(0);
    }

    // ── الكتابة (idempotent) ──────────────────────────────────────
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const dish of dishes) {
            const d = await client.query(
                `INSERT INTO buffet_dishes (name, category, freq, yields, notes)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (name) DO UPDATE
                    SET category = EXCLUDED.category, freq = EXCLUDED.freq,
                        yields = EXCLUDED.yields, notes = EXCLUDED.notes, updated_at = now()
                 RETURNING id`,
                [String(dish.name).trim(), String(dish.cat || ''), Number(dish.freq) || 1, String(dish.yields || ''), String(dish.notes || '')],
            );
            const dishId = d.rows[0].id;
            await client.query('DELETE FROM buffet_ingredients WHERE dish_id = $1', [dishId]);
            let pos = 0;
            for (const ing of dish.ingredients) {
                pos += 1;
                const hit = attach(ing, pickMatch(ing.name, inventory));
                await client.query(
                    `INSERT INTO buffet_ingredients (dish_id, position, name, qty, unit, inventory_id, pack_kg)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [dishId, pos, String(ing.name || '').trim(), Number(ing.qty) || 0, String(ing.unit || ''), hit && hit.item ? hit.item.id : null, hit && hit.packKg ? hit.packKg : null],
                );
            }
        }
        // خطة الأسبوع
        const dishIdByName = new Map(
            (await client.query('SELECT id, name FROM buffet_dishes')).rows.map((r) => [r.name, r.id]),
        );
        await client.query('DELETE FROM buffet_week');
        for (const slot of week) {
            let position = 0;
            for (const itemName of slot.items) {
                position += 1;
                const dishId = dishIdByName.get(itemName);
                if (!dishId) {throw new Error(`خطة الأسبوع تشير إلى صنف غير موجود: ${itemName}`);}
                await client.query(
                    'INSERT INTO buffet_week (day, meal, position, dish_id) VALUES ($1, $2, $3, $4)',
                    [slot.day, slot.meal, position, dishId],
                );
            }
        }
        await client.query('COMMIT');
        console.log('COMMIT OK — تم استيراد 65 صنفًا ومكوناتها وخطة الأسبوع');
        const counts = await client.query(
            `SELECT (SELECT count(*)::int FROM buffet_dishes) AS dishes,
                    (SELECT count(*)::int FROM buffet_ingredients) AS lines,
                    (SELECT count(*)::int FROM buffet_ingredients WHERE inventory_id IS NOT NULL) AS linked,
                    (SELECT count(*)::int FROM buffet_week) AS week_slots`);
        console.log('DB:', JSON.stringify(counts.rows[0]));
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('ROLLBACK:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
