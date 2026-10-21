// مطابقة الرصيد الافتتاحي (شيت المالك «بداية النظام الجديد 2027») مع المخزن:
// لكل صنف: رصيد المخزن الرئيسي المستهدف = بداية الشيت − المنصرف بأذونات الصرف.
// التشغيل التجريبي بلا كتابة؛ --apply يطبّق بقيد count_correction موثق لكل صنف.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const XLSX = require('xlsx');
const { Pool } = require('pg');
const { postInventoryLedgerEntry } = require('../backend/inventory-ledger');

const APPLY = process.argv.includes('--apply');
const SHEET = 'C:/Users/RemoteHome/Downloads/رصيد مخزون بداية النظام الجديد 2027.xlsx';

const pool = new Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
const norm = (s) => String(s || '').toLowerCase().replace(/[\s\u00a0\t]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const r3 = (x) => Math.round(Number(x) * 1000) / 1000;

(async () => {
  // 1) الشيت — تطبيع عناوين الأعمدة (المسافات الزايدة/المضاعفة في الشيت الأصلي)
  const wb = XLSX.readFile(SHEET);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const rows = raw.map(r => {
    const o = {};
    for (const [k, v] of Object.entries(r)) { o[String(k).trim()] = v; }
    return o;
  });
  const sheet = rows.map(r => ({
    name: String(r['اسم الصنف'] || '').trim(),
    unit: String(r['الوحدة'] || '').trim(),
    qty: Number(r['كمية'] ?? 0),
    price: Number(r['سعر الشراء'] ?? 0),
  })).filter(r => r.name && Number.isFinite(r.qty));

  // 2) قاعدة البيانات
  const mainLoc = (await pool.query(`SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active=true LIMIT 1`)).rows[0];
  const items = (await pool.query(`SELECT id, name, qty, unit, "avgCost" FROM inventory`)).rows;
  const byKey = new Map();
  for (const it of items) {
    const k = norm(it.name);
    if (!byKey.has(k)) {byKey.set(k, []);}
    byKey.get(k).push(it);
  }
  const mainId = Number(mainLoc.id);
  const balances = (await pool.query(`SELECT inventory_id, location_id, on_hand FROM inventory_location_balances`)).rows;
  const mainBal = new Map();
  for (const b of balances) {if (Number(b.location_id) === mainId) {mainBal.set(Number(b.inventory_id), Number(b.on_hand));}}
  const ledger = (await pool.query(
    `SELECT inventory_id, transaction_type, location_id, quantity_delta, reference_type, created_at
     FROM inventory_ledger`)).rows;

  // 3) المطابقة والحساب
  const toApply = []; const zeroDelta = []; const unmatched = []; const flagged = []; const dupKeys = [];
  const matchedIds = new Set();
  for (const s of sheet) {
    const k = norm(s.name);
    const candidates = byKey.get(k);
    if (!candidates || candidates.length === 0) { unmatched.push(s); continue; }
    if (candidates.length > 1) { dupKeys.push({ name: s.name, items: candidates.map(c => `#${c.id}«${c.name}»`) }); continue; }
    const it = candidates[0];
    const id = Number(it.id);
    matchedIds.add(id);

    // حركات المخزن الرئيسي لهذا الصنف من الدفتر
    const mainEntries = ledger.filter(l => Number(l.inventory_id) === id && Number(l.location_id) === mainId);
    let dispatchOut = 0, purchaseTotal = 0, otherDelta = 0;
    for (const l of mainEntries) {
      const d = Number(l.quantity_delta);
      if (l.transaction_type === 'transfer_out') { dispatchOut += Math.abs(d); }
      else if (l.transaction_type === 'purchase_receipt') { purchaseTotal += d; }
      else if (l.transaction_type === 'count_correction' || l.transaction_type === 'reversal') { /* تسويات سابقة تُمحى أثرها بالمطابقة */ }
      else { otherDelta += d; }
    }
    const target = r3(s.qty - dispatchOut);
    const current = mainBal.get(id) ?? 0;
    const delta = r3(target - current);
    const row = { id, name: it.name, unit: it.unit || s.unit, begin: s.qty, dispatchOut: r3(dispatchOut), purchaseTotal: r3(purchaseTotal), otherDelta: r3(otherDelta), target, current: r3(current), delta, price: s.price, dbCost: Number(it.avgCost) };
    if (Math.abs(otherDelta) > 0.001) { flagged.push({ ...row, why: `حركات أخرى بالرئيسي غير أذونات الصرف (صافي ${otherDelta}) — مراجعة يدوية` }); continue; }
    if (target < 0) { flagged.push({ ...row, why: `المستهدف سالب (صرف ${dispatchOut} أكبر من بداية ${s.qty})` }); continue; }
    // بكل احترافية: لا تعديل آلي لو بداية الشيت مختلفة عن استلام الاستيراد بالدفتر — تعرض للمالك
    if (Math.abs(purchaseTotal - s.qty) > 0.001) { flagged.push({ ...row, why: `بداية الشيت ${s.qty} ≠ استلام الاستيراد بالدفتر ${purchaseTotal} — تأكيد المالك مطلوب` }); continue; }
    if (Math.abs(delta) <= 0.001) { zeroDelta.push(row); continue; }
    toApply.push(row);
  }
  const notInSheet = items.filter(i => !matchedIds.has(Number(i.id)));

  // 4) التقرير
  const L = [];
  L.push(`صفوف الشيت: ${sheet.length} | متطابقة: ${sheet.length - unmatched.length - dupKeys.length} | بلا مقابل: ${unmatched.length} | أسماء مكررة بالمفتاح: ${dupKeys.length}`);
  L.push(`أصناف جاهزة للتعديل: ${toApply.length} | مطابقة أصلًا (بلا فرق): ${zeroDelta.length} | أعلام مراجعة: ${flagged.length} | أصناف بالقاعدة غير موجودة بالشيت: ${notInSheet.length}`);
  L.push('(قاعدة الأمان: أي صنف بداية الشيت فيه ≠ استلام الاستيراد بالدفتر لا يُعدل آليًا — يظهر في الأعلام لتأكيدك)');
  L.push('');
  L.push('=== سيُعدَّل (رصيد الرئيسي = بداية − المنصرف) ===');
  for (const r of toApply) {L.push(`«${r.name}»: بداية ${r.begin} − صرف ${r.dispatchOut} = ${r.target} | الحالي ${r.current} | الفرق ${r.delta > 0 ? '+' : ''}${r.delta} ${r.unit}`);}
  if (flagged.length) {
    L.push('\n=== أعلام — مراجعة يدوية (لن تُعدل آليًا) ===');
    for (const r of flagged) {L.push(`«${r.name}»: ${r.why} (بداية ${r.begin}، صرف ${r.dispatchOut}، حالي ${r.current})`);}
  }
  if (unmatched.length) {
    L.push('\n=== صفوف شيت بلا مقابل في القاعدة ===');
    for (const s of unmatched.slice(0, 20)) {L.push(`«${s.name}» (${s.qty} ${s.unit})`);}
    if (unmatched.length > 20) {L.push(`... و${unmatched.length - 20} أخرى`);}
  }
  if (dupKeys.length) {
    L.push('\n=== أسماء شيت تطابق أكثر من صنف ===');
    for (const d of dupKeys) {L.push(`«${d.name}»: ${d.items.join(' + ')}`);}
  }
  if (notInSheet.length) {
    L.push(`\n=== أصناف بالقاعدة غير موجودة بالشيت (${notInSheet.length}) — أول 15 ===`);
    for (const i of notInSheet.slice(0, 15)) {L.push(`#${i.id} «${i.name}» qty=${i.qty}`);}
  }

  require('fs').writeFileSync('tests/align-report.txt', L.join('\n'), 'utf8');
  console.log(`تم التقرير: tests/align-report.txt — جاهز للتعديل: ${toApply.length} | أصفار: ${zeroDelta.length} | أعلام: ${flagged.length} | بلا مقابل: ${unmatched.length} | مكررات: ${dupKeys.length} | غير موجودة بالشيت: ${notInSheet.length}${APPLY ? ' [وضع التطبيق]' : ''}`);

  // 5) التطبيق
  if (!APPLY) { console.log('(تشغيل تجريبي — أضف --apply)'); return; }
  const client = await pool.connect();
  let done = 0, failed = 0;
  try {
    for (const r of toApply) {
      await client.query('BEGIN');
      try {
        const reason = `مطابقة الرصيد الافتتاحي (شيت بداية 2027): بداية ${r.begin} − صرف أذونات ${r.dispatchOut} = رصيد المخزن الرئيسي ${r.target}`;
        await postInventoryLedgerEntry(client, {
          transactionType: 'count_correction', inventoryId: r.id, locationId: mainId,
          quantityDelta: r.delta, unit: r.unit || 'وحدة', unitCost: Number(r.dbCost) || r.price,
          referenceType: 'opening_sheet_2027_align', referenceId: String(r.id),
          idempotencyKey: `opening-sheet-2027-align:${r.id}`,
          reason, metadata: { sheet_begin: r.begin, dispatch_out: r.dispatchOut, target_main: r.target, main_before: r.current, auto_fix: true, fixed_at: new Date().toISOString() },
        });
        await client.query(
          `INSERT INTO "inventoryTx" (id,"itemId","itemName",qty,type,date,cost,"totalValue",notes)
           VALUES ($1,$2,$3,$4,'adjust',$5,$6,$7,$8)`,
          [Date.now() + Math.floor(Math.random() * 9999), r.id, r.name, Math.abs(r.delta),
            new Date().toISOString().slice(0, 10), Number(r.dbCost) || r.price,
            r3(Math.abs(r.delta) * (Number(r.dbCost) || r.price)),
            `مطابقة الافتتاحي: بداية ${r.begin} − صرف ${r.dispatchOut} = ${r.target} بالرئيسي${r.delta > 0 ? ' (إضافة)' : ' (خصم)'}`]);
        await client.query('COMMIT');
        done++;
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); failed++; console.log(`[فشل] «${r.name}»: ${e.message}`); }
    }
  } finally { client.release(); }
  console.log(`طُبّق: ${done} | فشل: ${failed}`);
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => pool.end());
