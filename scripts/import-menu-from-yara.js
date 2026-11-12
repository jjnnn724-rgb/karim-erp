#!/usr/bin/env node
'use strict';

/**
 * import-menu-from-yara.js — استيراد منيو كاشير يارسوفت إلى منيو كريم
 * ────────────────────────────────────────────────────────────────────────────
 * الهدف: بناء منيو الكاشير في كريم من كتالوج يارسوفت (Oracle 11g) بلا كتابة
 * على قاعدة يارسوفت إطلاقًا — قراءة فقط منها، والكتابة في كريم فقط.
 *
 * قاعدة «النشط» (قرار المالك): الصنف المختار إن كان مسعّرًا (سعر نظامي > 0) تحت
 * شجرة المبيعات (01) **ورُsell فعليًا** داخل نافذة النشاط (افتراضي 3 أشهر).
 * الصنف المسعّر الذي لم يُبع في النافذة لا يُستورد — لا فائض في الشبكة.
 *
 * قواعد التحويل (مثبتة على بيانات يارا نفسها، لا افتراض):
 *   • السعر: ITM_PRCNG.MAX_PRC — وهو سعر **قبل** الضريبة (تحقّق: VAT_AMNT =
 *     SALE_VAL × 0.15 في 19974 من 20000 سطر) ⇒ نفس دلالة pos_products.price
 *     في كريم (الضريبة تُضاف فوق السعر).
 *   • الضريبة: VAT_RATE الفعلية من سطور البيع (15) — لا من ITEMS.VAT_PRCNT.
 *   • التصنيف: اسم الأب (المستوى 2) في شجرة يارا، مطبّعًا.
 *   • الوحدة: من UNIT_NM في سطور البيع (نفر/كيلو) ← تُترجم لأسماء مطبخية.
 *   • الباركود: ITM_NO (رقمي وفريد لكل الأصناف النشطة).
 *   • التكلفة: غير معروفة في يارا (تكلفة الأصناف المباعة في BILLS6) ⇒ NULL
 *     بدل 0 (لا يدّعي أن الصنف بلا تكلفة).
 *   • قسم التجهيز (KOT): من طابعة يارا P2xx في سطور البيع ⇒ قسم مطبخ كريم.
 *   • الظهور في شاشة الكاشير: pos_product_departments لكل قسم نشط — لأن الصنف
 *     ليس له «محطة» واحدة في يارا (81% منه يُباع من أكثر من كاشير).
 *
 * الأمان:
 *   • لا حذف ولا تعطيل: الاستيراد يضيف/يحدّث فقط، والمفتاح metadata.yara_code
 *     يجعل إعادة التشغيل آمنة (idempotent).
 *   • أصناف المالك اليدوية (metadata.yara_code غير موجود) لا تُمَسّ أبدًا.
 *   • كل الكتابة في معاملة واحدة (transaction) — إما الكل أو لا شيء.
 *
 * التشغيل:
 *   node scripts/import-menu-from-yara.js                          # معاينة (لا كتابة)
 *   node scripts/import-menu-from-yara.js --apply --confirm-write=karim_erp
 *   node scripts/import-menu-from-yara.js --months=6               # نافذة النشاط
 *   node scripts/import-menu-from-yara.js --rollback=<report.json> --confirm-write=karim_erp
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false });
const { pool } = require('../backend/shared-pool');
const { getKeptConn, oraExecute, closeKeptConn } = require('../backend/yarasoft/oracle-link');

const APPLY = process.argv.includes('--apply');
const dbName = process.env.DB_NAME || 'karim_erp';
const WINDOW_MONTHS = Math.max(1, Math.min(36, Number(argValue('--months=') || 3)));
const IMPORTED_AT = new Date().toISOString();

/** طابعة يارا ⇒ قسم التجهيز في كريم (مبنية على التسعة أزواج الفعلية في CC_BILL_ENTER3). */
const KOT_BY_PRINTER = {
    P201: { dept: 'erp_fnb', label: 'شاورما' },
    P203: { dept: 'erp_hot_kitchen', label: 'ساخن' },
    P204: { dept: 'erp_kitchen', label: 'الدجاج', altDept: 'erp_open_buffet', altLabel: 'بوفية مفتوح' },
    P205: { dept: 'erp_salads', label: 'خضار' },
    P206: { dept: 'erp_g', label: 'عصير' },
    P208: { dept: 'erp_sweets', label: 'حلويات' },
};

