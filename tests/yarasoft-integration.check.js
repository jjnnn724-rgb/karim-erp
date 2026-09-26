#!/usr/bin/env node
/**
 * tests/yarasoft-integration.check.js — تحقق تكامل حي لخط استيراد Yarasoft
 * ════════════════════════════════════════════════════════════════════════════
 * يعمل ضد PostgreSQL المثبتة فعليًا (نفس نمط zkteco-integration.check.js):
 *   node tests/yarasoft-integration.check.js
 *
 * يثبت سيناريوهات المواصفة على قاعدة حقيقية:
 *   1) المخطط idempotent (تطبيق مرتين)
 *   2) DRY_RUN: تحليل ومطابقة بلا أي كتابة في revenues/inventory
 *   3) استيراد فعلي: إيراد + خصم مخزون في معاملة واحدة (ledger حقيقي)
 *   4) الازدواج: نفس الملف مرة ثانية → DUPLICATE بلا إيراد جديد
 *   5) رقم مكرر بملف مختلف → DUPLICATE
 *   6) صنف بلا مطابقة → REQUIRES_REVIEW ثم حل الربط ثم اكتمال
 *   7) مخزون غير كافٍ → فشل + ROLLBACK (لا إيراد بلا خصم ولا عكس)
 *   8) تنظيف كامل لبيانات الاختبار
 */

'use strict';

process.env.YARASOFT_DRY_RUN = 'false';
process.env.YARASOFT_ENABLED = 'true';
process.env.FILE_STABILITY_DELAY = '10';
process.env.FILE_STABILITY_CHECKS = '2';
process.env.YARASOFT_SCAN_INTERVAL = '1';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SHARE = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-share-'));
for (const d of ['Invoices', 'Invoices_Processing', 'Invoices_Archive', 'Invoices_Failed']) {
    fs.mkdirSync(path.join(SHARE, d), { recursive: true });
}
process.env.YARASOFT_SHARE = SHARE;
process.env.YARASOFT_LOCATION_CODE = 'MAIN-WAREHOUSE';

const { pool } = require('../backend/shared-pool');
const { logger } = require('../backend/logger');

