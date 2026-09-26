/**
 * yarasoft/oracle-catalog.js — مزامنة كتالوج يارسوفت (مشتريات/أرصدة/عملاء/أصول)
 * ────────────────────────────────────────────────────────────────────────────
 *  1) فواتير المشتريات BILL_ENTER4/6 (سطريّة) → purchaseInvoices (idempotent
 *     بمفتاح ora-buy:<TABLE>:<DOC_NO> — إعادة التشغيل لا تكرر).
 *  2) أرصدة الأصناف BALANCES → تعبئة كمية المخزون الصفرية فقط (لا يمسّ أي
 *     حركة لاحقة — معايرة أولية آمنة).
 *  3) دليل العملاء CUSTOMER → مرآة ys_customers (upsert).
 *  4) الأصول الثابتة ASSTS → مرآة ys_assets (upsert).
 * قراءة فقط من Oracle — الكتابة في karim فقط.
 */

'use strict';

const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { sanitizeError, oraExecute } = require('./oracle-link');

let _oracledb = null;
function ora() {
    if (!_oracledb) {
         
        _oracledb = require('oracledb');
        const ic = (process.env.YARASOFT_ORACLE_IC_PATH || '').trim();
        if (ic) { try { _oracledb.initOracleClient({ libDir: ic }); } catch (_) {} }
    }
    return _oracledb;
}

async function oraConn() {
    const oracledb = ora();
    return oracledb.getConnection({
        user: process.env.YARASOFT_ORACLE_USER,
        password: process.env.YARASOFT_ORACLE_PASSWORD,
        connectString: `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${process.env.YARASOFT_ORACLE_HOST || '192.168.1.188'})(PORT=${Number(process.env.YARASOFT_ORACLE_PORT) || 1521}))(CONNECT_DATA=(SERVICE_NAME=${process.env.YARASOFT_ORACLE_SERVICE || 'ORACLE'})))`,
    });
}

const DAY = (d) => { try { const x = d instanceof Date ? d : new Date(d); return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10); } catch (_) { return null; }; };
const NUM = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };

// ─── 1) المشتريات ───────────────────────────────────────────────────────────
async function syncPurchases(days = 30, full = false) {
    let conn = null;
    const out = { invoices: 0, lines: 0, posted: 0, duplicates: 0, nullDates: 0 };
    try {
        conn = await oraConn();
        const since = full ? '2000-01-01' : `TRUNC(SYSDATE) - ${Math.max(1, Math.min(3650, Number(days) || 30))}`;
        const tables = ['BILL_ENTER4', 'BILL_ENTER6'];
        for (const t of tables) {
            const r = await oraExecute(conn,
                `SELECT DOC_NO, MODI_TIME, ACC_NO, ACC_NM, OPS_ACCNM, ITM_NO, ITM_NAME, QNT, UNIT, COST_PRICE
                   FROM ${t} WHERE (MODI_TIME IS NULL OR MODI_TIME >= TRUNC(SYSDATE) - ${Math.max(1, Math.min(3650, Number(days) || 30))} OR ${full ? '1=1' : '1=0'})
                   ORDER BY DOC_NO`,
                {}, { outFormat: ora().OBJECT }
            );
            const groups = new Map();
            for (const row of r.rows || []) {
                out.lines++;
                const doc = String(row.DOC_NO ?? '').trim() || 'NODOC';
                const key = `${t}:${doc}`;
                if (!groups.has(key)) {groups.set(key, { key, table: t, doc, date: DAY(row.MODI_TIME), supplier: row.ACC_NM || row.ACC_NO || 'مورد يارسوفت', dept: row.OPS_ACCNM || null, items: [] });}
                const g = groups.get(key);
                if (!g.date && row.MODI_TIME) {g.date = DAY(row.MODI_TIME);}
                if (row.MODI_TIME == null) {out.nullDates++;}
                g.items.push({ code: row.ITM_NO, name: row.ITM_NAME, qty: NUM(row.QNT), unit: row.UNIT, price: NUM(row.COST_PRICE), total: NUM(NUM(row.QNT) * NUM(row.COST_PRICE)) });
            }
            void since;
            for (const g of groups.values()) {
                out.invoices++;
                const invoiceNumber = `ora-buy:${g.key}`;
                const date = g.date || new Date().toISOString().slice(0, 10);
                const total = NUM(g.items.reduce((s, it) => s + it.total, 0));
                const exists = await pool.query(`SELECT id FROM "purchaseInvoices" WHERE "invoiceNumber" = $1 LIMIT 1`, [invoiceNumber]);
                if (exists.rows[0]) { out.duplicates++; continue; }
                const nid = Date.now() * 1000 + Math.floor(Math.random() * 900) + (out.invoices % 900);
                await pool.query(
                    `INSERT INTO "purchaseInvoices" (id, "invoiceNumber", date, "supplierName", items, "totalAmount", "paymentMethod", notes, "createdAt", "paymentStatus")
                     VALUES ($1,$2,$3,$4,$5,$6,'آجل',$7,NOW()::text,'unpaid')`,
                    [nid, invoiceNumber, date, String(g.supplier).slice(0, 255), JSON.stringify(g.items), total,
                        `[AUTO:YARASOFT-ORA] ${g.table} فاتورة ${g.doc}${g.dept ? ' — ' + g.dept : ''} (${g.items.length} صنف)`]
                );
                out.posted++;
            }
        }
        return { ok: true, ...out };
    } catch (e) {
        return { ok: false, error: sanitizeError(e.message), ...out };
    } finally { try { if (conn) {await conn.close();} } catch (_) {} }
}