/** ترجمة وحدة يارا (نفر/كيلو) إلى وحدة مطبخية تُعرض في شاشة الكاشير. */
const DRINK_CATEGORY = /عصير|كوفي|كافيه|مشروب/i;

function argValue(prefix) {
    const hit = process.argv.find((a) => String(a).startsWith(prefix));
    return hit ? hit.slice(prefix.length) : null;
}

function num(v) {const n = Number(v); return Number.isFinite(n) ? n : 0;}
function money(v) {return Math.round(num(v) * 100) / 100;}
function clean(v) {return String(v == null ? '' : v).trim().replace(/\s+/g, ' ');}

// ─── 1) القراءة من يارسوفت (قراءة فقط) ───────────────────────────────────
async function pullYaraMenu() {
    const conn = await getKeptConn('menu-import');
    const q = async (sql, binds) => (await oraExecute(conn, sql, binds)).rows;
    const window = { m: WINDOW_MONTHS };

    const priced = await q(`SELECT i.ITM_NO, i.ITMNAME, i.BAR_CODE, i.UNIT1, p.ITMNAME CAT_NAME,
                   (SELECT MAX(pr.MAX_PRC) FROM ITM_PRCNG pr WHERE pr.ITM_NO = i.ITM_NO AND NVL(pr.MAX_PRC,0) > 0) MAX_PRC
              FROM ITEMS i JOIN ITEMS p ON p.ITM_NO = i.FTH_ITM
             WHERE p.FTH_ITM = '01'
               AND EXISTS (SELECT 1 FROM ITM_PRCNG pr WHERE pr.ITM_NO = i.ITM_NO AND NVL(pr.MAX_PRC,0) > 0)`);

    const activity = await q(`SELECT ITM_NO, COUNT(*) LINES, SUM(QNT) QTY, MAX(DOC_DATE) LAST_DATE
              FROM CC_BILL_ENTER3 WHERE DOC_DATE >= ADD_MONTHS(SYSDATE, -:m) GROUP BY ITM_NO`, window);

    const printers = await q(`SELECT ITM_NO, PRNTR_NM FROM (
                SELECT ITM_NO, PRNTR_NM, ROW_NUMBER() OVER (PARTITION BY ITM_NO ORDER BY COUNT(*) DESC) rn
                  FROM CC_BILL_ENTER3 WHERE DOC_DATE >= ADD_MONTHS(SYSDATE, -:m) GROUP BY ITM_NO, PRNTR_NM)
            WHERE rn = 1 AND PRNTR_NM IS NOT NULL`, window);

    const vats = await q(`SELECT ITM_NO, VAT_RATE FROM (
                SELECT ITM_NO, VAT_RATE, ROW_NUMBER() OVER (PARTITION BY ITM_NO ORDER BY COUNT(*) DESC) rn
                  FROM CC_BILL_ENTER3 WHERE DOC_DATE >= ADD_MONTHS(SYSDATE, -:m) GROUP BY ITM_NO, VAT_RATE)
            WHERE rn = 1`, window);

    const units = await q(`SELECT ITM_NO, UNIT_NM FROM (
                SELECT ITM_NO, UNIT_NM, ROW_NUMBER() OVER (PARTITION BY ITM_NO ORDER BY COUNT(*) DESC) rn
                  FROM CC_BILL_ENTER3 WHERE DOC_DATE >= ADD_MONTHS(SYSDATE, -:m) GROUP BY ITM_NO, UNIT_NM)
            WHERE rn = 1`, window);

    const cashiers = await q(`SELECT ITM_NO, CSHR_NO, CNT FROM (
                SELECT ITM_NO, CSHR_NO, COUNT(*) CNT, ROW_NUMBER() OVER (PARTITION BY ITM_NO, CSHR_NO ORDER BY COUNT(*) DESC) rn
                  FROM CC_BILL_ENTER3 WHERE DOC_DATE >= ADD_MONTHS(SYSDATE, -:m) GROUP BY ITM_NO, CSHR_NO)
            WHERE rn = 1`, window);

    await closeKeptConn();

    const act = new Map(activity.map((r) => [String(r[0]).trim(), r]));
    const prn = new Map(printers.map((r) => [String(r[0]).trim(), String(r[1]).trim()]));
    const vat = new Map(vats.map((r) => [String(r[0]).trim(), num(r[1])]));
    const unt = new Map(units.map((r) => [String(r[0]).trim(), String(r[1]).trim()]));
    const csh = new Map();
    for (const r of cashiers) {
        const code = String(r[0]).trim();
        if (!csh.has(code)) {csh.set(code, []);}
        csh.get(code).push({ cashier: String(r[1]).trim(), lines: num(r[2]) });
    }

    const items = [];
    let inactive = 0;
    for (const r of priced) {
        const code = String(r[0]).trim();
        const a = act.get(code);
        if (!a) {inactive += 1; continue;}
        const category = clean(r[4]);
        const printer = prn.get(code) || null;
        const kot = printer ? KOT_BY_PRINTER[printer] : null;
        const isBuffet = /بوفيه/i.test(category);
        const deptCode = kot ? (kot.altDept && isBuffet ? kot.altDept : kot.dept) : null;
        const yaraUnit = unt.get(code) || '';
        const unit = yaraUnit === 'كيلو' ? 'كيلو' : (DRINK_CATEGORY.test(category) ? 'كوب' : 'طبق');
        items.push({
            yara_code: code,
            name: clean(r[1]),
            barcode: code,
            yara_barcode: clean(r[2]),
            category,
            price: money(r[5]),
            vat_rate: vat.get(code) ?? 15,
            unit,
            yara_unit: yaraUnit,
            printer,
            kot_dept_code: deptCode,
            kot_label: kot ? (kot.altDept && isBuffet ? kot.altLabel : kot.label) : null,
            cashiers: (csh.get(code) || []).map((x) => x.cashier).sort(),
            lines: num(a[1]),
            qty: num(a[2]),
            last_sale: a[3] ? new Date(a[3]).toISOString().slice(0, 10) : null,
        });
    }
    return { items, priced_total: priced.length, inactive };
}

