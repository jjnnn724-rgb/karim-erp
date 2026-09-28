const express = require('express');
const crypto = require('crypto');
const { pool } = require('./cashier-module/db-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { postInventoryLedgerEntry } = require('./inventory-ledger');
const { emitDomainEvent } = require('./realtime/producers');

const router = express.Router();
const READ = ['admin','manager','warehouse','kitchen','auditor','cashier'];
const WRITE = ['admin','manager','warehouse','kitchen'];
let schemaReady;
async function ensureSchema(){
  if(schemaReady) {return schemaReady;}
  schemaReady = (async()=>{
    await pool.query(`CREATE TABLE IF NOT EXISTS kitchen_policies (
      id BIGSERIAL PRIMARY KEY, department_id BIGINT NOT NULL UNIQUE, kitchen_location_id BIGINT NOT NULL,
      operation_mode VARCHAR(20) NOT NULL DEFAULT 'monitor' CHECK(operation_mode IN ('flexible','monitor','strict')),
      allow_fallback BOOLEAN NOT NULL DEFAULT TRUE, require_reason BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS kitchen_production_batches (
      id BIGSERIAL PRIMARY KEY, product_id BIGINT NOT NULL, location_id BIGINT NOT NULL,
      planned_qty NUMERIC(14,4) NOT NULL DEFAULT 0, produced_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
      remaining_qty NUMERIC(14,4) NOT NULL DEFAULT 0, consumed_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
      distributed_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK(status IN ('draft','open','closed','cancelled')),
      notes TEXT, created_by BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMPTZ
    );
    ALTER TABLE kitchen_production_batches ADD COLUMN IF NOT EXISTS distributed_qty NUMERIC(14,4) NOT NULL DEFAULT 0;
    ALTER TABLE kitchen_production_batches ALTER COLUMN product_id DROP NOT NULL;
    ALTER TABLE kitchen_production_batches ADD COLUMN IF NOT EXISTS product_name TEXT;
    ALTER TABLE kitchen_production_batches ADD COLUMN IF NOT EXISTS product_unit VARCHAR(40) DEFAULT 'وحدة';
    CREATE TABLE IF NOT EXISTS kitchen_production_distributions (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES kitchen_production_batches(id) ON DELETE CASCADE,
      destination_type VARCHAR(20) NOT NULL DEFAULT 'channel' CHECK(destination_type IN ('department','channel','custom')),
      destination_code VARCHAR(80) NOT NULL,
      destination_name VARCHAR(200) NOT NULL,
      department_id BIGINT,
      allocated_qty NUMERIC(14,4) NOT NULL CHECK(allocated_qty > 0),
      notes TEXT,
      created_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS kitchen_production_events (
      id BIGSERIAL PRIMARY KEY, batch_id BIGINT NOT NULL, event_type VARCHAR(30) NOT NULL,
      quantity NUMERIC(14,4) NOT NULL DEFAULT 0, reason TEXT, actor_user_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS kitchen_exceptions (
      id BIGSERIAL PRIMARY KEY, order_id VARCHAR(120), product_id BIGINT, department_id BIGINT,
      quantity NUMERIC(14,4) NOT NULL DEFAULT 0, operation_mode VARCHAR(20) NOT NULL,
      reason TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'open', created_by BIGINT,
      reviewed_by BIGINT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS kitchen_audits (
      id BIGSERIAL PRIMARY KEY, audit_number VARCHAR(80) NOT NULL UNIQUE,
      period VARCHAR(20) NOT NULL DEFAULT 'weekly' CHECK(period IN ('weekly','monthly')),
      location_id BIGINT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected')),
      counted_at TIMESTAMPTZ, submitted_at TIMESTAMPTZ, approved_at TIMESTAMPTZ,
      created_by BIGINT, approved_by BIGINT, notes TEXT, total_items INTEGER NOT NULL DEFAULT 0,
      total_variance_value NUMERIC(14,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS kitchen_audit_items (
      id BIGSERIAL PRIMARY KEY, audit_id BIGINT NOT NULL REFERENCES kitchen_audits(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL, system_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
      counted_qty NUMERIC(14,4) NOT NULL DEFAULT 0, variance_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
      notes TEXT, UNIQUE(audit_id, inventory_id)
    );
    ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS period_start DATE;
    ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS period_end DATE;
    ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS counted_by BIGINT;
    ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS count_signature_data TEXT;
    ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS count_signature_hash VARCHAR(128);
    ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS submitted_by BIGINT;
    ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS submit_signature_data TEXT;
    ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS submit_signature_hash VARCHAR(128);
    ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS approved_signature_data TEXT;
    ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS approved_signature_hash VARCHAR(128);
    ALTER TABLE kitchen_audits DROP CONSTRAINT IF EXISTS kitchen_audits_period_check;
    ALTER TABLE kitchen_audits ADD CONSTRAINT kitchen_audits_period_check CHECK(period IN ('daily','weekly','monthly','custom','annual'));
    CREATE TABLE IF NOT EXISTS kitchen_audit_workflow_events (
      id BIGSERIAL PRIMARY KEY,
      audit_id BIGINT NOT NULL REFERENCES kitchen_audits(id) ON DELETE CASCADE,
      event_type VARCHAR(40) NOT NULL,
      from_status VARCHAR(30),
      to_status VARCHAR(30) NOT NULL,
      actor_user_id BIGINT,
      actor_role VARCHAR(50),
      signature_hash VARCHAR(128),
      event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      previous_event_hash VARCHAR(128),
      event_hash VARCHAR(128) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_kitchen_audit_events_audit ON kitchen_audit_workflow_events(audit_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_kitchen_batches_available ON kitchen_production_batches(product_id,location_id,status,remaining_qty);
    CREATE INDEX IF NOT EXISTS idx_kitchen_production_distributions_batch ON kitchen_production_distributions(batch_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kitchen_production_distributions_destination ON kitchen_production_distributions(destination_code,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kitchen_exceptions_open ON kitchen_exceptions(status,created_at DESC);
    INSERT INTO inventory_locations (code,name_ar,location_type,active,negative_stock_policy,costing_policy,count_frequency_days)
      VALUES ('MAIN-WAREHOUSE','المخزن الرئيسي','warehouse',TRUE,'deny','weighted_average',7)
      ON CONFLICT (code) DO UPDATE SET active=TRUE,location_type='warehouse',updated_at=CURRENT_TIMESTAMP;
    INSERT INTO inventory_locations (code,name_ar,location_type,active,negative_stock_policy,costing_policy,count_frequency_days)
      VALUES ('KITCHEN-MAIN','مخزن المطبخ','kitchen',TRUE,'deny','weighted_average',7)
      ON CONFLICT (code) DO UPDATE SET active=TRUE,location_type='kitchen',updated_at=CURRENT_TIMESTAMP;
    INSERT INTO inventory_location_balances (inventory_id,location_id,on_hand,reserved,in_transit,quarantined,expired)
      SELECT i.id,l.id,COALESCE(i.qty,0),0,0,0,0 FROM inventory i CROSS JOIN inventory_locations l
      WHERE l.code='MAIN-WAREHOUSE'
        AND NOT EXISTS (SELECT 1 FROM inventory_location_balances b WHERE b.inventory_id=i.id AND b.location_id=l.id)
        AND NOT EXISTS (SELECT 1 FROM inventory_ledger il WHERE il.inventory_id=i.id);
    INSERT INTO inventory_location_balances (inventory_id,location_id,on_hand,reserved,in_transit,quarantined,expired)
      SELECT i.id,l.id,0,0,0,0,0 FROM inventory i CROSS JOIN inventory_locations l
      WHERE l.code='KITCHEN-MAIN' AND NOT EXISTS (
        SELECT 1 FROM inventory_location_balances b WHERE b.inventory_id=i.id AND b.location_id=l.id
      );`);
  })();
  // A transient DB failure must not poison the cached promise forever;
  // reset so the next request retries the schema setup.
  schemaReady = schemaReady.catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:NaN;}
function signatureHash(value){return value?crypto.createHash('sha256').update(value).digest('hex'):null;}
function normalizeSignature(value){const signature=String(value||'').trim();return signature&&signature.length<=250000&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(signature)?signature:null;}
function normalizeSignerNameK(value){return String(value||'').trim().replace(/\s+/g,' ');}
function signerMatchesAccountK(provided,user){const p=normalizeSignerNameK(provided).toLowerCase();if(!p){return false;}return [user?.name,user?.username].map(v=>normalizeSignerNameK(v).toLowerCase()).filter(Boolean).includes(p);}
function requireSignature(req,res){const signature=normalizeSignature(req.body?.signatureData);if(!signature){fail(res,422,'SIGNATURE_REQUIRED','التوقيع الإلكتروني مطلوب لإرسال أو اعتماد جرد المطبخ');return null;}const signerName=req.body?.signerName??req.body?.signatureName??req.body?.signer;if(!normalizeSignerNameK(signerName)){fail(res,422,'SIGNER_NAME_REQUIRED','اسم الموقّع مطلوب ويجب أن يطابق اسم صاحب الحساب المسجل دخوله');return null;}if(!signerMatchesAccountK(signerName,req.user)){fail(res,403,'SIGNER_MISMATCH',`التوقيع باسم صاحب الحساب فقط — لا يجوز توقيع اسم آخر (الحساب: ${normalizeSignerNameK(req.user?.name||req.user?.username||'')||'غير معروف'})`);return null;}return signature;}
async function appendKitchenAuditEvent(client,auditId,eventType,fromStatus,toStatus,req,signature,payload={}){const previous=(await client.query('SELECT event_hash FROM kitchen_audit_workflow_events WHERE audit_id=$1 ORDER BY id DESC LIMIT 1',[auditId])).rows[0]?.event_hash||null;const canonical={auditId,eventType,fromStatus:fromStatus||null,toStatus,actorUserId:req.user?.id||null,actorRole:req.user?.role||'unknown',signatureHash:signatureHash(signature),payload,previous};const eventHash=crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');return (await client.query(`INSERT INTO kitchen_audit_workflow_events(audit_id,event_type,from_status,to_status,actor_user_id,actor_role,signature_hash,event_payload,previous_event_hash,event_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[auditId,eventType,fromStatus||null,toStatus,req.user?.id||null,req.user?.role||'unknown',signatureHash(signature),JSON.stringify(payload),previous,eventHash])).rows[0];}
function fail(res,status,error,message,extra={}){return res.status(status).json({error,message,...extra});}
async function getKitchenLocation(client, requested){
  if(Number.isInteger(Number(requested))){
    // Guard against consuming from the wrong location (e.g. the main warehouse)
    const requestedLocation = await client.query('SELECT id FROM inventory_locations WHERE id=$1 AND active=true LIMIT 1', [Number(requested)]);
    if (requestedLocation.rows.length) {return Number(requested);}
    throw Object.assign(new Error('KITCHEN_LOCATION_NOT_FOUND'),{code:'KITCHEN_LOCATION_NOT_FOUND'});
  }
  const r=await client.query(`SELECT id FROM inventory_locations WHERE code='KITCHEN-MAIN' AND active=true LIMIT 1`);
  if(!r.rows.length) {throw Object.assign(new Error('KITCHEN_LOCATION_NOT_CONFIGURED'),{code:'KITCHEN_LOCATION_NOT_CONFIGURED'});}
  return Number(r.rows[0].id);
}
router.get('/overview',jwtAuth,requireRole(...READ),async(req,res)=>{try{await ensureSchema();const [loc,batches,exceptions,policies,distributions]=await Promise.all([
  pool.query(`SELECT id,code,name_ar,location_type,negative_stock_policy FROM inventory_locations WHERE active=true ORDER BY id`),
  pool.query(`SELECT b.*,COALESCE(NULLIF(b.product_name,''),p.name_ar,'منتج غير محدد') AS product_name,COALESCE(b.product_unit,'وحدة') AS product_unit,l.name_ar AS location_name FROM kitchen_production_batches b LEFT JOIN pos_products p ON p.id=b.product_id LEFT JOIN inventory_locations l ON l.id=b.location_id WHERE b.status IN ('draft','open','closed') ORDER BY b.created_at DESC LIMIT 100`),
  pool.query(`SELECT e.*,p.name_ar AS product_name,d.name AS department_name FROM kitchen_exceptions e LEFT JOIN pos_products p ON p.id=e.product_id LEFT JOIN departments d ON d.id=e.department_id WHERE e.status='open' ORDER BY e.created_at DESC LIMIT 100`),
  pool.query(`SELECT kp.*,d.name AS department_name,l.name_ar AS kitchen_location_name FROM kitchen_policies kp LEFT JOIN departments d ON d.id=kp.department_id LEFT JOIN inventory_locations l ON l.id=kp.kitchen_location_id ORDER BY kp.department_id`),
  pool.query(`SELECT pd.*,b.product_id,COALESCE(NULLIF(b.product_name,''),p.name_ar,'منتج غير محدد') AS product_name,COALESCE(b.product_unit,'وحدة') AS product_unit FROM kitchen_production_distributions pd JOIN kitchen_production_batches b ON b.id=pd.batch_id LEFT JOIN pos_products p ON p.id=b.product_id ORDER BY pd.created_at DESC LIMIT 300`)
]);res.json({locations:loc.rows,batches:batches.rows,exceptions:exceptions.rows,policies:policies.rows,distributions:distributions.rows});}catch(e){res.status(500).json({error:'KITCHEN_OVERVIEW_FAILED',message:e.message});}});
router.post('/policies',jwtAuth,requireRole(...WRITE),async(req,res)=>{try{await ensureSchema();const departmentId=Number(req.body?.department_id), locationId=Number(req.body?.kitchen_location_id), mode=String(req.body?.operation_mode||'monitor');// Number(null)=0 — بدون الحارس >0 ينشئ سياسة شبح على قسم غير موجود
if(!Number.isInteger(departmentId)||departmentId<=0||!Number.isInteger(locationId)||locationId<=0||!['flexible','monitor','strict'].includes(mode)){return fail(res,422,'INVALID_POLICY','بيانات سياسة المطبخ غير صحيحة');}const deptExists=(await pool.query('SELECT 1 FROM pos_departments WHERE id=$1 LIMIT 1',[departmentId])).rows.length;if(!deptExists){return fail(res,422,'DEPARTMENT_NOT_FOUND','قسم الكاشير المحدد غير موجود — افتح شاشة الكاشير أولًا لمزامنة الأقسام');}const r=await pool.query(`INSERT INTO kitchen_policies(department_id,kitchen_location_id,operation_mode,allow_fallback,require_reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(department_id) DO UPDATE SET kitchen_location_id=EXCLUDED.kitchen_location_id,operation_mode=EXCLUDED.operation_mode,allow_fallback=EXCLUDED.allow_fallback,require_reason=EXCLUDED.require_reason,updated_at=CURRENT_TIMESTAMP RETURNING *`,[departmentId,locationId,mode,req.body.allow_fallback!==false,Boolean(req.body.require_reason)]);res.json(r.rows[0]);}catch(e){res.status(500).json({error:'POLICY_SAVE_FAILED',message:e.message});}});
router.get('/stock',jwtAuth,requireRole(...READ),async(req,res)=>{try{await ensureSchema();const locations=(await pool.query(`SELECT id,code,name_ar FROM inventory_locations WHERE code IN ('MAIN-WAREHOUSE','KITCHEN-MAIN') AND active=true`)).rows;const source=locations.find(x=>x.code==='MAIN-WAREHOUSE')||null;const destination=locations.find(x=>x.code==='KITCHEN-MAIN')||null;if(!source||!destination){return fail(res,422,'KITCHEN_LOCATIONS_NOT_CONFIGURED','المخزن الرئيسي أو مخزن المطبخ غير مهيأ');}const items=(await pool.query(`SELECT b.inventory_id,i.name,i.unit,COALESCE(b.on_hand,0) on_hand,COALESCE(b.reserved,0) reserved,GREATEST(0,COALESCE(b.on_hand,0)-COALESCE(b.reserved,0)) available,COALESCE(i."avgCost",0) avg_cost FROM inventory_location_balances b JOIN inventory i ON i.id=b.inventory_id WHERE b.location_id=$1 AND GREATEST(0,COALESCE(b.on_hand,0)-COALESCE(b.reserved,0))>0 ORDER BY i.name`,[source.id])).rows;res.json({source,destination,items});}catch(e){res.status(500).json({error:'KITCHEN_STOCK_FAILED',message:e.message});}});
router.post('/transfers/receive',jwtAuth,requireRole(...WRITE),async(req,res)=>{const client=await pool.connect();try{await ensureSchema();await client.query('BEGIN');const destination=await getKitchenLocation(client,req.body?.destination_location_id);let source=Number(req.body?.source_location_id);if(!Number.isInteger(source)){const main=(await client.query(`SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active=true LIMIT 1`)).rows[0];source=Number(main?.id||0);}if(!source){throw Object.assign(new Error('المخزن الرئيسي غير مهيأ'),{code:'MAIN_WAREHOUSE_NOT_CONFIGURED'});}const items=Array.isArray(req.body?.items)?req.body.items:[];if(!items.length){await client.query('ROLLBACK');return fail(res,422,'ITEMS_REQUIRED','أضف أصنافًا للتحويل');}const refKey=String(req.body.reference||('manual-'+Date.now()));const results=[];
// بلا مرجع صريح: المفتاح التلقائي يختلف كل مرة — نحمي النقرة المزدوجة بفحص 60 ثانية
if(!req.body.reference){const recent=(await client.query(`SELECT DISTINCT inventory_id FROM inventory_ledger WHERE reference_type='kitchen_transfer' AND transaction_type='transfer_out' AND user_id=$1 AND created_at > NOW() - INTERVAL '60 seconds'`,[req.user.id])).rows.map(r=>Number(r.inventory_id)).sort((a,b)=>a-b);const cur=[...new Set(items.map(x=>Number(x.inventory_id)).filter(Number.isInteger))].sort((a,b)=>a-b);if(cur.length&&recent.length&&cur.every(id=>recent.includes(id))){throw Object.assign(new Error('تحويل مطابق أُرسل قبل أقل من دقيقة — تجاهل مزدوج محتمل'),{code:'TRANSFER_ALREADY_POSTED'});}}for(const raw of items){const inventoryId=Number(raw.inventory_id),qty=num(raw.qty??raw.quantity);if(!Number.isInteger(inventoryId)||!Number.isFinite(qty)||qty<=0){throw Object.assign(new Error('بيانات التحويل غير صحيحة'),{code:'INVALID_TRANSFER_ITEM'});}const pkgRaw=raw.packaging_qty??raw.packagingQty??null;const pkg=pkgRaw===null||pkgRaw===undefined||pkgRaw==='' ?null:num(pkgRaw);if(pkg!==null&&(!Number.isFinite(pkg)||pkg<0)){throw Object.assign(new Error('عدد الكراتين غير صحيح'),{code:'INVALID_PACKAGING_QTY'});}const pkgUom=pkg!==null?(String(raw.packaging_uom||raw.packagingUom||'كرتون')):null;const out=await postInventoryLedgerEntry(client,{transactionType:'transfer_out',inventoryId,locationId:source,quantityDelta:-qty,sourceLocationId:source,destinationLocationId:destination,referenceType:'kitchen_transfer',referenceId:refKey,userId:req.user.id,idempotencyKey:`kitchen-out:${refKey}:${inventoryId}`,reason:'تحويل مواد من المخزن الرئيسي إلى المطبخ',metadata:{reference:refKey},catchWeightQty:pkg,catchWeightUnit:pkgUom});if(out.replay){throw Object.assign(new Error('التحويل مسجل مسبقًا — حدّث الصفحة'),{code:'TRANSFER_ALREADY_POSTED'});}const inn=await postInventoryLedgerEntry(client,{transactionType:'transfer_in',inventoryId,locationId:destination,quantityDelta:qty,sourceLocationId:source,destinationLocationId:destination,referenceType:'kitchen_transfer',referenceId:refKey,userId:req.user.id,idempotencyKey:`kitchen-in:${refKey}:${inventoryId}`,reason:'استلام مواد في مخزن المطبخ',metadata:{reference:refKey},catchWeightQty:pkg,catchWeightUnit:pkgUom});results.push({inventory_id:inventoryId,quantity:qty,packaging_qty:pkg,source_balance:out.balanceAfter,destination_balance:inn.balanceAfter});}await client.query('COMMIT');res.json({status:'received',destination_location_id:destination,items:results});}catch(e){await client.query('ROLLBACK').catch(()=>{});res.status((e.code==='INSUFFICIENT_STOCK'||e.code==='TRANSFER_ALREADY_POSTED')?409:422).json({error:e.code||'KITCHEN_TRANSFER_FAILED',message:e.message});}finally{client.release();}});
router.get('/production-materials',jwtAuth,requireRole(...READ),async(req,res)=>{try{await ensureSchema();const r=await pool.query(`SELECT b.inventory_id,i.name,i.unit,i.weight,COALESCE(b.on_hand,0) AS on_hand,COALESCE(b.reserved,0) AS reserved,GREATEST(0,COALESCE(b.on_hand,0)-COALESCE(b.reserved,0)) AS available,COALESCE(i."avgCost",0) AS avg_cost FROM inventory_location_balances b JOIN inventory i ON i.id=b.inventory_id JOIN inventory_locations l ON l.id=b.location_id WHERE l.code='KITCHEN-MAIN' AND l.active=true AND GREATEST(0,COALESCE(b.on_hand,0)-COALESCE(b.reserved,0))>0 ORDER BY i.name`);res.json(r.rows);}catch(e){res.status(500).json({error:'PRODUCTION_MATERIALS_FAILED',message:e.message});}});
router.get('/production-destinations',jwtAuth,requireRole(...READ),async(req,res)=>{try{await ensureSchema();const r=await pool.query(`SELECT id,code,name,icon,color FROM departments WHERE LOWER(COALESCE(code,'')) NOT IN ('kitchen','مطبخ') AND LOWER(COALESCE(name,'')) NOT LIKE '%مطبخ%' AND LOWER(COALESCE(name,'')) NOT LIKE '%kitchen%' ORDER BY id`);res.json(r.rows);}catch(e){res.status(500).json({error:'PRODUCTION_DESTINATIONS_FAILED',message:e.message});}});

// ═══════════════════════════════════════════════════════════════════════════
// بطاقات تكلفة أمر الإنتاج — البيع الخارجي + البوفيه المفتوح
// الاستهلاك الفعلي: أصناف أذون الصرف المسجلة في دفتر الحركات (سعر متوسط التكلفة
// وقت الاعتماد، يتحدث تلقائيًا مع كل إذن جديد) − المرتجعات + مكونات أوامر الإنتاج
// الموزعة على الجهة (تكلفة الدفتر × نسبة التوزيع).
// الإيراد الفعلي: إيرادات الكاشير المرتبطة بالقسم (ياراسوفت/POS) من جدول الإيرادات.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/production/cost-cards',jwtAuth,requireRole(...READ),async(req,res)=>{
  try{
    await ensureSchema();
    const from=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||''))?String(req.query.from):new Date().toISOString().slice(0,8)+'01';
    const to=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||''))?String(req.query.to):new Date().toISOString().slice(0,10);
    if(from>to){return res.status(422).json({error:'INVALID_RANGE',message:'تاريخ النهاية يسبق البداية'});}
    // قسم البوفيه المفتوح كفرع للمطبخ (ضمان البيانات — آمن على التكرار)
    await pool.query(`INSERT INTO departments (id, code, name, icon, color, parent_code)
      SELECT 7201,'open_buffet','البوفيه المفتوح','🍽','#8B5CF6','kitchen'
      WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code='open_buffet')`);
    // نطاق الأقسام الفرعية (الأب + الفروع) من الشجرة الحية
    async function scopeOf(code){
      const rows=(await pool.query(
        `WITH RECURSIVE tree AS (
           SELECT code FROM departments WHERE code=$1
           UNION ALL
           SELECT d.code FROM departments d JOIN tree t ON d.parent_code=t.code
         ) SELECT code FROM tree`,[code])).rows.map(r=>r.code);
      return rows.length?rows:[code];
    }
    const externalScope=await scopeOf('external_sales');
    const kitchenScope=await scopeOf('kitchen');
    const cards=[];
    for(const card of [
      {code:'external_sales',name:'البيع الخارجي',icon:'🚚',color:'#2196F3',scope:externalScope,prodCodes:['external_sales']},
      {code:'open_buffet',name:'البوفيه المفتوح',icon:'🍽',color:'#8B5CF6',scope:kitchenScope,prodCodes:['open_buffet']},
    ]){
      const scope=card.scope;
      // 1) الاستهلاك المفصل من أذون الصرف (حركات الخروج المرتبطة بإذن)
      const consumedItems=(await pool.query(
        `SELECT tx."itemName" AS name, tx.qty, COALESCE(tx.catch_weight_unit, i.unit, 'وحدة') AS unit, tx.cost, tx."totalValue" AS value, tx.date, tx."dispatchId" AS dispatch_no
         FROM "inventoryTx" tx JOIN dispatches d ON d.id::text = tx."dispatchId" LEFT JOIN inventory i ON i.id = tx."itemId"
         WHERE tx.type='out' AND d."deptCode" = ANY($1::varchar[]) AND tx.date >= $2 AND tx.date <= $3
         ORDER BY tx.date DESC, tx.id DESC LIMIT 400`,
        [scope,from,to])).rows;
      const consumedGross=Number(consumedItems.reduce((s,x)=>s+Number(x.value||0),0).toFixed(2));
      // 2) المرتجعات من القسم (تُخصم من الاستهلاك)
      const returned=(await pool.query(
        `SELECT COALESCE(SUM("totalValue"),0)::numeric(14,2) AS t FROM "kitchenReturns"
         WHERE "deptCode" = ANY($1::varchar[]) AND date >= $2 AND date <= $3`,[scope,from,to])).rows[0]?.t||0;
      const consumedNet=Number((consumedGross-Number(returned)).toFixed(2));
      // 3) مكونات أوامر الإنتاج الموزعة على هذه الجهة (تكلفة الدفتر × نسبة التوزيع)
      const prodRows=(await pool.query(
        `SELECT pbd.batch_id, pbd.allocated_qty, kb.planned_qty, kb.product_name, kb.created_at::date AS prod_date,
                COALESCE((SELECT SUM(l.total_cost) FROM inventory_ledger l
                  WHERE l.reference_type='kitchen_production' AND l.reference_id=pbd.batch_id::text),0)::numeric(16,4) AS batch_cost
         FROM kitchen_production_distributions pbd
         JOIN kitchen_production_batches kb ON kb.id=pbd.batch_id
         WHERE pbd.destination_code = ANY($1::varchar[]) AND kb.created_at::date >= $2 AND kb.created_at::date <= $3`,
        [card.prodCodes,from,to])).rows;
      const productionLines=prodRows.map(r=>{
        const planned=Number(r.planned_qty)||0;
        const ratio=planned>0?Math.min(1,Number(r.allocated_qty)/planned):1;
        const cost=Number((Number(r.batch_cost)*ratio).toFixed(2));
        return {batch_id:r.batch_id,product_name:r.product_name,allocated_qty:Number(r.allocated_qty),planned_qty:planned,batch_cost:Number(r.batch_cost),cost,prod_date:r.prod_date};
      });
      const productionCost=Number(productionLines.reduce((s,x)=>s+x.cost,0).toFixed(2));
      // 4) الإيراد الفعلي من الكاشيرات (ياراسوفت + POS) لقسم/أقسام النطاق
      const revenue=Number((await pool.query(
        `SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS t FROM revenues
         WHERE "deptId" = ANY($1::varchar[]) AND date >= $2 AND date <= $3`,[scope,from,to])).rows[0]?.t||0);
      const totalCost=Number((consumedNet+productionCost).toFixed(2));
      cards.push({code:card.code,name:card.name,icon:card.icon,color:card.color,
        from,to,scopeCodes:scope,
        consumption:{gross:consumedNet,returned:Number(returned),dispatchItemsCount:consumedItems.length,items:consumedItems},
        production:{cost:productionCost,lines:productionLines},
        revenue,totalCost:totalCost,
        net:Number((revenue-totalCost).toFixed(2)),
        costRatio:revenue>0?Number((totalCost/revenue*100).toFixed(1)):null});
    }
    res.json({ok:true,from,to,cards});
  }catch(e){
    console.error('[production_cost_cards]',e);
    res.status(500).json({error:'COST_CARDS_FAILED',message:e.message});
  }
});