// ─── 2ب) نسخ الأرصدة بمصفاة جودة (قرار المالك: نسخ المخازن عندنا) ───
// القيم الشاذة (مثل رصيد 2.3 مليار لقفازات) تُعزل في الحجر ولا تدخل الرصيد.
const QTY_CAP = 100000000;      // أقصى كمية منطقية للصنف الواحد
const VALUE_CAP = 100000000;    // أقصى قيمة منطقية للرصيد
const UNIT_CAP = 1000000;       // أقصى سعر وحدة منطقي
async function syncBalancesSafe({ force = false } = {}) {
    let conn = null;
    const out = { rows: 0, applied: 0, skippedNonZero: 0, unmapped: 0, quarantined: 0 };
    try {
        conn = await oraConn();
        const r = await oraExecute(conn,
            `SELECT ITM_NO, TOTAL_QNT_BAL, TOTAL_VAL_BAL, COST_PRICE FROM BALANCES`,
            {}, { outFormat: ora().OBJECT });
        const map = await pool.query(`SELECT external_code, internal_product_id FROM yarasoft_product_mapping WHERE active = true AND external_code IS NOT NULL`);
        const byCode = new Map(map.rows.map(x => [String(x.external_code), x.internal_product_id]));
        const invByCode = new Map((await pool.query(
            `SELECT id, external_code FROM inventory WHERE external_code IS NOT NULL`)).rows.map(x => [String(x.external_code), x.id]));
        for (const row of r.rows || []) {
            out.rows++;
            const code = row.ITM_NO != null ? String(row.ITM_NO).trim() : '';
            const qty = Number(row.TOTAL_QNT_BAL);
            const val = Number(row.TOTAL_VAL_BAL);
            const cost = Number(row.COST_PRICE);
            const pid = byCode.get(code) || invByCode.get(code) || null;
            if (!pid) { out.unmapped++; continue; }
            const problems = [];
            if (!Number.isFinite(qty) || qty < 0 || qty > QTY_CAP) {problems.push(`كمية غير منطقية (${row.TOTAL_QNT_BAL})`);}
            if (!Number.isFinite(val) || Math.abs(val) > VALUE_CAP) {problems.push(`قيمة غير منطقية (${row.TOTAL_VAL_BAL})`);}
            if (qty > 0 && Number.isFinite(val)) {
                const unit = val / qty;
                if (!(unit > 0) || unit > UNIT_CAP) {problems.push(`سعر وحدة شاذ (${unit})`);}
            }
            if (row.COST_PRICE != null && (!Number.isFinite(cost) || cost < 0 || cost > UNIT_CAP)) {problems.push(`تكلفة شاذة (${row.COST_PRICE})`);}
            if (problems.length) {
                out.quarantined++;
                await pool.query(
                    `INSERT INTO yarasoft_quality_quarantine (kind, ref_code, qty, value_amount, unit_cost, reason)
                     VALUES ('balance', $1, $2, $3, $4, $5)`,
                    [code || null, Number.isFinite(qty) ? qty : null,
                        Number.isFinite(val) ? Math.round(val * 100) / 100 : null,
                        (qty > 0 && Number.isFinite(val)) ? Math.round((val / qty) * 100) / 100 : null,
                        problems.join('؛ ').slice(0, 500)]);
                continue;
            }
            const unitCost = qty > 0 ? Math.round((val / qty) * 100) / 100
                : (Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 100) / 100 : 0);
            const upd = force
                ? await pool.query(`UPDATE inventory SET qty = $2, "avgCost" = $3 WHERE id = $1`, [pid, qty, unitCost])
                : await pool.query(`UPDATE inventory SET qty = $2, "avgCost" = $3 WHERE id = $1 AND qty = 0`, [pid, qty, unitCost]);
            if (upd.rowCount) {out.applied++;}
            else {out.skippedNonZero++;}
        }
        return { ok: true, ...out };
    } catch (e) {
        return { ok: false, error: sanitizeError(e.message), ...out };
    } finally { try { if (conn) {await conn.close();} } catch (_) {} }
}
async function syncBalances() {
    let conn = null;
    const out = { rows: 0, calibrated: 0, skippedNonZero: 0, unmapped: 0 };
    try {
        conn = await oraConn();
        const r = await oraExecute(conn, `SELECT ITM_NO, ON_HAND_BAL, COST_PRICE FROM BALANCES`, {}, { outFormat: ora().OBJECT });
        const map = await pool.query(`SELECT external_code, internal_product_id FROM yarasoft_product_mapping WHERE active = true AND external_code IS NOT NULL`);
        const byCode = new Map(map.rows.map(x => [String(x.external_code), x.internal_product_id]));
        for (const row of r.rows || []) {
            out.rows++;
            const pid = byCode.get(String(row.ITM_NO));
            if (!pid) { out.unmapped++; continue; }
            const bal = NUM(row.ON_HAND_BAL);
            const upd = await pool.query(`UPDATE inventory SET qty = $2 WHERE id = $1 AND qty = 0`, [pid, bal]);
            if (upd.rowCount) {out.calibrated++;}
            else {out.skippedNonZero++;}
        }
        return { ok: true, ...out };
    } catch (e) {
        return { ok: false, error: sanitizeError(e.message), ...out };
    } finally { try { if (conn) {await conn.close();} } catch (_) {} }
}