// ─── 2) حالة كريم الحالية ─────────────────────────────────────────────────
async function pullKarimState() {
    const departments = (await pool.query(`SELECT id, code, name_ar, is_active FROM pos_departments ORDER BY id`)).rows;
    const products = (await pool.query(
        `SELECT id, barcode, name_ar, price, vat_rate, is_active, category, unit, department_id,
                COALESCE(metadata, '{}'::jsonb) AS metadata
           FROM pos_products ORDER BY id`)).rows;
    const links = (await pool.query(`SELECT product_id, department_id FROM pos_product_departments`)).rows;
    const deptByCode = new Map(departments.map((d) => [d.code, d]));
    const byYaraCode = new Map();
    const byBarcode = new Map();
    const manual = [];
    for (const p of products) {
        const meta = p.metadata || {};
        const ycode = meta.yara_code ? String(meta.yara_code) : null;
        if (ycode) {byYaraCode.set(ycode, p);} else {manual.push(p);}
        if (p.barcode) {byBarcode.set(String(p.barcode), p);}
    }
    return { departments, deptByCode, products, links, byYaraCode, byBarcode, manual };
}

// ─── 3) بناء خطة الاستيراد ────────────────────────────────────────────────
function buildPlan(yara, karim) {
    const visibleDepartments = karim.departments.filter((d) => d.is_active !== false).map((d) => Number(d.id));
    const plan = { create: [], update: [], unchanged: [], conflicts: [], excluded_duplicates: [] };

    for (const item of yara.items) {
        const dept = item.kot_dept_code ? karim.deptByCode.get(item.kot_dept_code) : null;
        if (item.kot_dept_code && !dept) {
            plan.conflicts.push({ type: 'missing_department', yara_code: item.yara_code, dept: item.kot_dept_code });
            continue;
        }
        const metadata = {
            catalog_scope: 'menu',
            managed_in: 'yara_import',
            source: 'yarasoft',
            yara_code: item.yara_code,
            yara_name: item.name,
            yara_category: item.category,
            yara_printer: item.printer || null,
            yara_unit: item.yara_unit || null,
            yara_cashiers: item.cashiers,
            yara_last_sale: item.last_sale,
            yara_window_months: WINDOW_MONTHS,
            imported_at: IMPORTED_AT,
        };
        const target = {
            name_ar: item.name,
            name_en: item.name,
            barcode: item.barcode,
            price: item.price,
            vat_rate: item.vat_rate,
            category: item.category,
            unit: item.unit,
            department_id: dept ? Number(dept.id) : null,
            metadata,
        };

        const existing = karim.byYaraCode.get(item.yara_code);
        if (!existing) {
            const barcodeHit = karim.byBarcode.get(item.barcode);
            if (barcodeHit) {
                plan.conflicts.push({
                    type: 'barcode_taken_by_manual_product',
                    yara_code: item.yara_code, name: item.name,
                    existing_id: Number(barcodeHit.id), existing_name: barcodeHit.name_ar,
                });
                continue;
            }
            plan.create.push({ ...target, yara_code: item.yara_code, yara_printer: item.printer, yara_last_sale: item.last_sale, yara_lines: item.lines, yara_cashiers: item.cashiers });
            continue;
        }

        const changed = [];
        if (money(existing.price) !== target.price) {changed.push(`price ${money(existing.price)}→${target.price}`);}
        if (clean(existing.name_ar) !== target.name_ar) {changed.push('name');}
        if (num(existing.vat_rate) !== target.vat_rate) {changed.push('vat');}
        if (clean(existing.category) !== target.category) {changed.push('category');}
        if (clean(existing.unit) !== target.unit) {changed.push('unit');}
        if (Number(existing.department_id || 0) !== Number(target.department_id || 0)) {changed.push('department');}
        if (existing.is_active !== true) {changed.push('activate');}
        if (!changed.length) {plan.unchanged.push({ id: Number(existing.id), yara_code: item.yara_code, name: item.name }); continue;}
        plan.update.push({
            id: Number(existing.id),
            yara_code: item.yara_code,
            name: item.name,
            price: target.price,
            changed,
            before: { price: money(existing.price), name_ar: existing.name_ar, vat_rate: num(existing.vat_rate), category: existing.category, unit: existing.unit, department_id: existing.department_id, is_active: existing.is_active },
            target,
        });
    }

    // تشابه الأسماء والأسعار داخل المنيو المستورد (مراجعة يدوية من المالك)
    const seen = new Map();
    for (const c of plan.create) {
        const key = `${clean(c.name_ar).toLowerCase()}|${c.price}`;
        if (seen.has(key)) {plan.excluded_duplicates.push({ a: seen.get(key), b: c.yara_code });}
        else {seen.set(key, c.yara_code);}
    }
    return { ...plan, visibleDepartments };
}