router.post('/production',jwtAuth,requireRole(...WRITE),async(req,res)=>{
  const client=await pool.connect();
  try{
    await ensureSchema();
    const rawProductId=Number(req.body?.product_id), productId=Number.isInteger(rawProductId)&&rawProductId>0?rawProductId:null;
    const productName=String(req.body?.product_name||'').trim();
    const productUnit=String(req.body?.product_unit||'وحدة').trim()||'وحدة';
    const qty=num(req.body?.produced_qty);
    if(!productId&&!productName||!Number.isFinite(qty)||qty<=0) {return fail(res,422,'INVALID_PRODUCTION','اكتب اسم المنتج النهائي والكمية المنتجة');}
    if(productId&&!productName){const product=(await client.query('SELECT name_ar FROM pos_products WHERE id=$1 LIMIT 1',[productId])).rows[0];if(product) {req.body.product_name=product.name_ar;}}
    const locationId=await getKitchenLocation(client,req.body?.location_id);
    const rawDistributions=Array.isArray(req.body?.distributions)?req.body.distributions:[];
    if(!rawDistributions.length) {return fail(res,422,'DESTINATIONS_REQUIRED','وزّع الإنتاج على جهة واحدة على الأقل');}
    const distributions=[];
    for(const raw of rawDistributions){
      const destinationType=String(raw.destination_type||'channel').trim();
      let destinationCode=String(raw.destination_code||'').trim();
      const requestedQty=num(raw.quantity??raw.allocated_qty);
      if(!['department','channel','custom'].includes(destinationType)||!destinationCode||!Number.isFinite(requestedQty)||requestedQty<=0) {return fail(res,422,'INVALID_DESTINATION','بيانات جهة التوزيع غير صحيحة');}
      let departmentId=null, destinationName=String(raw.destination_name||'').trim();
      if(destinationType==='department'){
        departmentId=Number(raw.department_id);
        if(!Number.isInteger(departmentId)) {return fail(res,422,'DEPARTMENT_REQUIRED','اختر قسمًا صحيحًا لجهة التوزيع');}
        const department=(await client.query('SELECT id,name,code FROM departments WHERE id=$1 LIMIT 1',[departmentId])).rows[0];
        if(!department) {return fail(res,422,'DEPARTMENT_NOT_FOUND','القسم المحدد غير موجود');}
        destinationName=department.name;
        destinationCode=String(department.code||departmentId);
      }else if(!destinationName){
        destinationName={external_sales:'البيع الخارجي',open_buffet:'البوفيه المفتوح',staff_meals:'وجبات الموظفين'}[destinationCode]||destinationCode;
      }
      distributions.push({destinationType,destinationCode,destinationName,departmentId,quantity:Number(requestedQty.toFixed(4)),notes:String(raw.notes||'').trim()||null});
    }
    const allocatedTotal=Number(distributions.reduce((sum,item)=>sum+item.quantity,0).toFixed(4));
    if(Math.abs(allocatedTotal-Number(qty.toFixed(4)))>0.0001) {return fail(res,422,'DISTRIBUTION_TOTAL_MISMATCH',`إجمالي التوزيع ${allocatedTotal} لا يساوي الإنتاج ${Number(qty.toFixed(4))}`);}
    const rawMaterials=Array.isArray(req.body?.materials)?req.body.materials:[];
    if(!rawMaterials.length) {return fail(res,422,'MATERIALS_REQUIRED','أضف مكونات أمر الإنتاج يدويًا');}
    const materialIds=[...new Set(rawMaterials.map(x=>Number(x.inventory_id)).filter(Number.isInteger))];
    if(materialIds.length!==rawMaterials.length) {return fail(res,422,'INVALID_MATERIAL','اختر أصناف مكونات صحيحة');}
    const stockRows=(await client.query(`SELECT b.inventory_id,i.name,i.unit AS inventory_unit,i.weight,COALESCE(b.on_hand,0) AS on_hand,COALESCE(b.reserved,0) AS reserved FROM inventory_location_balances b JOIN inventory i ON i.id=b.inventory_id JOIN inventory_locations l ON l.id=b.location_id WHERE l.code='KITCHEN-MAIN' AND b.inventory_id=ANY($1::bigint[])`,[materialIds])).rows;
    const stockById=new Map(stockRows.map(x=>[String(x.inventory_id),x]));
    const materials=[];
    for(const raw of rawMaterials){
      const stock=stockById.get(String(Number(raw.inventory_id))), requested=num(raw.quantity??raw.qty), waste=Math.max(0,num(raw.waste_percent||0));
      if(!stock) {return fail(res,422,'MATERIAL_NOT_IN_KITCHEN','المكون غير موجود في رصيد مخزن المطبخ');}
      if(!Number.isFinite(requested)||requested<=0||!Number.isFinite(waste)||waste>100) {return fail(res,422,'INVALID_MATERIAL_QUANTITY','تحقق من كمية المكون ونسبة الهالك');}
      const totalRequired=Number((requested*(1+waste/100)).toFixed(4)), available=Number(stock.on_hand||0)-Number(stock.reserved||0);
      if(totalRequired>available+0.0001) {return fail(res,409,'INSUFFICIENT_STOCK',`الرصيد غير كافٍ للمكون: ${stock.name}`);}
      materials.push({inventoryId:Number(stock.inventory_id),name:stock.name,unit:stock.inventory_unit,quantity:requested,wastePercent:waste,totalRequired});
    }
    await client.query('BEGIN');
    const finalProductName=String(productName||req.body.product_name||'').trim();
    const batch=(await client.query(`INSERT INTO kitchen_production_batches(product_id,product_name,product_unit,location_id,planned_qty,produced_qty,remaining_qty,distributed_qty,status,created_by,notes) VALUES($1,$2,$3,$4,$5,$5,0,$5,'closed',$6,$7) RETURNING *`,[productId,finalProductName,productUnit,locationId,qty,req.user.id,req.body.notes||null])).rows[0];
    const consumedMaterials=[];
    for(const item of materials){
      await postInventoryLedgerEntry(client,{transactionType:'production_consumption',inventoryId:item.inventoryId,locationId,quantityDelta:-item.totalRequired,unit:item.unit,referenceType:'kitchen_production',referenceId:String(batch.id),userId:req.user.id,idempotencyKey:`production:${batch.id}:${item.inventoryId}`,reason:'استهلاك مكون يدوي في أمر إنتاج المطبخ',metadata:{product_id:productId,product_name:finalProductName,batch_id:batch.id,distribution:distributions,manual_material:true,waste_percent:item.wastePercent}});
      consumedMaterials.push({inventory_id:item.inventoryId,name:item.name,requested_quantity:item.quantity,waste_percent:item.wastePercent,consumed_quantity:item.totalRequired,unit:item.unit});
    }
    await client.query(`INSERT INTO kitchen_production_events(batch_id,event_type,quantity,reason,actor_user_id) VALUES($1,'produced',$2,$3,$4)`,[batch.id,qty,req.body.notes||'إنتاج موزع على جهات التشغيل',req.user.id]);
    for(const item of distributions){
      await client.query(`INSERT INTO kitchen_production_distributions(batch_id,destination_type,destination_code,destination_name,department_id,allocated_qty,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[batch.id,item.destinationType,item.destinationCode,item.destinationName,item.departmentId,item.quantity,item.notes,req.user.id]);
      await client.query(`INSERT INTO kitchen_production_events(batch_id,event_type,quantity,reason,actor_user_id) VALUES($1,'distributed',$2,$3,$4)`,[batch.id,item.quantity,`توزيع إلى ${item.destinationName}`,req.user.id]);
    }
    // TASK 9: حدث دومين داخل نفس المعاملة (fail-open) — القناة الموثوقة بجانب البث الحي
    await emitDomainEvent(pool, client, 'KITCHEN', {
      eventType: 'KITCHEN_ORDER_COMPLETED', aggregateType: 'kitchen_batch', aggregateId: batch.id,
      payload: { batch_id: batch.id, product_name: finalProductName, qty,
        destinations: distributions.map(d => ({ name: d.destinationName, qty: d.quantity })) },
    });
    await client.query('COMMIT');
    const savedDistributions=(await pool.query('SELECT * FROM kitchen_production_distributions WHERE batch_id=$1 ORDER BY id',[batch.id])).rows;
    res.json({batch,distributions:savedDistributions,consumed_materials:consumedMaterials});
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    const message=e.code==='INSUFFICIENT_STOCK'?'الرصيد غير كافٍ في مخزن المطبخ؛ استلم المواد من إذن الصرف ووقّع الاستلام أولًا':e.code==='UNIT_INCOMPATIBLE'||e.code==='UNIT_DENSITY_REQUIRED'?'وحدات مكونات الوصفة لا تتوافق مع وحدة المخزون؛ راجع وحدة المكون أو أضف وزن التحويل':e.message;
    res.status(e.code==='INSUFFICIENT_STOCK'?409:422).json({error:e.code||'PRODUCTION_FAILED',message});
  }finally{client.release();}
});

router.post('/production-legacy',jwtAuth,requireRole(...WRITE),async(req,res)=>{const client=await pool.connect();try{await ensureSchema();await client.query('BEGIN');const productId=Number(req.body?.product_id),qty=num(req.body?.produced_qty),locationId=await getKitchenLocation(client,req.body?.location_id);if(!Number.isInteger(productId)||!Number.isFinite(qty)||qty<=0){await client.query('ROLLBACK');return fail(res,422,'INVALID_PRODUCTION','حدد المنتج والكمية المنتجة');}const bom=(await client.query(`SELECT pi.inventory_id,pi.quantity_per_unit,pi.unit,pi.waste_percent,i.name,i.unit AS inventory_unit,i.weight,i."avgCost" FROM pos_product_ingredients pi JOIN inventory i ON i.id=pi.inventory_id WHERE pi.product_id=$1`,[productId])).rows;if(!bom.length){return fail(res,422,'RECIPE_NOT_CONFIGURED','المنتج لا يحتوي على وصفة مكونات');}const batch=(await client.query(`INSERT INTO kitchen_production_batches(product_id,location_id,planned_qty,produced_qty,remaining_qty,created_by,notes) VALUES($1,$2,$3,$3,$3,$4,$5) RETURNING *`,[productId,locationId,qty,req.user.id,req.body.notes||null])).rows[0];for(const item of bom){const factor=Number(item.quantity_per_unit)*(1+Number(item.waste_percent||0)/100);const required=Number((qty*factor).toFixed(4));const {convertQuantity}=require('./unit-conversion');const stockQty=convertQuantity(required,item.unit,item.inventory_unit,{inventoryWeight:Number(item.weight||0)});await postInventoryLedgerEntry(client,{transactionType:'production_consumption',inventoryId:Number(item.inventory_id),locationId,quantityDelta:-Number(stockQty),unit:item.inventory_unit,referenceType:'kitchen_production',referenceId:String(batch.id),userId:req.user.id,idempotencyKey:`production:${batch.id}:${item.inventory_id}`,reason:'استهلاك مواد خام في أمر إنتاج المطبخ',metadata:{product_id:productId,batch_id:batch.id}});}await client.query(`INSERT INTO kitchen_production_events(batch_id,event_type,quantity,actor_user_id) VALUES($1,'produced',$2,$3)`,[batch.id,qty,req.user.id]);await client.query('COMMIT');res.json({batch,consumed_materials:bom});}catch(e){await client.query('ROLLBACK').catch(()=>{});const message=e.code==='INSUFFICIENT_STOCK'?'الرصيد غير كافٍ في مخزن المطبخ؛ استخدم «استلام مواد» من المخزن الرئيسي أولًا':e.code==='UNIT_INCOMPATIBLE'||e.code==='UNIT_DENSITY_REQUIRED'?'وحدات مكونات الوصفة لا تتوافق مع وحدة المخزون؛ راجع وحدة المكون أو أضف وزن التحويل':e.message;res.status(e.code==='INSUFFICIENT_STOCK'?409:422).json({error:e.code||'PRODUCTION_FAILED',message});}finally{client.release();}});
router.post('/exceptions/:id/review',jwtAuth,requireRole('admin','manager','auditor'),async(req,res)=>{try{await ensureSchema();const status=String(req.body?.status||'reviewed');const r=await pool.query(`UPDATE kitchen_exceptions SET status=$2,reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,[req.params.id,status,req.user.id]);if(!r.rows.length){return fail(res,404,'EXCEPTION_NOT_FOUND','الاستثناء غير موجود');}res.json(r.rows[0]);}catch(e){res.status(500).json({error:'EXCEPTION_REVIEW_FAILED',message:e.message});}});
router.get('/documents',jwtAuth,requireRole(...READ),async(req,res)=>{try{await ensureSchema();const kitchen=(await pool.query(`SELECT id FROM inventory_locations WHERE code='KITCHEN-MAIN' LIMIT 1`)).rows[0]?.id||0;const r=await pool.query(`SELECT t.*,sl.name_ar AS source_name,dl.name_ar AS destination_name,COALESCE(json_agg(json_build_object('inventory_id',ti.inventory_id,'item_name',i.name,'requested_qty',ti.requested_qty,'received_qty',ti.received_qty,'unit',ti.unit,'packaging_uom',ti.packaging_uom,'requested_packaging_qty',ti.requested_packaging_qty,'dispatched_packaging_qty',ti.dispatched_packaging_qty,'received_packaging_qty',ti.received_packaging_qty)) FILTER(WHERE ti.id IS NOT NULL),'[]') items FROM inventory_transfers t JOIN inventory_locations sl ON sl.id=t.source_location_id JOIN inventory_locations dl ON dl.id=t.destination_location_id LEFT JOIN inventory_transfer_items ti ON ti.transfer_id=t.id LEFT JOIN inventory i ON i.id=ti.inventory_id WHERE t.source_location_id=$1 OR t.destination_location_id=$1 GROUP BY t.id,sl.id,dl.id ORDER BY t.created_at DESC LIMIT 100`,[kitchen]);res.json(r.rows)}catch(e){res.status(500).json({error:'KITCHEN_DOCUMENTS_FAILED',message:e.message})}});
router.get('/audits',jwtAuth,requireRole(...READ),async(req,res)=>{try{await ensureSchema();const r=await pool.query(`SELECT a.*,u.name AS created_by_name,COALESCE(json_agg(json_build_object('id',ai.id,'inventory_id',ai.inventory_id,'item_name',i.name,'unit',i.unit,'system_qty',ai.system_qty,'counted_qty',ai.counted_qty,'variance_qty',ai.variance_qty,'avg_cost',i."avgCost") ORDER BY i.name) FILTER(WHERE ai.id IS NOT NULL),'[]') items FROM kitchen_audits a LEFT JOIN users u ON u.id=a.created_by LEFT JOIN kitchen_audit_items ai ON ai.audit_id=a.id LEFT JOIN inventory i ON i.id=ai.inventory_id GROUP BY a.id,u.id ORDER BY a.created_at DESC LIMIT 50`);res.json(r.rows)}catch(e){res.status(500).json({error:'KITCHEN_AUDITS_FAILED',message:e.message})}});
router.post('/audits',jwtAuth,requireRole(...WRITE),async(req,res)=>{const c=await pool.connect();try{await ensureSchema();await c.query('BEGIN');const loc=(await c.query(`SELECT id FROM inventory_locations WHERE code='KITCHEN-MAIN' AND active=true`)).rows[0];if(!loc){await c.query('ROLLBACK');return fail(res,422,'KITCHEN_LOCATION_NOT_CONFIGURED','موقع المطبخ غير مهيأ');}const period=['daily','weekly','monthly','custom','annual'].includes(String(req.body?.period))?String(req.body.period):'weekly';const periodStart=String(req.body?.period_start||new Date().toISOString().slice(0,10)).slice(0,10);const periodEnd=String(req.body?.period_end||periodStart).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)||!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)||periodEnd<periodStart){return fail(res,422,'INVALID_AUDIT_PERIOD','فترة الجرد غير صحيحة');}const audit=(await c.query(`INSERT INTO kitchen_audits(audit_number,period,period_start,period_end,location_id,status,created_by,notes) VALUES($1,$2,$3,$4,$5,'draft',$6,$7) RETURNING *`,[`KA-${Date.now()}`,period,periodStart,periodEnd,loc.id,req.user.id,req.body.notes||null])).rows[0];const items=(await c.query(`SELECT b.inventory_id,b.on_hand,i.name,i.unit,i."avgCost" FROM inventory_location_balances b JOIN inventory i ON i.id=b.inventory_id WHERE b.location_id=$1 AND b.on_hand<>0 ORDER BY i.name`,[loc.id])).rows;for(const x of items){await c.query(`INSERT INTO kitchen_audit_items(audit_id,inventory_id,system_qty,counted_qty,variance_qty) VALUES($1,$2,$3,$3,0)`,[audit.id,x.inventory_id,x.on_hand]);}await c.query(`UPDATE kitchen_audits SET total_items=$2 WHERE id=$1`,[audit.id,items.length]);await appendKitchenAuditEvent(c,audit.id,'created',null,'draft',req,null,{period,periodStart,periodEnd,totalItems:items.length});await c.query('COMMIT');res.json({...audit,total_items:items.length,items});}catch(e){await c.query('ROLLBACK').catch(()=>{});res.status(500).json({error:'KITCHEN_AUDIT_CREATE_FAILED',message:e.message})}finally{c.release()}});
router.post('/audits/:id/count',jwtAuth,requireRole(...WRITE),async(req,res)=>{const c=await pool.connect();try{await ensureSchema();await c.query('BEGIN');const audit=(await c.query(`SELECT * FROM kitchen_audits WHERE id=$1 FOR UPDATE`,[req.params.id])).rows[0];if(!audit||audit.status!=='draft'){await c.query('ROLLBACK');return fail(res,409,'AUDIT_NOT_DRAFT','الجرد ليس مسودة');}for(const x of(Array.isArray(req.body?.items)?req.body.items:[])){const q=num(x.counted_qty);if(!Number.isFinite(q)||q<0){continue;}await c.query(`UPDATE kitchen_audit_items SET counted_qty=$2,variance_qty=$2-system_qty,notes=$3 WHERE id=$1 AND audit_id=$4`,[x.id,q,x.notes||null,audit.id])}await c.query(`UPDATE kitchen_audits SET counted_at=CURRENT_TIMESTAMP WHERE id=$1`,[audit.id]);await c.query('COMMIT');res.json({id:audit.id,status:'draft'});}catch(e){await c.query('ROLLBACK').catch(()=>{});res.status(500).json({error:'KITCHEN_AUDIT_COUNT_FAILED',message:e.message})}finally{c.release()}});
router.post('/audits/:id/submit',jwtAuth,requireRole(...WRITE),async(req,res)=>{const signature=requireSignature(req,res);if(!signature){return;}const c=await pool.connect();try{await ensureSchema();await c.query('BEGIN');const current=(await c.query(`SELECT * FROM kitchen_audits WHERE id=$1 FOR UPDATE`,[req.params.id])).rows[0];if(!current||current.status!=='draft'){await c.query('ROLLBACK');return fail(res,409,'AUDIT_NOT_DRAFT','لا يمكن إرسال الجرد');}const submittedAt=new Date().toISOString();const r=(await c.query(`UPDATE kitchen_audits SET status='submitted',submitted_at=$1,submitted_by=$2,counted_by=$2,count_signature_data=$3,count_signature_hash=$4,submit_signature_data=$3,submit_signature_hash=$4 WHERE id=$5 RETURNING *`,[submittedAt,req.user.id,signature,signatureHash(signature),req.params.id])).rows[0];await appendKitchenAuditEvent(c,current.id,'submitted',current.status,'submitted',req,signature,{period:current.period,periodStart:current.period_start,periodEnd:current.period_end});await c.query('COMMIT');res.json(r)}catch(e){await c.query('ROLLBACK').catch(()=>{});res.status(500).json({error:'KITCHEN_AUDIT_SUBMIT_FAILED',message:e.message})}finally{c.release()}});
router.post('/audits/:id/approve',jwtAuth,requireRole('admin','manager','auditor'),async(req,res)=>{const signature=requireSignature(req,res);if(!signature){return;}const c=await pool.connect();try{await ensureSchema();await c.query('BEGIN');const audit=(await c.query(`SELECT * FROM kitchen_audits WHERE id=$1 FOR UPDATE`,[req.params.id])).rows[0];if(!audit||!['draft','submitted'].includes(audit.status)){await c.query('ROLLBACK');return fail(res,409,'AUDIT_NOT_APPROVABLE','الجرد غير قابل للاعتماد');}const items=(await c.query(`SELECT ai.*,i.unit,i."avgCost" FROM kitchen_audit_items ai JOIN inventory i ON i.id=ai.inventory_id WHERE ai.audit_id=$1 FOR UPDATE`,[audit.id])).rows;let total=0;for(const x of items){const variance=Number(x.counted_qty)-Number(x.system_qty);total+=variance*Number(x.avgCost||0);if(Math.abs(variance)>0.0005){await postInventoryLedgerEntry(c,{transactionType:'count_correction',inventoryId:x.inventory_id,locationId:audit.location_id,quantityDelta:variance,unit:x.unit||'وحدة',unitCost:Number(x.avgCost||0),referenceType:'kitchen_audit',referenceId:String(audit.id),userId:req.user.id,idempotencyKey:`kitchen-audit:${audit.id}:${x.inventory_id}`,reason:`اعتماد جرد المطبخ ${audit.audit_number}`,metadata:{system_qty:x.system_qty,counted_qty:x.counted_qty}})}}await c.query(`UPDATE kitchen_audits SET status='approved',approved_at=CURRENT_TIMESTAMP,approved_by=$2,approved_signature_data=$3,approved_signature_hash=$4,total_variance_value=$5 WHERE id=$1`,[audit.id,req.user.id,signature,signatureHash(signature),total]);await appendKitchenAuditEvent(c,audit.id,'approved',audit.status,'approved',req,signature,{totalVarianceValue:total,itemCount:items.length});await c.query('COMMIT');res.json({id:audit.id,status:'approved',total_variance_value:total})}catch(e){await c.query('ROLLBACK').catch(()=>{});res.status(500).json({error:e.code||'KITCHEN_AUDIT_APPROVE_FAILED',message:e.message})}finally{c.release()}});
module.exports={router,ensureSchema,ensureKitchenSchema:ensureSchema};