let pass = 0, fail = 0;
function ok(cond, name) {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}`); }
}

async function main() {
    console.log('\n═══ تحقق تكامل Yarasoft على قاعدة حية ═══\n');

    // تنظيف دفاعي لبقايا تشغيل سابق (إن سقط سابقًا قبل التنظيف)
    await pool.query(`DELETE FROM yarasoft_review_items WHERE import_id IN (SELECT id FROM invoice_import_log WHERE external_invoice_number LIKE 'YK-%')`);
    await pool.query(`DELETE FROM invoice_import_log WHERE external_invoice_number LIKE 'YK-%'`);
    await pool.query(`DELETE FROM revenues WHERE external_ref LIKE 'yarasoft_pos:YK-%'`);
    await pool.query(`DELETE FROM inventory_ledger WHERE reference_type = 'yarasoft_invoice' AND reference_id LIKE 'YK-%'`);
    await pool.query(`DELETE FROM yarasoft_product_mapping WHERE external_code LIKE 'X%' AND external_code NOT LIKE 'X%\_%' AND external_code ~ '^X[0-9]+$'`);
    await pool.query(`DELETE FROM inventory WHERE name = 'YK-TEST-شاي'`);

    // 1) المخطط — تطبيق مزدوج
    const { ensureYarasoftSchema } = require('../backend/yarasoft/schema');
    await ensureYarasoftSchema();
    await ensureYarasoftSchema();
    ok(true, 'المخطط يُطبق مرتين دون خطأ (idempotent)');

    // أدوات مساعدة
    const { YarasoftEngine } = require('../backend/yarasoft/engine');
    const importer = require('../backend/yarasoft/importer');
    const engine = new YarasoftEngine();
    engine.config = { ...engine.config, dryRun: false, enabled: true, stabilityDelayMs: 10, stabilityChecks: 2 };
    const { loadConfig } = require('../backend/yarasoft/config');
    const config = { ...loadConfig(), dryRun: false, enabled: true, stabilityDelayMs: 10, stabilityChecks: 2 };

    // منتج اختباري + موقع رئيسي
    const stamp = Date.now() % 1000000;
    const TEST_BARCODE = `6281000${String(stamp).slice(-6)}T1`;
    const inv = (await pool.query(
        `INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty", barcode)
         VALUES (990001 + $1, 'YK-TEST-شاي', 'اختبار', 'علبة', 100, 5, 10, $2)
         RETURNING id`, [stamp, TEST_BARCODE])).rows[0];
    let locationId = (await pool.query(`SELECT id FROM inventory_locations WHERE code = 'MAIN-WAREHOUSE' AND active = true LIMIT 1`)).rows[0]?.id;
    if (!locationId) {
        locationId = (await pool.query(
            `INSERT INTO inventory_locations (code, name, active, negative_stock_policy)
             VALUES ('MAIN-WAREHOUSE', 'المخزن الرئيسي (اختبار)', true, 'deny')
             ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`)).rows[0]?.id;
    }
    if (!locationId) {throw new Error('لا يوجد موقع مخزون — أنشئ MAIN-WAREHOUSE');}
    // رصيد افتتاحي للموقع الجديد إن لم يوجد
    await pool.query(
        `INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand)
         VALUES ($1, $2, 100) ON CONFLICT (inventory_id, location_id) DO NOTHING`, [inv.id, locationId]);

    const file1 = path.join(SHARE, 'Invoices', `YK-TEST-1001.txt`);
    fs.writeFileSync(file1, [
        'InvoiceNo;Date;Customer;PayType',
        `YK-${stamp};31/01/2025;عميل اختبار;cash`,
        'Code;Barcode;Name;Qty;Price;Disc;VAT;Total',
        `T${stamp};${TEST_BARCODE};شاي اختبار;2;10.00;0;1.60;21.60`,
    ].join('\n'));

    // ── 2) DRY_RUN أولاً ──
    console.log('\n[2] DRY_RUN — تحليل بلا كتابة');
    const dryConfig = { ...config, dryRun: true };
    await importer.processFile({ filePath: file1, fileName: 'YK-TEST-1001.txt', config: dryConfig, importer: { io: null, profile: null } });
    const dryLog = (await pool.query(`SELECT status, payload FROM invoice_import_log WHERE external_invoice_number = $1`, [`YK-${stamp}`])).rows[0];
    ok(dryLog && dryLog.status === 'DRY_RUN', 'السجل DRY_RUN');
    const dryRev = await pool.query(`SELECT id FROM revenues WHERE external_ref = $1`, [`yarasoft_pos:YK-${stamp}`]);
    ok(dryRev.rowCount === 0, 'لا إيراد في DRY_RUN');
    const dryFileStillThere = fs.existsSync(file1);
    ok(dryFileStillThere, 'الملف لم يتحرك في DRY_RUN');

    // ── 3) استيراد فعلي ──
    console.log('\n[3] استيراد فعلي');
    const r1 = await importer.processFile({ filePath: file1, fileName: 'YK-TEST-1001.txt', config, importer: { io: null, profile: null } });
    ok(r1.status === 'COMPLETED', `النتيجة COMPLETED (${r1.status})`);
    const rev = (await pool.query(`SELECT id, amount, "deptId" FROM revenues WHERE external_ref = $1`, [`yarasoft_pos:YK-${stamp}`])).rows[0];
    ok(rev && Number(rev.amount) === 21.6, `إيراد 21.60 بمجموعة yarasoft_pos (${rev && rev.deptId})`);
    const ledger = (await pool.query(
        `SELECT * FROM inventory_ledger WHERE inventory_id = $1 AND transaction_type = 'sale_consumption' ORDER BY id DESC LIMIT 1`, [inv.id])).rows[0];
    ok(ledger && Number(ledger.quantity_delta) === -2, `حركة مخزون sale_consumption بكمية -2 (${ledger && ledger.quantity_delta})`);
    ok(ledger && ledger.idempotency_key && ledger.idempotency_key.startsWith('yarasoft:'), 'مفتاح idempotency للسطر يبدأ بـ yarasoft:');
    const bal = (await pool.query(`SELECT on_hand FROM inventory_location_balances WHERE inventory_id = $1 AND location_id = $2`, [inv.id, locationId])).rows[0];
    ok(bal && Number(bal.on_hand) === 98, `الرصيد بعد الخصم = 98 (${bal && bal.on_hand})`);
    const archived = fs.readdirSync(path.join(SHARE, 'Invoices_Archive'));
    ok(archived.length === 1, 'الملف نُقل إلى Invoices_Archive');

    // ── 4) نفس الملف مرة ثانية ──
    console.log('\n[4] ازدواج: نفس الملف');
    fs.copyFileSync(path.join(SHARE, 'Invoices_Archive', archived[0]), file1);
    const r2 = await importer.processFile({ filePath: file1, fileName: 'dup.txt', config, importer: { io: null, profile: null } });
    ok(r2.status === 'DUPLICATE', `النتيجة DUPLICATE (${r2.status})`);
    const revCount = (await pool.query(`SELECT COUNT(*)::int AS c FROM revenues WHERE external_ref = $1`, [`yarasoft_pos:YK-${stamp}`])).rows[0].c;
    ok(revCount === 1, 'إيراد واحد فقط');

    // ── 5) رقم مكرر بملف مختلف (هش مختلف) ──
    console.log('\n[5] ازدواج: رقم الفاتورة نفسه بملف مختلف');
    const file2 = path.join(SHARE, 'Invoices', `YK-TEST-1002.txt`);
    fs.writeFileSync(file2, [
        'InvoiceNo;Date;Customer;PayType',
        `YK-${stamp};01/02/2025;عميل آخر;card`,
        'Code;Barcode;Name;Qty;Price;Disc;VAT;Total',
        `T${stamp};${TEST_BARCODE};شاي اختبار;1;10.00;0;0.80;10.80`,
    ].join('\n'));
    const r3 = await importer.processFile({ filePath: file2, fileName: 'YK-TEST-1002.txt', config, importer: { io: null, profile: null } });
    ok(r3.status === 'DUPLICATE', `النتيجة DUPLICATE (${r3.status})`);

    // ── 6) صنف بلا مطابقة → مراجعة → حل → اكتمال ──
    console.log('\n[6] مراجعة صنف غير مطابق');
    const file3 = path.join(SHARE, 'Invoices', `YK-TEST-1003.txt`);
    fs.writeFileSync(file3, [
        'InvoiceNo;Date;Customer;PayType',
        `YK-R${stamp};02/02/2025;عميل;cash`,
        'Code;Barcode;Name;Qty;Price;Disc;VAT;Total',
        `X${stamp};;صنف مجهول;3;7.00;0;1.05;22.05`,
    ].join('\n'));
    const r4 = await importer.processFile({ filePath: file3, fileName: 'YK-TEST-1003.txt', config, importer: { io: null, profile: null } });
    ok(r4.status === 'REQUIRES_REVIEW', `النتيجة REQUIRES_REVIEW (${r4.status})`);
    ok(!!r4.logId, 'النتيجة تحمل معرف السجل');
    const revR = await pool.query(`SELECT id FROM revenues WHERE external_ref = $1`, [`yarasoft_pos:YK-R${stamp}`]);
    ok(revR.rowCount === 0, 'لا إيراد قبل حل المراجعة');
    // الملف نُقل إلى مجلد المعالجة بعد التعليم
    const file3now = fs.existsSync(file3) ? file3 : path.join(SHARE, 'Invoices_Processing', 'YK-TEST-1003.txt');
    const review = (await pool.query(
        `SELECT r.id FROM yarasoft_review_items r WHERE r.import_id = $1 AND r.resolved = false`, [r4.logId])).rows[0];
    ok(!!review, 'سجل مراجعة مُنشئ بالسبب');
    // إعادة معالجة أثناء معلّق → REVIEW_PENDING (لا تكرار سجلات)
    const r4b = await importer.processFile({ filePath: file3now, fileName: 'YK-TEST-1003.txt', config, importer: { io: null, profile: null } });
    ok(r4b.status === 'REVIEW_PENDING', 'إعادة المعالجة المعلقة تُرفض بأمان');
    // حلّ الربط
    await pool.query(
        `INSERT INTO yarasoft_product_mapping (external_code, internal_product_id, active)
         VALUES ($1, $2, true) ON CONFLICT DO NOTHING`, [`X${stamp}`, inv.id]);
    await pool.query(`UPDATE yarasoft_review_items SET resolved = true WHERE id = $1`, [review.id]);
    await pool.query(`UPDATE invoice_import_log SET status = 'DETECTED', retry_count = 0 WHERE id = $1`, [r4.logId]);
    const r5 = await importer.processFile({ filePath: file3now, fileName: 'YK-TEST-1003.txt', config, importer: { io: null, profile: null } });
    ok(r5.status === 'COMPLETED', `اكتملت بعد الحل (${r5.status})`);
    const revR2 = await pool.query(`SELECT amount FROM revenues WHERE external_ref = $1`, [`yarasoft_pos:YK-R${stamp}`]);
    ok(revR2.rowCount === 1 && Number(revR2.rows[0].amount) === 22.05, 'إيراد الفاتورة المحلولة 22.05');

    // ── 7) مخزون غير كافٍ → ROLLBACK ──
    console.log('\n[7] مخزون غير كافٍ → تراجع كامل');
    const file4 = path.join(SHARE, 'Invoices', `YK-TEST-1004.txt`);
    fs.writeFileSync(file4, [
        'InvoiceNo;Date;Customer;PayType',
        `YK-F${stamp};03/02/2025;عميل;cash`,
        'Code;Barcode;Name;Qty;Price;Disc;VAT;Total',
        `T${stamp};${TEST_BARCODE};شاي اختبار;99999;10.00;0;79999.60;999990.00`,
    ].join('\n'));
    const r6 = await importer.processFile({ filePath: file4, fileName: 'YK-TEST-1004.txt', config, importer: { io: null, profile: null } });
    ok(r6.status === 'FAILED', `النتيجة FAILED (${r6.status})`);
    const revF = await pool.query(`SELECT id FROM revenues WHERE external_ref = $1`, [`yarasoft_pos:YK-F${stamp}`]);
    ok(revF.rowCount === 0, 'لا إيراد بعد ROLLBACK (المعاملة ذرية)');
    const balF = (await pool.query(`SELECT on_hand FROM inventory_location_balances WHERE inventory_id = $1 AND location_id = $2`, [inv.id, locationId])).rows[0];
    ok(Number(balF.on_hand) === 95, `الرصيد لم يتأثر (95 = 100 − 2 − 3) (${balF.on_hand})`);

    console.log(`\n═══ النتيجة: ${pass} ناجح / ${fail} فاشل ═══\n`);

    // ── 8) تنظيف ──
    await pool.query(`DELETE FROM inventory_ledger WHERE inventory_id = $1`, [inv.id]);
    await pool.query(`DELETE FROM inventory_location_balances WHERE inventory_id = $1`, [inv.id]);
    await pool.query(`DELETE FROM yarasoft_review_items WHERE import_id IN (SELECT id FROM invoice_import_log WHERE source_file LIKE '%YK-TEST-%' OR source_file LIKE '%${SHARE}%')`, []);
    await pool.query(`DELETE FROM invoice_import_log WHERE source_file LIKE '%YK-TEST-%' OR source_file LIKE $1`, [`%${SHARE}%`]);
    await pool.query(`DELETE FROM yarasoft_product_mapping WHERE external_code LIKE 'X${stamp}%' OR external_code LIKE 'T${stamp}%'`);
    await pool.query(`DELETE FROM revenues WHERE external_ref LIKE 'yarasoft_pos:YK-%${stamp}%'`);
    await pool.query(`DELETE FROM inventory WHERE id = $1`, [inv.id]);
    fs.rmSync(SHARE, { recursive: true, force: true });
    console.log('🧹 نُظفت كل بيانات الاختبار');
    await pool.end();
    process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
    console.error('❌ فشل التحقق:', e.message);
    try { await pool.end(); } catch { /* تجاهل */ }
    process.exit(1);
});