// ─── 4) التنفيذ ───────────────────────────────────────────────────────────
async function applyPlan(plan) {
    const client = await pool.connect();
    const created = [];
    const updated = [];
    const kotIds = [];
    try {
        await client.query('BEGIN');
        for (const c of plan.create) {
            const r = await client.query(
                `INSERT INTO pos_products
                    (name_ar, name_en, barcode, price, cost_price, vat_rate, stock_quantity,
                     min_stock_level, is_active, category, unit, department_id, metadata)
                 VALUES ($1,$2,$3,$4,NULL,$5,0,0,true,$6,$7,$8,$9::jsonb)
                 RETURNING id`,
                [c.name_ar, c.name_en, c.barcode, c.price, c.vat_rate, c.category, c.unit, c.department_id, JSON.stringify(c.metadata)]);
            const newId = Number(r.rows[0].id);
            created.push({ id: newId, yara_code: c.yara_code, name: c.name_ar, price: c.price });
            if (c.department_id) {kotIds.push(newId);}
        }
        for (const u of plan.update) {
            await client.query(
                `UPDATE pos_products
                    SET name_ar = $2, name_en = $3, price = $4, vat_rate = $5, category = $6,
                        unit = $7, department_id = $8, is_active = true, cost_price = NULL,
                        metadata = COALESCE(metadata, '{}'::jsonb) || $9::jsonb,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE id = $1`,
                [u.id, u.target.name_ar, u.target.name_en, u.target.price, u.target.vat_rate,
                    u.target.category, u.target.unit, u.target.department_id, JSON.stringify(u.target.metadata)]);
            updated.push(u.id);
        }
        // الظهور في شاشات الكاشير: كل قسم نشط — لمن له KOT فقط؛ فمن بلا KOT
        // يظهر في كل الأقسام تلقائيًا (قاعدة department_id IS NULL).
        if (plan.visibleDepartments.length) {
            const withKot = kotIds.concat(plan.update.filter((u) => u.target.department_id).map((u) => u.id));
            for (const id of withKot) {
                await client.query(
                    `INSERT INTO pos_product_departments (product_id, department_id)
                     SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`,
                    [id, plan.visibleDepartments]);
            }
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
    return { created, updated };
}

// ─── 5) الرجوع ────────────────────────────────────────────────────────────
async function rollback(reportFile) {
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    if (report.mode !== 'apply') {throw new Error('هذا التقرير معاينة ولم يكتب شيئًا — لا شيء للرجوع عنه');}
    const client = await pool.connect();
    let removed = 0;
    let restored = 0;
    try {
        await client.query('BEGIN');
        for (const c of report.actions?.created || []) {
            const r = await client.query(
                `DELETE FROM pos_products WHERE id = $1 AND metadata->>'yara_code' = $2 RETURNING id`,
                [c.id, c.yara_code]);
            removed += r.rows.length;
        }
        for (const u of report.actions?.updated || []) {
            const b = u.before || {};
            const r = await client.query(
                `UPDATE pos_products SET name_ar=$2, price=$3, vat_rate=$4, category=$5, unit=$6,
                        department_id=$7, is_active=$8, updated_at=CURRENT_TIMESTAMP
                  WHERE id=$1 AND metadata->>'yara_code'=$9 RETURNING id`,
                [u.id, b.name_ar, b.price, b.vat_rate, b.category, b.unit, b.department_id, b.is_active, u.yara_code]);
            restored += r.rows.length;
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
    console.log(`رجوع: حُذف ${removed} صنفًا أُنشئ، ورُجع ${restored} صنفًا حُدِّث.`);
}

// ─── المخرجات ─────────────────────────────────────────────────────────────
function printPlan(report) {
    const p = report.plan;
    console.log('\n════════ استيراد منيو يارا ← كريم ════════');
    console.log(`وضع التشغيل       : ${report.mode}${APPLY ? '' : '  (معاينة — لم تُكتب أي بيانات)'}`);
    console.log(`نافذة النشاط      : ${report.window_months} شهرًا (آخر بيع في يارا: ${report.yara.last_sale_max})`);
    console.log(`أصناف مسعّرة      : ${report.yara.priced_total}`);
    console.log(`أصناف نشطة تُستورد: ${report.yara.active}`);
    console.log(`أصناف مستبعدة     : ${report.yara.inactive} (لم تُبع في النافذة)`);
    console.log(`— جديد             : ${p.create.length}`);
    console.log(`— يُحدَّث           : ${p.update.length}`);
    console.log(`— بلا تغيير        : ${p.unchanged.length}`);
    console.log(`— تعارضات          : ${p.conflicts.length}`);
    console.log(`أصناف المالك اليدوية (لم تُمَسّ): ${report.karim.manual_count}`);
    console.log(`أقسام الظهور      : ${report.plan.visibleDepartments.length}`);
    console.log(`توزيع الأقسام (KOT): ${JSON.stringify(report.kot_distribution)}`);
    console.log(`التصنيفات         : ${report.category_count} — ${report.categories_sample.join(' · ')}`);
    if (p.update.length) {
        console.log('\nأمثلة تعديل السعر:');
        for (const u of p.update.slice(0, 8)) {console.log(`  #${u.id} ${u.name}: ${u.changed.join(', ')}`);}
    }
    if (p.conflicts.length) {
        console.log('\nتعارضات (لا تُستورد):');
        for (const c of p.conflicts.slice(0, 10)) {console.log(`  ${JSON.stringify(c)}`);}
    }
    if (p.excluded_duplicates.length) {
        console.log(`\nأصناف متشابهة الاسم والسعر (مراجعة يدوية): ${p.excluded_duplicates.length}`);
        for (const d of p.excluded_duplicates.slice(0, 8)) {console.log(`  ${d.a} ≈ ${d.b}`);}
    }
    console.log(`\nالتقرير: ${report.report_file}`);
}

(async () => {
    const rollbackFile = argValue('--rollback=');
    if (rollbackFile) {
        await rollback(rollbackFile);
        await pool.end();
        return;
    }
    if (APPLY && argValue('--confirm-write=') !== dbName) {
        console.error(`رفض الكتابة: أعد التشغيل مع --apply --confirm-write=${dbName}`);
        process.exitCode = 2;
        await pool.end();
        return;
    }

    const yara = await pullYaraMenu();
    const karim = await pullKarimState();
    const plan = buildPlan(yara, karim);

    const kotDistribution = {};
    const deptCodeOf = (id) => karim.departments.find((d) => Number(d.id) === Number(id))?.code || 'بلا KOT';
    for (const c of plan.create) {const k = deptCodeOf(c.department_id); kotDistribution[k] = (kotDistribution[k] || 0) + 1;}
    for (const u of plan.update) {const k = deptCodeOf(u.target.department_id); kotDistribution[k] = (kotDistribution[k] || 0) + 1;}
    const categories = [...new Set(yara.items.map((i) => i.category))];

    const report = {
        mode: APPLY ? 'apply' : 'dry_run',
        started_at: IMPORTED_AT,
        window_months: WINDOW_MONTHS,
        database: dbName,
        yara: {
            priced_total: yara.priced_total,
            active: yara.items.length,
            inactive: yara.inactive,
            last_sale_max: yara.items.map((i) => i.last_sale).filter(Boolean).sort().pop() || null,
        },
        karim: {
            products_before: karim.products.length,
            manual_count: karim.manual.length,
            manual_products: karim.manual.map((p) => ({ id: Number(p.id), name: p.name_ar, price: money(p.price) })),
        },
        plan,
        kot_distribution: kotDistribution,
        category_count: categories.length,
        categories_sample: categories.slice(0, 8),
        actions: { created: [], updated: [] },
    };

    if (APPLY) {
        const result = await applyPlan(plan);
        report.actions.created = result.created;
        report.actions.updated = plan.update;
        report.karim.products_after = karim.products.length + result.created.length;
    }

    const outDir = argValue('--json=') || path.join(__dirname, '..', 'database', 'backups');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `menu-yara-import-${IMPORTED_AT.replace(/[:.]/g, '-')}.json`);
    report.report_file = outFile;
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

    printPlan(report);
    if (APPLY) {console.log(`\n✓ كُتب ${report.actions.created.length} صنفًا جديدًا وحُدِّث ${report.actions.updated.length}.`);}
    await pool.end();
})().catch(async (e) => {
    console.error('فشل السكربت:', e.message);
    try {await pool.end();} catch (_) {}
    process.exitCode = 1;
});
