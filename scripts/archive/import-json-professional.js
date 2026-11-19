#!/usr/bin/env node
/**
 * import-json-professional.js — استيراد JSON باحترافية دون كسر
 * ───────────────────────────────────────────────────────────────
 * - يقرأ نسخة JSON من exportAllData (version + departments + inventory + employees + attendance ...)
 * - يفحص جاف أولاً (--dry-run) ويعطي تقرير أخطاء قبل أي كتابة
 * - يستورد انتقائياً عبر معاملات، مع الحفاظ على source="device" للبصمة فقط
 * - لا يسمح بإدخال حضور يدوي على أنه بصمة
 * - نسخة احترازية تلقائية قبل الكتابة
 *
 * Usage:
 *   node scripts/import-json-professional.js "C:\Users\karim\Downloads\backup_مطاعم_الشرفه_العالمي_2026-09-19.json" --dry-run
 *   node scripts/import-json-professional.js "C:\path\to\backup.json" --yes
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../backend/shared-pool');
const { log } = require('./shared');

const DRY = process.argv.includes('--dry-run');
const YES = process.argv.includes('--yes');
const fileArg = process.argv.find(a => a.endsWith('.json') && fs.existsSync(a)) || 'C:\\Users\\karim\\Downloads\\backup_مطاعم_الشرفه_العالمي_2026-09-19.json';

async function main() {
  log.header('استيراد JSON احترافي — فحص جاف: ' + (DRY ? 'نعم' : 'لا'));
  if (!fs.existsSync(fileArg)) {
    log.error('الملف غير موجود: ' + fileArg);
    process.exit(1);
  }
  const raw = fs.readFileSync(fileArg, 'utf-8');
  let data;
  try { data = JSON.parse(raw); } catch (e) { log.error('JSON تالف: ' + e.message); process.exit(1); }

  log.info(`النسخة: ${data.version || '?'} — التاريخ: ${data.exportDate || '?'} — الحجم: ${(raw.length/1024).toFixed(1)} KB`);
  if (data.version && data.version !== '4.7.0') {
    log.warn(`تحذير: نسخة الملف ${data.version} تختلف عن النظام 4.7.0 — سيتم التعامل بحذر`);
  }

  // ─── فحص بنيوي ───
  const report = { ok: true, warnings: [], errors: [], counts: {} };
  const entities = ['departments','inventory','employees','attendance','users','purchaseInvoices','shelves','weightReadings'];
  for (const k of entities) {
    const arr = Array.isArray(data[k]) ? data[k] : [];
    report.counts[k] = arr.length;
  }
  log.info(`المحتويات: ${Object.entries(report.counts).map(([k,v]) => `${k}:${v}`).join(' | ')}`);

  // فحص تكرار id
  for (const k of ['departments','inventory','employees']) {
    const arr = data[k] || [];
    const ids = arr.map(x => String(x.id));
    const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dups.length) {
      report.errors.push(`${k}: تكرار id ${[...new Set(dups)].slice(0,3).join(',')}`);
      report.ok = false;
    }
  }
  // فحص attendance source
  const att = Array.isArray(data.attendance) ? data.attendance : [];
  const badSource = att.filter(r => r.source && r.source !== 'device' && r.source !== 'backfill');
  if (badSource.length) {report.warnings.push(`attendance: ${badSource.length} سجل بمصدر غير معروف سيُتجاهل`);}
  const noCheckIn = att.filter(r => !r.checkIn && !r.checkOut).length;
  if (noCheckIn) {report.warnings.push(`attendance: ${noCheckIn} سجل بلا حضور ولا انصراف — سيُتجاهل`);}

  // فحص inventory qty
  const invBad = (data.inventory || []).filter(x => isNaN(Number(x.qty)) || isNaN(Number(x.avgCost)));
  if (invBad.length) { report.errors.push(`inventory: ${invBad.length} صنف بقيم غير رقمية`); report.ok = false; }

  console.log('');
  if (report.warnings.length) {report.warnings.forEach(w => log.warn(w));}
  if (report.errors.length) {report.errors.forEach(e => log.error(e));}
  console.log(`النتيجة الجافة: ${report.ok ? 'سليم — يمكن الاستيراد' : 'يوجد أخطاء — لن نكتب'}`);
  if (!report.ok && !YES) {
    log.error('أصلح الأخطاء أو استخدم --yes لتجاوز التحذيرات الحرجة');
    if (DRY) {process.exit(0);}
  }
  if (DRY) {
    log.ok('فحص جاف انتهى — لم تُكتب أي بيانات');
    process.exit(0);
  }
  if (!YES) {
    log.warn('للتنفيذ الفعلي: أضف --yes');
    console.log(`مثال: node scripts/import-json-professional.js "${fileArg}" --yes`);
    process.exit(0);
  }

  // ─── نسخة احترازية ───
  log.step('نسخة احترازية تلقائية قبل الكتابة...');
  const backupScript = path.join(__dirname, '..', 'database', 'scripts', 'backup.js');
  const bak = spawnSync(process.execPath, [backupScript, path.join(__dirname, '..', 'database', 'backups', `pre-json-import-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.sql`)], { stdio: 'inherit', timeout: 300000 });
  if (bak.status !== 0) { log.warn('تعذر إنشاء نسخة احترازية — الاستمرار بحذر'); }

  // ─── استيراد انتقائي بمعاملات ───
  const client = await pool.connect();
  try {
    // departments — upsert by code (لا نكسر الأقسام الحية)
    if (Array.isArray(data.departments) && data.departments.length) {
      log.step(`استيراد ${data.departments.length} قسم...`);
      await client.query('BEGIN');
      for (const d of data.departments) {
        if (!d.code || !d.name) {continue;}
        await client.query(
          `INSERT INTO departments (id, code, name, icon, color, parent_code)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, icon=EXCLUDED.icon, color=EXCLUDED.color, parent_code=EXCLUDED.parent_code`,
          [d.id, d.code, d.name, d.icon||null, d.color||null, d.parent_code||null]
        );
      }
      await client.query('COMMIT');
      log.ok('الأقسام — تم');
    }

    // inventory — upsert (qty/avgCost فقط، لا يمسح الأرصدة بالأماكن)
    if (Array.isArray(data.inventory) && data.inventory.length) {
      log.step(`استيراد ${data.inventory.length} صنف مخزني...`);
      await client.query('BEGIN');
      for (const it of data.inventory) {
        if (!it.id || !it.name) {continue;}
        // تجاهل الأصناف التالفة
        if (isNaN(Number(it.qty)) || isNaN(Number(it.avgCost))) {continue;}
        await client.query(
          `INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty", barcode, shelfId)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, unit=EXCLUDED.unit,
             qty=EXCLUDED.qty, "avgCost"=EXCLUDED."avgCost", "minQty"=EXCLUDED."minQty", barcode=EXCLUDED.barcode`,
          [it.id, it.name, it.category||'عام', it.unit||'حبة', String(it.qty||0), String(it.avgCost||0), String(it.minQty||0), it.barcode||null, it.shelfId||null]
        );
      }
      await client.query('COMMIT');
      log.ok('الأصناف — تم');
    }

    // attendance — فقط البصمة الحقيقية (source=device)، بلا تكرار
    const attToImport = (data.attendance || []).filter(r => r.source === 'device' && (r.checkIn || r.checkOut));
    if (attToImport.length) {
      log.step(`استيراد ${attToImport.length} سجل حضور بصمة (من أصل ${att.length})...`);
      let inserted = 0, skipped = 0;
      await client.query('BEGIN');
      for (const r of attToImport) {
        const exists = await client.query(`SELECT 1 FROM attendance WHERE id=$1`, [r.id]);
        if (exists.rows.length) { skipped++; continue; }
        // تأكد الموظف موجود
        const emp = await client.query(`SELECT 1 FROM employees WHERE id=$1`, [r.employeeId]);
        if (!emp.rows.length) { skipped++; continue; }
        await client.query(
          `INSERT INTO attendance (id, "employeeId", date, "checkIn", "checkOut", late, notes, "checkInAt", "checkOutAt", "workMinutes", source, "operatorId", checkin_inferred, checkout_inferred, early_leave)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (id) DO NOTHING`,
          [r.id, r.employeeId, r.date, r.checkIn||null, r.checkOut||null, !!r.late, r.notes||null, r.checkInAt||null, r.checkOutAt||null, r.workMinutes||null, 'device', r.operatorId||null, !!r.checkin_inferred, !!r.checkout_inferred, !!r.early_leave]
        );
        inserted++;
      }
      await client.query('COMMIT');
      log.ok(`الحضور — أُدخل ${inserted} سجل بصمة، تُجوهل ${skipped} مكرر/تالف`);
    } else {
      log.warn('لا سجلات بصمة صالحة للاستيراد — تُرك الحضور الحالي كما هو');
    }

    log.ok('الاستيراد الاحترافي اكتمل — لا كسر');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    log.error('فشل الاستيراد: ' + e.message);
    console.error(e.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end().catch(()=>{});
  }
}

main().catch(e => { console.error(e.stack); process.exit(1); });