// ─── 3) العملاء ────────────────────────────────────────────────────────────
async function syncCustomers() {
    let conn = null;
    const out = { rows: 0, upserted: 0 };
    try {
        conn = await oraConn();
        const r = await oraExecute(conn, `SELECT CUST_ID, CNAME, H_PHONE, W_PHONE, M_PHONE, ADRS, ACTV FROM CUSTOMER`, {}, { outFormat: ora().OBJECT });
        for (const row of r.rows || []) {
            out.rows++;
            const code = String(row.CUST_ID ?? '').trim();
            if (!code) {continue;}
            const phones = [row.H_PHONE, row.W_PHONE, row.M_PHONE].filter(Boolean).map(String).join(' / ').slice(0, 255);
            await pool.query(
                `INSERT INTO ys_customers (code, name, phones, address, active, synced_at)
                 VALUES ($1,$2,$3,$4,$5,NOW())
                 ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, phones = EXCLUDED.phones,
                   address = EXCLUDED.address, active = EXCLUDED.active, synced_at = NOW()`,
                [code, row.CNAME ? String(row.CNAME).slice(0, 255) : null, phones || null,
                    row.ADRS ? String(row.ADRS).slice(0, 255) : null, row.ACTV ? String(row.ACTV).slice(0, 10) : null]
            );
            out.upserted++;
        }
        return { ok: true, ...out };
    } catch (e) {
        return { ok: false, error: sanitizeError(e.message), ...out };
    } finally { try { if (conn) {await conn.close();} } catch (_) {} }
}

// ─── 4) الأصول ─────────────────────────────────────────────────────────────
async function syncAssets() {
    let conn = null;
    const out = { rows: 0, upserted: 0 };
    try {
        conn = await oraConn();
        const r = await oraExecute(conn, `SELECT ASSTS_ID, ASSTS_NM, TYP_NAME, P_DATE, P_PRICE, SUPL, BARCOD_NO FROM ASSTS`, {}, { outFormat: ora().OBJECT });
        for (const row of r.rows || []) {
            out.rows++;
            const aid = String(row.ASSTS_ID ?? '').trim();
            if (!aid) {continue;}
            await pool.query(
                `INSERT INTO ys_assets (asset_id, name, type_name, buy_date, buy_price, supplier, barcode, synced_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
                 ON CONFLICT (asset_id) DO UPDATE SET name = EXCLUDED.name, type_name = EXCLUDED.type_name,
                   buy_date = EXCLUDED.buy_date, buy_price = EXCLUDED.buy_price, supplier = EXCLUDED.supplier,
                   barcode = EXCLUDED.barcode, synced_at = NOW()`,
                [aid, row.ASSTS_NM ? String(row.ASSTS_NM).slice(0, 255) : null,
                    row.TYP_NAME ? String(row.TYP_NAME).slice(0, 255) : null,
                    DAY(row.P_DATE), NUM(row.P_PRICE),
                    row.SUPL ? String(row.SUPL).slice(0, 255) : null,
                    row.BARCOD_NO ? String(row.BARCOD_NO).slice(0, 100) : null]
            );
            out.upserted++;
        }
        return { ok: true, ...out };
    } catch (e) {
        return { ok: false, error: sanitizeError(e.message), ...out };
    } finally { try { if (conn) {await conn.close();} } catch (_) {} }
}

// ─── 5) تنظيم فئات المخزن من شجرة يارا سوفت (LVL2) — دون مساس بالسحب ───
// يحدّث عمود category فقط للأصناف المربوطة (external_code) — مفاتيح المزامنة
// (الكود/الباركود/الكميات/الأسعار) لا تُلمس أبدًا، فالاستيراد والمزامنة يعملان كما هما.
async function organizeCategories() {
    let conn = null;
    const out = { groups: 0, categorized: 0, alreadyOk: 0, unmapped: 0 };
    try {
        conn = await oraConn();
        const g = await oraExecute(conn, `SELECT ITM_NO, ITMNAME FROM ITEMS WHERE LVL IN (1,2)`, {}, { outFormat: ora().OBJECT });
        const groups = new Map();
        for (const row of g.rows || []) {
            const code = String(row.ITM_NO || '').trim();
            const name = String(row.ITMNAME || '').trim();
            if (code && name) {groups.set(code, name);}
        }
        // الأطول أولًا: كود 010101 يتبع 0101 لا 01
        const ordered = [...groups.entries()].sort((a, b) => b[0].length - a[0].length);
        out.groups = groups.size;
        if (!groups.size) {return { ok: false, error: 'لا مجموعات في يارا سوفت', ...out };}
        const items = await pool.query(`SELECT id, external_code, category FROM inventory WHERE external_code IS NOT NULL`);
        for (const inv of items.rows) {
            const code = String(inv.external_code).trim();
            let parent = null;
            if (groups.has(code)) {parent = 'مجموعات';} // رأس مجموعة مستورد كصنف
            else {
                for (const [gcode, gname] of ordered) {
                    if (code.startsWith(gcode) && code.length > gcode.length) { parent = gname; break; }
                }
            }
            if (!parent) { out.unmapped++; continue; }
            if (String(inv.category || '').trim() === parent) { out.alreadyOk++; continue; }
            await pool.query(`UPDATE inventory SET category = $2 WHERE id = $1`, [inv.id, parent.slice(0, 100)]);
            out.categorized++;
        }
        return { ok: true, ...out };
    } catch (e) {
        return { ok: false, error: sanitizeError(e.message), ...out };
    } finally { try { if (conn) {await conn.close();} } catch (_) {} }
}

async function catalogStatus() {
    const q = async (sql) => (await pool.query(sql)).rows[0];
    return {
        purchases: await q(`SELECT count(*)::int AS n, COALESCE(sum("totalAmount"),0) AS t FROM "purchaseInvoices" WHERE "invoiceNumber" LIKE 'ora-buy:%'`),
        zeroQty: await q(`SELECT count(*)::int AS n FROM inventory WHERE qty = 0`),
        withQty: await q(`SELECT count(*)::int AS n FROM inventory WHERE qty <> 0`),
        customers: await q(`SELECT count(*)::int AS n FROM ys_customers`),
        assets: await q(`SELECT count(*)::int AS n, COALESCE(sum(buy_price),0) AS t FROM ys_assets`),
    };
}

module.exports = { syncPurchases, syncBalances, syncBalancesSafe, syncCustomers, syncAssets, catalogStatus, organizeCategories };
