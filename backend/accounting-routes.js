/**
 * accounting-routes.js — قسم المحاسبة: شجرة الحسابات + قيود مزدوجة + ترحيل تلقائي
 * ────────────────────────────────────────────────────────────────────────────
 * /api/accounting
 *   GET  /chart                 شجرة الحسابات              (admin/accountant/manager/auditor)
 *   POST /chart                 حساب جديد                  (admin/accountant)
 *   GET  /trial-balance         ميزان المراجعة              (admin/accountant/manager/auditor)
 *   GET  /journal               دفتر القيود                 (admin/accountant/manager/auditor)
 *   POST /journal               قيد يدوي متوازن            (admin/accountant)
 *   POST /post-payroll          ترحيل رواتب شهر             (admin/accountant)
 *   GET  /cfo-summary           ملخص المدير المالي          (admin/accountant/manager)
 *
 * ضمانات: كل قيد متوازن (مدين=دائن ±0.01)، الحسابات موجودة ونشطة وقابلة
 * للترحيل، والترحيل التلقائي idempotent بمفتاح (source_type, source_id) —
 * إعادة التشغيل لا تكرر أبدًا. أخطاء الترحيل لا تُسقط البيع أبدًا.
 */

'use strict';

const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { crudLimiter } = require('./rate-limiter');
const { logger } = require('./logger');
const {
  calculateVatMovement,
  normalizeVatRateRows,
  matchesFilingFrequency,
  buildVatFilingReadiness,
  isValidDateOnly,
} = require('./vat-reporting');
const { normalizeVat, ZATCA_PLACEHOLDER_VAT } = require('./cashier-module/zatca-vat');

const router = express.Router();
const READ_ROLES = ['admin', 'accountant', 'manager', 'auditor'];
const WRITE_ROLES = ['admin', 'accountant'];

const crypto = require('crypto');
const uid = () => Date.now() * 1000 + crypto.randomInt(0, 999999);
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
// FIX 2026-10-11 (M20): use riyadhToday() instead of UTC toISOString()
const { riyadhToday, riyadhMonth, riyadhDateOf } = require('./riyadh-date');
// Phase 3 (2026-11-06): قراءة الحسابات من account_mapping بدل ثوابت متناثرة —
// الافتراضي الممرَّر هو الثابت القديم نفسه، فالسلوك لا يتغير قبل ضبط الجدول.
const { resolveAccounts, getMappedAccount } = require('./coa-mapping');

// مفاتيح جسر يارسوفت — مصدر واحد حتى لا تنفصل تسوية اللوحة عن مفاتيح الترحيل
const {
  SOURCE_TYPE: YARA_REVENUE_SOURCE,
  PREBOOK_SOURCE_TYPE: YARA_PREBOOK_SOURCE,
  cutoverDate: bridgeCutover,
} = require('./yarasoft/gl-bridge');

// مراكز التكلفة اختيارية على مستوى القاعدة: إن لم تُطبق migration 081 بعد،
// يعمل الترحيل (يدوي وتلقائي) بدونها بدل أن يكسر البيع. يُكتشف مرة واحدة.
let _ccReady = null;
async function ccReady(db) {
  if (_ccReady !== null) {
    return _ccReady;
  }
  try {
    await db.query('SELECT 1 FROM cost_centers LIMIT 1');
    _ccReady = true;
  } catch (_) {
    _ccReady = false;
  }
  return _ccReady;
}

/** ترقيم قيد يومي متسلسل — بالأقصى لا بالعدّ (الفجوات من حذف/إبطال لا تكسره) */
async function nextEntryNo(client) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const mx = (
    await client.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(entry_no FROM 'JE-[0-9]{8}-([0-9]+)') AS int)), 0)::int AS m
         FROM journal_entries WHERE entry_no LIKE $1`,
      [`JE-${day}-%`]
    )
  ).rows[0].m;
  for (let n = mx + 1; n <= mx + 10; n++) {
    const no = `JE-${day}-${String(n).padStart(4, '0')}`;
    const clash = await client.query('SELECT 1 FROM journal_entries WHERE entry_no = $1 LIMIT 1', [no]);
    if (!clash.rows[0]) {
      return no;
    }
  }
  return `JE-${Date.now()}`;
}

/**
 * ترحيل قيد متوازن — يستخدم نفس الاتصال (معاملة المتصل) أو المسبح.
 * يُرجع { entry, replay:true } عند وجود نفس المصدر مسبقًا (لا ازدواج).
 */
/**
 * عبارات البحث عن الموجود ثابتةٌ جميعًا: بوابة الأمان (sql-interp) حصّتها صفر ولا
 * تُعفي ملفًا، فالاختيار بين «المُبطل موجود» و«المُبطل ليس موجودًا» يُمثَّل بثوابت
 * لا بسلسلة WHERE مُستخرَبة. الوسائط دائمًا $1 نوع المصدر و$2 المرجع.
 */
const SQL_FIND_ANY = `SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2 LIMIT 1`;
const SQL_FIND_LIVE = `SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2 AND status <> 'void' LIMIT 1`;
const SQL_FIND_VOID = `SELECT 1 FROM journal_entries WHERE source_type = $1 AND source_id = $2 AND status = 'void' LIMIT 1`;
// LIKE '$2#r%' يجلب العائلة كلها؛ المطابقة الدقيقة للمرجع الأساسي تُفلتر في JS
// لأن _ و% داخل المرجع عاملا تبديل في LIKE (مرجع مثل PO_12 يجرّ POX12#r3).
const SQL_FIND_REV_LIVE = `SELECT * FROM journal_entries WHERE source_type = $1 AND source_id LIKE $2 || '#r%' AND status <> 'void'`;
// بصمة المحتوى للقيود اليدوية بلا مرجع: نفس التفريع بالعلمين، ثابتان لا قوالب.
const SQL_FP_CAND_ANY = `SELECT id, memo FROM journal_entries
                          WHERE source_type = 'manual' AND source_id LIKE 'manual:%'
                            AND created_by = $1 AND date = $2
                            AND created_at >= NOW() - INTERVAL '10 minutes'
                          ORDER BY created_at DESC LIMIT 5`;
const SQL_FP_CAND_LIVE = `SELECT id, memo FROM journal_entries
                          WHERE source_type = 'manual' AND source_id LIKE 'manual:%'
                            AND status <> 'void'
                            AND created_by = $1 AND date = $2
                            AND created_at >= NOW() - INTERVAL '10 minutes'
                          ORDER BY created_at DESC LIMIT 5`;

/**
 * @param {any} db اتصال العميل (معاملة) أو المسبح
 * @param {object} entry
 * @param {string} entry.date
 * @param {string} entry.memo
 * @param {string} [entry.source_type]
 * @param {string|number|null} [entry.source_id]
 * @param {Array<{account_code:string,debit?:number,credit?:number,memo?:string|null,cost_center_code?:string|null}>} entry.lines
 * @param {string|number|null} [entry.created_by]
 * @param {'posted'|'draft'} [entry.status]
 * @param {boolean} [entry.repostVoided] مسار بشري صريح: أعد الترحيل بمرجع `#rN` بدل اعتبار المُبطل موجودًا
 * @returns {Promise<any>}
 */
async function postJournal(
  db,
  {
    date,
    memo,
    source_type = 'manual',
    source_id = null,
    lines,
    created_by = null,
    status = 'posted',
    repostVoided = false,
  }
) {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw Object.assign(new Error('تاريخ القيد غير صالح (YYYY-MM-DD)'), { statusCode: 422 });
  }
  // قفل الفترات: أي ترحيل (يدوي أو تلقائي) على شهر مقفل يُرفض — التوافق محفوظ
  // لأن الفترات المفتوحة (الافتراضي) تمر دون أي تغيير سلوكي.
  const wantDraft = status === 'draft';
  await require('./accounting-periods').assertPeriodOpen(day);
  const clean = (Array.isArray(lines) ? lines : [])
    .map(l => ({
      account_code: String(l.account_code || '').trim(),
      debit: round2(l.debit),
      credit: round2(l.credit),
      memo: l.memo != null ? String(l.memo).slice(0, 255) : null,
      cost_center_code: l.cost_center_code != null ? normalizeCostCenterCode(l.cost_center_code) || null : null,
    }))
    .filter(l => l.account_code && (l.debit > 0 || l.credit > 0));
  if (clean.length < 2) {
    throw Object.assign(new Error('القيد يحتاج سطرين على الأقل بمبالغ موجبة'), { statusCode: 422 });
  }
  for (const l of clean) {
    if (l.debit > 0 && l.credit > 0) {
      throw Object.assign(new Error(`السطر ${l.account_code}: مدين أو دائن فقط`), { statusCode: 422 });
    }
  }
  const dr = round2(clean.reduce((s, l) => s + l.debit, 0));
  const cr = round2(clean.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.01) {
    throw Object.assign(new Error(`القيد غير متوازن: مدين ${dr} ≠ دائن ${cr}`), { statusCode: 422 });
  }
  const codes = [...new Set(clean.map(l => l.account_code))];
  const acc = await db.query(
    `SELECT code FROM chart_of_accounts WHERE code = ANY($1) AND is_active = true AND is_postable = true`,
    [codes]
  );
  const ok = new Set(acc.rows.map(r => r.code));
  const bad = codes.filter(c => !ok.has(c));
  if (bad.length) {
    throw Object.assign(new Error(`حسابات غير صالحة للترحيل: ${bad.join('، ')}`), { statusCode: 422 });
  }
  const ccCodes = [...new Set(clean.map(l => l.cost_center_code).filter(Boolean))];
  const useCC = ccCodes.length > 0 && (await ccReady(db));
  if (ccCodes.length && useCC) {
    const cc = await db.query(`SELECT code FROM cost_centers WHERE code = ANY($1) AND is_active = true`, [ccCodes]);
    const ccOk = new Set(cc.rows.map(r => r.code));
    const ccBad = ccCodes.filter(c => !ccOk.has(c));
    if (ccBad.length) {
      throw Object.assign(new Error(`مراكز تكلفة غير صالحة: ${ccBad.join('، ')}`), { statusCode: 422 });
    }
  }

  // معرّف المصدر الفعّال: اليدوي بلا مرجع يأخذ مرجعًا فريدًا دائمًا (لا يمنع القيود اليدوية)
  let effSourceId = source_id != null && String(source_id).trim() !== '' ? String(source_id) : null;
  if (effSourceId == null) {
    effSourceId = `manual:${Date.now()}:${Math.floor(Math.random() * 1000000)}`;
  }
  const hasExplicitRef = source_id != null && String(source_id).trim() !== '';

  // الافتراضي (كل المُرحِّلات الآلية): سطر status='void' يُعدّ «المرجع محجوز» —
  // لا يُعاد ترحيلُه، فلا ينقلب قرار إبطال بشري ضمنيًا في أي sweep أو جسر.
  // repostVoided=true للمسار البشري الصريح: المُبطل خارج الأستاذ العام فلا يكون
  // «ترحيلًا موجودًا»، وإعادة الحفظ تُرحّل نسخة منقّحة بمرجع مراجعة `#rN`.
  const findExisting = async ref =>
    (await db.query(repostVoided ? SQL_FIND_LIVE : SQL_FIND_ANY, [source_type, ref])).rows[0] || null;

  // فحص مسبق خارج المعاملة (التحقق داخل معاملة مُجهضة مستحيل في PostgreSQL)
  if (hasExplicitRef) {
    const pre = await findExisting(effSourceId);
    if (pre) {
      return { entry: pre, replay: true };
    }
    if (repostVoided) {
      const heldVoid = await db.query(SQL_FIND_VOID, [source_type, effSourceId]);
      if (heldVoid.rows[0]) {
        // uq_journal_source لا يسمح بصف ثانٍ بنفس المرجع والمُبطل يحتفظ به
        // للأبد ⇒ مرجع المراجعة. ولا تُعاد الترحيلات إن كان في العائلة سطر
        // حيّ أصلًا (رحّل المصدر من قبل) وإلا تكرّر الإيراد/المصروف في الأستاذ.
        const fam = await db.query(SQL_FIND_REV_LIVE, [source_type, effSourceId]);
        const live = fam.rows.filter(r => String(r.source_id).split('#r')[0] === String(effSourceId))[0];
        if (live) {
          return { entry: live, replay: true };
        }
        effSourceId = await require('./journal-void').nextRevisionSourceId(db, source_type, effSourceId);
      }
    }
  }

  // HARDENED 2026-10-07: القيود اليدوية بلا مرجع كانت تأخذ مرجعًا عشوائيًا دائمًا —
  // ضغطة مكررة على حفظ كانت ترحّل القيد مرتين. بصمة المحتوى (نفس المستخدم +
  // نفس السطور + نفس البيان خلال 10 دقائق) تُعيد الموجود بدل التكرار.
  if (!hasExplicitRef) {
    if (created_by != null) {
      const fpSig =
        clean
          .map(l => `${l.account_code}:${Number(l.debit).toFixed(2)}:${Number(l.credit).toFixed(2)}`)
          .sort()
          .join('|') +
        '#' +
        String(memo || '')
          .trim()
          .slice(0, 200);
      const cand = await db.query(repostVoided ? SQL_FP_CAND_LIVE : SQL_FP_CAND_ANY, [created_by, day]);
      for (const c of cand.rows) {
        const ll = await db.query(
          `SELECT account_code, debit, credit FROM journal_lines WHERE entry_id = $1 ORDER BY account_code`,
          [c.id]
        );
        const s2 =
          ll.rows
            .map(l => `${l.account_code}:${Number(l.debit).toFixed(2)}:${Number(l.credit).toFixed(2)}`)
            .sort()
            .join('|') +
          '#' +
          String(c.memo || '')
            .trim()
            .slice(0, 200);
        if (s2 === fpSig) {
          const full = await db.query(`SELECT * FROM journal_entries WHERE id = $1`, [c.id]);
          return { entry: full.rows[0], replay: true };
        }
      }
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const doRun = async client => {
      // قفل الفترة داخل نفس المعاملة (R-07): assertPeriodOpen خارج المعاملة كان
      // يترك نافذة سباق بين الفحص والإدراج — الآن الصف يُقفل FOR UPDATE هنا.
      await require('./accounting-periods').assertPeriodOpenInTx(client, day);
      const entryNo = await nextEntryNo(client);
      const e = (
        await client.query(
          `INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, created_by, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            uid(),
            entryNo,
            day,
            memo ? String(memo).slice(0, 500) : null,
            source_type,
            effSourceId,
            created_by,
            wantDraft ? 'draft' : 'posted',
          ]
        )
      ).rows[0];
      for (const l of clean) {
        if (useCC) {
          await client.query(
            `INSERT INTO journal_lines (id, entry_id, account_code, debit, credit, memo, cost_center_code)
                         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              uid() + Math.floor(Math.random() * 999),
              e.id,
              l.account_code,
              l.debit,
              l.credit,
              l.memo,
              l.cost_center_code,
            ]
          );
        } else {
          await client.query(
            `INSERT INTO journal_lines (id, entry_id, account_code, debit, credit, memo)
                         VALUES ($1,$2,$3,$4,$5,$6)`,
            [uid() + Math.floor(Math.random() * 999), e.id, l.account_code, l.debit, l.credit, l.memo]
          );
        }
      }
      return { entry: e, lines: clean, replay: false };
    };
    // سباق الترقيم يُعاد، سباق المصدر يُرجع الموجود
    if (db.query && !db.release) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        try {
          const out = await doRun(client);
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          if (err.code === '23505') {
            const dup = await findExisting(effSourceId);
            if (dup) {
              return { entry: dup, replay: true };
            }
          }
          if (err.code === '23505' && attempt < 2) {
            continue;
          }
          throw err;
        }
      } finally {
        client.release();
      }
    }
    try {
      return await doRun(db);
    } catch (err) {
      if (err.code === '23505') {
        const dup = await findExisting(effSourceId).catch(() => null);
        if (dup) {
          return { entry: dup, replay: true };
        }
      }
      if (err.code === '23505' && attempt < 2) {
        continue;
      }
      throw err;
    }
  }
  throw Object.assign(new Error('تعذر ترحيل القيد بعد عدة محاولات'), { statusCode: 500 });
}

/**
 * سطور قيد البيع — دالة نقية تُختبر بلا قاعدة بيانات (عقد Phase 3: نفس السطور
 * حرفيًا قبل وبعد ربط account_mapping، لأن الافتراضي هو الثابت القديم).
 * Dr نقدي/بنك للتحصيل ← Cr إيراد + ضريبة، وللمكونات Dr COGS ← Cr مخزون.
 * @param {{orderId:(number|string), total:number, tax:number, cogs:number,
 *          pays:Array<{method?:string,amount?:number|string,direction?:string}>,
 *          accounts?:Record<string,string>}} input
 * @returns {Array<{account_code:string,debit:number,credit:number,memo:string}>}
 */
function buildSalePostingLines({ orderId, total, tax, cogs, pays, accounts = {} }) {
  const cashAcct = accounts.cash_account || '1000';
  const bankAcct = accounts.bank_account || '1010';
  const revenueAcct = accounts.revenue_account || '4000';
  const vatAcct = accounts.vat_output_account || '2100';
  const cogsAcct = accounts.cogs_account || '5000';
  const inventoryAcct = accounts.inventory_account || '1200';
  const t = round2(total);
  const vat = round2(tax);
  const revenue = round2(t - vat);
  const cost = round2(cogs);
  const rows = Array.isArray(pays) ? pays : [];
  const lines = [];
  if (rows.length) {
    const nonCash = round2(
      rows
        .filter(p => p.direction !== 'out' && String(p.method).toLowerCase() !== 'cash')
        .reduce((s, p) => s + Number(p.amount), 0)
    );
    const cardPart = Math.min(nonCash, t);
    const cashDebit = round2(t - cardPart);
    if (cardPart > 0) {
      lines.push({ account_code: bankAcct, debit: cardPart, credit: 0, memo: 'تحصيل غير نقدي' });
    }
    if (cashDebit > 0) {
      lines.push({ account_code: cashAcct, debit: cashDebit, credit: 0, memo: 'تحصيل نقدي' });
    }
  } else {
    lines.push({ account_code: cashAcct, debit: t, credit: 0, memo: 'تحصيل نقدي' });
  }
  if (cost > 0) {
    lines.push({ account_code: cogsAcct, debit: cost, credit: 0, memo: `تكلفة مكونات فاتورة #${orderId}` });
    lines.push({ account_code: inventoryAcct, debit: 0, credit: cost, memo: `تخفيض مخزون فاتورة #${orderId}` });
  }
  if (revenue > 0) {
    lines.push({ account_code: revenueAcct, debit: 0, credit: revenue, memo: `مبيعات فاتورة #${orderId}` });
  }
  if (vat > 0) {
    lines.push({ account_code: vatAcct, debit: 0, credit: vat, memo: `ضريبة فاتورة #${orderId}` });
  }
  return lines;
}

/** ترحيل فاتورة كاشير: نقدية/بنك ← إيراد + ضريبة + COGS للمكونات (idempotent برقم الفاتورة) */
async function postSaleToLedger(orderId) {
  const o = (
    await pool.query(
      `SELECT id, subtotal, discount_total, tax_total, total_amount, created_at FROM pos_orders WHERE id = $1 LIMIT 1`,
      [orderId]
    )
  ).rows[0];
  if (!o) {
    return { skipped: 'order_not_found' };
  }
  // ROOT FIX 2026-10-02: كان يُرحّل كل صفوف الدفع بما فيها صفوف «الباقي»
  // (direction=out) كتحصيل — فيفشل توازن القيد دائمًا لأي بيع كاش فيه باقي
  // ويُبتلع الخطأ بصمت بلا قيد. الصحيح: الصندوق يستلم الإجمالي فقط —
  // non-cash بمبلغه، والنقدي = الإجمالي − غير النقدي.
  const pays = (
    await pool.query(`SELECT method, amount, direction FROM pos_invoice_payments WHERE order_id = $1`, [orderId])
  ).rows;
  // FIX C1 (Enterprise 2026-10-03): البيع POS كان يُرحّل الإيراد دون تكلفة
  // المكونات — بينما الصرف المخزني يرحّل COGS. تكلفة البيع = مجموع total_cost
  // لصفوف الاستهلاك الصادرة (total_cost يُخزّن بمقدار موجب حتى للصادر —
  // الاتجاه تحدده quantity_delta) المرجعية لهذا الأمر (تُكتب قبل COMMIT).
  const cogsRow = await pool.query(
    `SELECT COALESCE(SUM(l.total_cost), 0) AS cogs
           FROM inventory_ledger l
          WHERE l.reference_type = 'pos_order' AND l.reference_id = $1 AND l.quantity_delta < 0`,
    [orderId]
  );
  const cogs = round2(Number(cogsRow.rows[0]?.cogs || 0));
  const total = round2(o.total_amount);
  const tax = round2(o.tax_total);
  if (total <= 0) {
    return { skipped: 'zero_total' };
  }
  const accounts = await resolveAccounts(pool, 'sales_pos', 'pos_sale', {
    cash_account: '1000',
    bank_account: '1010',
    revenue_account: '4000',
    vat_output_account: '2100',
    cogs_account: '5000',
    inventory_account: '1200',
  });
  const lines = buildSalePostingLines({ orderId, total, tax, cogs, pays, accounts });
  // FIX (Enterprise 2026-10-21): تاريخ القيد بتوقيت الرياض لا UTC.
  // toISOString() في 00:00–02:59 الرياض يُرجع اليوم السابق — فمبيعات
  // ما بعد منتصف الليل كانت تُرحَّل في يوم اليوم.
  const day = riyadhDateOf(o.created_at || Date.now());
  const out = await postJournal(pool, {
    date: day,
    memo: `مبيعات كاشير — فاتورة #${orderId}`,
    source_type: 'pos_sale',
    source_id: String(orderId),
    lines,
  });
  logger.info(`[LEDGER] فاتورة #${orderId}: ${out.replay ? 'مُرحّلة مسبقًا' : `قيد ${out.entry.entry_no}`}`);
  return out;
}

/**
 * ترحيل فاتورة شراء: مخزون (صافي) + ضريبة مدخلات مستردة ← ذمم موردين (إجمالي).
 * Dr 1200 Inventory (net) · Dr 1150 Input VAT (vat) · Cr 2000 AP (gross).
 * idempotent بمفتاح (purchase_invoice, invoiceId) — إعادة التشغيل لا تكرر أبدًا.
 * تعديل فاتورة مرحّلة: تُبطل النسخة القديمة وتُرحَّل نسخة بمفتاح مراجعة
 * ({invoiceId}:revision:{rev} عبر sourceId) — المرجع المُبطل يبقى محجوزًا في
 * uq_journal_source، فالإعادة بنفس invoiceId ستعيد القيد المُبطل لا قيدًا جديدًا.
 * يُستدعى best-effort بعد COMMIT الفاتورة — فشله لا يُسقط الشراء أبدًا.
 */
async function postPurchaseToLedger(invoiceId, { sourceId } = {}) {
  const inv = (
    await pool.query(
      `SELECT id, "invoiceNumber", date, subtotal_net, vat_total, "totalAmount"
          FROM "purchaseInvoices" WHERE id = $1 LIMIT 1`,
      [invoiceId]
    )
  ).rows[0];
  if (!inv) {
    return { skipped: 'invoice_not_found' };
  }
  const net = round2(inv.subtotal_net ?? inv.totalAmount);
  const vat = round2(inv.vat_total ?? 0);
  const gross = round2(inv.totalAmount);
  if (gross <= 0) {
    return { skipped: 'zero_total' };
  }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(inv.date || '').slice(0, 10))
    ? String(inv.date).slice(0, 10)
    : riyadhToday();
  const accounts = await resolveAccounts(pool, 'purchases', 'purchase_invoice', {
    inventory_account: '1200',
    vat_input_account: '1150',
    payable_account: '2000',
  });
  const lines = [
    {
      account_code: accounts.inventory_account,
      debit: net,
      credit: 0,
      memo: `مخزون فاتورة شراء ${inv.invoiceNumber || invoiceId}`,
    },
  ];
  if (vat > 0) {
    lines.push({
      account_code: accounts.vat_input_account,
      debit: vat,
      credit: 0,
      memo: `ضريبة مدخلات ${inv.invoiceNumber || invoiceId}`,
    });
  }
  lines.push({
    account_code: accounts.payable_account,
    debit: 0,
    credit: gross,
    memo: `مستحق مورد ${inv.invoiceNumber || invoiceId}`,
  });
  const out = await postJournal(pool, {
    date: day,
    memo: `فاتورة شراء — ${inv.invoiceNumber || invoiceId}`,
    source_type: 'purchase_invoice',
    source_id: sourceId || String(invoiceId),
    lines,
  });
  logger.info(`[LEDGER] فاتورة شراء ${invoiceId}: ${out.replay ? 'مُرحّلة مسبقًا' : `قيد ${out.entry.entry_no}`}`);
  return out;
}

/**
 * قيد الرصيد الافتتاحي (2026-10-02): جرد البداية ليس مشتريات — لا مورد دائن
 * ولا ضريبة مدخلات. المعالجة الصحيحة: Dr 1200 مخزون المواد ← Cr 3000 رأس المال
 * بإجمالي القيمة. يُستدعى لفواتير الأرصدة الافتتاحية (invoiceNumber يبدأ بـ OPEN-)
 * بنفس مفتاح idempotency (source_type, source_id) — إعادة الترحيل تُكتشف تلقائيًا.
 */
async function postOpeningToLedger(invoiceId) {
  const inv = (
    await pool.query(
      `SELECT id, "invoiceNumber", date, "totalAmount"
          FROM "purchaseInvoices" WHERE id = $1 LIMIT 1`,
      [invoiceId]
    )
  ).rows[0];
  if (!inv) {
    return { skipped: 'invoice_not_found' };
  }
  const gross = round2(inv.totalAmount);
  if (gross <= 0) {
    return { skipped: 'zero_total' };
  }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(inv.date || '').slice(0, 10))
    ? String(inv.date).slice(0, 10)
    : riyadhToday();
  const accounts = await resolveAccounts(pool, 'purchases', 'purchase_opening', {
    inventory_account: '1200',
    equity_account: '3000',
  });
  const out = await postJournal(pool, {
    date: day,
    memo: `رصيد افتتاحي — ${inv.invoiceNumber || invoiceId}`,
    source_type: 'purchase_invoice',
    source_id: String(invoiceId),
    lines: [
      { account_code: accounts.inventory_account, debit: gross, credit: 0, memo: 'مخزون افتتاحي' },
      { account_code: accounts.equity_account, debit: 0, credit: gross, memo: 'رأس المال — رصيد افتتاحي' },
    ],
  });
  logger.info(`[LEDGER] رصيد افتتاحي ${invoiceId}: ${out.replay ? 'مُرحّل مسبقًا' : `قيد ${out.entry.entry_no}`}`);
  return out;
}

/**
 * إصلاح خطأ محاسبي كان قائمًا: الصرف للأقسام والإرجاع منها يحرّكان المخزون
 * (1200) والمصاريف دون أي قيد — فحساب المخزون يتضخم ولا COGS في الأستاذ.
 * الحركات المتماثلة (نقية، قابلة للاختبار):
 *   صرف OUT: Dr 5000 تكلفة بضاعة ← Cr 1200 مخزون (بمتوسط التكلفة المرجح)
 *   إرجاع IN: Dr 1200 مخزون ← Cr 5000 تكلفة بضاعة (عكس متماثل)
 */
function buildStockMoveLines(totalValue, direction, costCenter = null, accounts = {}) {
  const v = round2(totalValue);
  if (!(v > 0)) {
    return [];
  }
  const cogsAcct = (accounts && accounts.cogs_account) || '5000';
  const inventoryAcct = (accounts && accounts.inventory_account) || '1200';
  if (direction === 'in') {
    return [
      {
        account_code: inventoryAcct,
        debit: v,
        credit: 0,
        memo: 'إرجاع مخزون',
        ...(costCenter ? { cost_center_code: costCenter } : {}),
      },
      {
        account_code: cogsAcct,
        debit: 0,
        credit: v,
        memo: 'عكس تكلفة',
        ...(costCenter ? { cost_center_code: costCenter } : {}),
      },
    ];
  }
  return [
    {
      account_code: cogsAcct,
      debit: v,
      credit: 0,
      memo: 'تكلفة صرف',
      ...(costCenter ? { cost_center_code: costCenter } : {}),
    },
    {
      account_code: inventoryAcct,
      debit: 0,
      credit: v,
      memo: 'صرف مخزون',
      ...(costCenter ? { cost_center_code: costCenter } : {}),
    },
  ];
}

/** ضمان وجود مراكز تكلفة للأقسام قبل أول قيدٍ يحملها — idempotent.
 *  postJournal يرفض أي cost_center غير موجود، فتُنشأ الصفوف إن غابت
 *  (best-effort: إن فشل الإنشاء يُرحَّل القيد بلا مركز كما كان). */
/**
 * رمز مركز تكلفة كما يفرضه الجدول: `CHECK (code ~ '^[A-Z0-9_-]{1,20}$')`.
 * أقسام التشغيل تُسمّى بأحرف صغيرة (`kitchen`, `hot_hall`, `external_sales`)،
 * فكان الإدراج الخامّ يفشل دائمًا بقيد `cost_centers_code_check`، ثم يرمي
 * postJournal «مركز غير معروف» بعد أن يرفع الرمز إلى أحرف كبيرة — فيسقط قيد
 * الصرف كله بصمت. التطبيع هنا هو مصدر الحقيقة الوحيد للرمز.
 */
function normalizeCostCenterCode(code) {
  const s = String(code == null ? '' : code)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .slice(0, 20);
  return s || '';
}

async function ensureCostCenters(codes = []) {
  const wanted = [...new Set(codes.map(normalizeCostCenterCode).filter(Boolean))];
  if (!wanted.length) {
    return wanted;
  }
  try {
    // ON CONFLICT بدل NOT EXISTS: الاعتمادات المتزامنة كانت تتسابق فتفشل
    // إحداهما بخطأ 23505 (سُجّل فعلًا 2026-10-26 في سجل التشغيل).
    await pool.query(
      `INSERT INTO cost_centers (code, name_ar)
             SELECT c, c FROM unnest($1::text[]) AS c
             ON CONFLICT (code) DO NOTHING`,
      [wanted]
    );
  } catch (e) {
    logger.warn(`[cost-centers] ensure skipped: ${e.message}`);
  }
  return wanted;
}

/** ترحيل صرف معتمد: idempotent بمفتاح (dispatch, id) — best-effort بعد COMMIT.
 *  سطر التكلفة يحمل cost_center_code = القسم الطالب (إن وُجد مركزُه) —
 *  فانقسام COGS لكل قسم يصبح ممكنًا من الأستاذ مباشرة. */
async function postDispatchToLedger(dispatchId, { totalValue, date, deptCode } = {}) {
  const v = round2(totalValue);
  if (!(v > 0)) {
    return { skipped: 'zero_total' };
  }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '').slice(0, 10)) ? String(date).slice(0, 10) : riyadhToday();
  if (deptCode) {
    await ensureCostCenters([deptCode]);
  }
  const accounts = await resolveAccounts(pool, 'inventory', 'stock_dispatch', {
    cogs_account: '5000',
    inventory_account: '1200',
  });
  const out = await postJournal(pool, {
    date: day,
    memo: `صرف مخزون — إذن #${dispatchId}${deptCode ? ` (${deptCode})` : ''}`,
    source_type: 'dispatch',
    source_id: String(dispatchId),
    lines: buildStockMoveLines(v, 'out', deptCode || null, accounts),
  });
  logger.info(`[LEDGER] صرف #${dispatchId}: ${out.replay ? 'مُرحّل مسبقًا' : `قيد ${out.entry.entry_no}`}`);
  return out;
}

/** ترحيل إرجاع معتمد (عكس متماثل): idempotent بمفتاح (kitchen_return, id). */
async function postReturnToLedger(returnId, { totalValue, date, deptCode } = {}) {
  const v = round2(totalValue);
  if (!(v > 0)) {
    return { skipped: 'zero_total' };
  }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '').slice(0, 10)) ? String(date).slice(0, 10) : riyadhToday();
  if (deptCode) {
    await ensureCostCenters([deptCode]);
  }
  const accounts = await resolveAccounts(pool, 'inventory', 'stock_return', {
    cogs_account: '5000',
    inventory_account: '1200',
  });
  const out = await postJournal(pool, {
    date: day,
    memo: `إرجاع مخزون — مرتجع #${returnId}${deptCode ? ` (${deptCode})` : ''}`,
    source_type: 'kitchen_return',
    source_id: String(returnId),
    lines: buildStockMoveLines(v, 'in', deptCode || null, accounts),
  });
  logger.info(`[LEDGER] مرتجع #${returnId}: ${out.replay ? 'مُرحّل مسبقًا' : `قيد ${out.entry.entry_no}`}`);
  return out;
}

// ─── الإقرار الضريبي + تصفية 1150 ───────────────────────────────────────────
// مصادر من الأستاذ العام المرحّل فعليًا (2100 دائن − 1150 مدين) مع مطابقة
// متقاطعة من فواتير الشراء — ما يُقدَّم للهيئة يُبنى على المرحّل لا التقديري.
//
// سياسة تصفية 1150 (2026-11-06): قبلها كان الوسيط يتراكم بلا إقفال. عند كل
// إقرار تُطفأ ضريبة المدخلات مقابل المخرجات بالحد الأدنى للرصيدين المرحّلين
// حتى نهاية الشهر: Dr 2100 / Cr 1150. الناتج يبقى كما هو: صافي مستحق على
// 2100 (يُسدَّد بقيد Dr 2100 / Cr بنك عند الدفع) أو رصيد ترحيل على 1150.
// الترحيل على أساس الأرصدة لا حركة الشهر، فأول تصفية تُنظّف التراكم التاريخي
// ثم تُبقي كل شهر لاحق الأرصدة متطابقة — idempotent بمفتاح (vat_settlement, month).

/** حركة ضريبية للمراجعة من القيود المرحّلة، مع فصل العكس والحركات غير المصنّفة. */
async function vatMovement(db, from, to, accounts) {
  const posted = await db.query(
    `SELECT l.account_code, e.source_type,
                ROUND(COALESCE(SUM(l.debit),0),2)::float AS debit,
                ROUND(COALESCE(SUM(l.credit),0),2)::float AS credit
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
         WHERE e.date >= $1::date AND e.date <= $2::date AND l.account_code IN ($3,$4)
         GROUP BY 1, 2`,
    [from, to, accounts.payable_account, accounts.recoverable_account]
  );
  return calculateVatMovement(posted.rows, accounts);
}

/** أرصدة الضريبة المرحّلة حتى تاريخ: موجب = مستحق (2100) / قابل للاسترداد (1150). */
async function vatBalances(db, asOf, accounts) {
  const r = await db.query(
    `SELECT COALESCE(ROUND(SUM(CASE WHEN l.account_code = $2 THEN l.credit - l.debit ELSE 0 END),2),0)::float AS payable,
                COALESCE(ROUND(SUM(CASE WHEN l.account_code = $3 THEN l.debit - l.credit ELSE 0 END),2),0)::float AS recoverable
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
          WHERE e.date <= $1::date AND l.account_code IN ($2,$3)`,
    [asOf, accounts.payable_account, accounts.recoverable_account]
  );
  return {
    payable: Number(r.rows[0]?.payable || 0),
    recoverable: Number(r.rows[0]?.recoverable || 0),
  };
}

/**
 * خطة التصفية — دالة نقية: الإطفاء = min(المستحق، القابل للاسترداد).
 * لا تُنشئ أي سطر لصافي المستحق (يبقى رصيد 2100) ولا لترحيل الرصيد (يبقى 1150).
 */
function buildVatSettlementPlan({ payableBalance, recoverableBalance, accounts = {} }) {
  const payableAcct = accounts.payable_account || '2100';
  const recoverableAcct = accounts.recoverable_account || '1150';
  const payable = round2(payableBalance);
  const recoverable = round2(recoverableBalance);
  const clearing = round2(Math.min(Math.max(payable, 0), Math.max(recoverable, 0)));
  const lines =
    clearing > 0
      ? [
          { account_code: payableAcct, debit: clearing, credit: 0, memo: 'تصفية ضريبة مخرجات مقابل مدخلات' },
          { account_code: recoverableAcct, debit: 0, credit: clearing, memo: 'تصفية ضريبة مدخلات' },
        ]
      : [];
  return {
    clearing,
    net_payable_after: round2(Math.max(payable, 0) - clearing),
    carry_forward_after: round2(Math.max(recoverable, 0) - clearing),
    lines,
  };
}

router.get('/vat-return', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
  try {
    // FIX (Enterprise 2026-10-21): الشهر واليوم بتوقيت الرياض — لا
    // التوقيت المحلي للخادم ولا UTC (كانا ينزلقان شهرًا/يومًا).
    const monthStart = `${riyadhMonth()}-01`;
    const from = req.query.from ? String(req.query.from) : monthStart;
    const to = req.query.to ? String(req.query.to) : riyadhToday();
    if (!isValidDateOnly(from) || !isValidDateOnly(to) || from > to) {
      return res.status(422).json({ error: 'LEDGER_PERIOD_INVALID', message: 'فترة التقرير غير صالحة' });
    }
    const openingDate = new Date(`${from}T00:00:00.000Z`);
    openingDate.setUTCDate(openingDate.getUTCDate() - 1);
    const openingAsOf = openingDate.toISOString().slice(0, 10);
    const accounts = await resolveAccounts(pool, 'tax', 'vat_return', {
      payable_account: '2100',
      recoverable_account: '1150',
    });
    const standardRateRow = (
      await pool.query('SELECT standard_vat_rate, filing_frequency FROM tax_config WHERE id = 1')
    ).rows[0];
    const standardRate = Number(standardRateRow?.standard_vat_rate);
    if (!Number.isFinite(standardRate) || standardRate < 0 || standardRate > 100) {
      throw new Error('إعداد نسبة ضريبة القيمة المضافة غير موجود أو غير صالح');
    }
    const filingFrequency = String(standardRateRow?.filing_frequency || '');
    if (!['monthly', 'quarterly'].includes(filingFrequency)) {
      throw new Error('إعداد دورية الإقرار الضريبي غير موجود أو غير صالح');
    }
    const periodMatchesFrequency = matchesFilingFrequency(from, to, filingFrequency);
    const [
      movement,
      salesBreakdownResult,
      legacyRevenueResult,
      salesSourceCounts,
      taxpayerProfileResult,
      purchases,
      purchaseBreakdownResult,
      unpostedPurchases,
      cancelledWithoutDate,
    ] = await Promise.all([
      vatMovement(pool, from, to, accounts),
      pool.query(
        `SELECT kind, rate::float AS rate, applicable_standard_rate::float AS applicable_standard_rate,
                        ROUND(SUM(taxable_base),2)::float AS taxable_base,
                        ROUND(SUM(vat),2)::float AS vat,
                        SUM(document_count)::int AS document_count,
                        SUM(unposted_document_count)::int AS unposted_document_count
                   FROM (
                       SELECT 'sale'::text AS kind, oi.vat_rate AS rate,
                              CASE WHEN (o.created_at AT TIME ZONE 'Asia/Riyadh')::date < DATE '2020-07-01'
                                   THEN 5.00::numeric ELSE cfg.standard_vat_rate END AS applicable_standard_rate,
                              SUM(oi.line_total) AS taxable_base, SUM(oi.vat_amount) AS vat,
                              COUNT(DISTINCT o.id) AS document_count,
                              COUNT(DISTINCT o.id) FILTER (WHERE o.status IN ('issued','reported') AND NOT EXISTS (
                                  SELECT 1 FROM journal_entries e
                                   WHERE e.source_type = 'pos_sale' AND e.source_id = o.id::text
                                     AND e.status = 'posted'
                              )) AS unposted_document_count
                         FROM pos_orders o
                         JOIN pos_order_items oi ON oi.order_id = o.id
                         CROSS JOIN tax_config cfg
                        WHERE cfg.id = 1
                          AND o.status IN ('issued','reported','cancelled')
                          AND (o.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
                        GROUP BY oi.vat_rate, applicable_standard_rate
                       UNION ALL
                       SELECT 'void'::text AS kind, oi.vat_rate AS rate,
                              CASE WHEN (o.voided_at AT TIME ZONE 'Asia/Riyadh')::date < DATE '2020-07-01'
                                   THEN 5.00::numeric ELSE cfg.standard_vat_rate END AS applicable_standard_rate,
                              SUM(oi.line_total) AS taxable_base, SUM(oi.vat_amount) AS vat,
                              COUNT(DISTINCT o.id) AS document_count,
                              COUNT(DISTINCT o.id) FILTER (WHERE NOT EXISTS (
                                  SELECT 1 FROM journal_entries e
                                   WHERE e.source_type = 'pos_void' AND e.source_id = o.id::text AND e.status = 'posted'
                              )) AS unposted_document_count
                         FROM pos_orders o
                         JOIN pos_order_items oi ON oi.order_id = o.id
                         CROSS JOIN tax_config cfg
                        WHERE cfg.id = 1 AND o.status = 'cancelled' AND o.voided_at IS NOT NULL
                          AND (o.voided_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
                        GROUP BY oi.vat_rate, applicable_standard_rate
                   ) vat_rows
                  GROUP BY kind, rate, applicable_standard_rate
                  ORDER BY kind, rate NULLS FIRST`,
        [from, to]
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(BTRIM(source),''),'(مصدر غير محدد)') AS source,
                        COUNT(*)::int AS count,
                        COALESCE(ROUND(SUM(amount),2),0)::float AS amount
                   FROM revenues
                  WHERE LEFT(COALESCE(date,''),10) BETWEEN $1 AND $2
                    AND pos_order_id IS NULL
                    AND UPPER(COALESCE(source,'')) <> 'POS_VOID'
                  GROUP BY 1
                  ORDER BY 1`,
        [from, to]
      ),
      pool.query(
        `SELECT
                    COUNT(*) FILTER (
                        WHERE o.status IN ('issued','reported')
                          AND (o.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
                          AND NOT EXISTS (
                              SELECT 1 FROM journal_entries e
                               WHERE e.source_type = 'pos_sale' AND e.source_id = o.id::text
                                 AND e.status = 'posted'
                          )
                    )::int AS unposted_sales,
                    COUNT(*) FILTER (
                        WHERE o.status = 'cancelled' AND o.voided_at IS NOT NULL
                          AND (o.voided_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
                          AND NOT EXISTS (
                              SELECT 1 FROM journal_entries e
                               WHERE e.source_type = 'pos_void' AND e.source_id = o.id::text
                                 AND e.status = 'posted'
                          )
                    )::int AS unposted_voids
                   FROM pos_orders o`,
        [from, to]
      ),
      pool.query(`SELECT seller_name, vat_number FROM zatca_settings WHERE id = 1`),
      pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(ROUND(SUM(subtotal_net),2),0)::float AS net,
                        COALESCE(ROUND(SUM(vat_total),2),0)::float AS vat
                 FROM "purchaseInvoices" p
                 WHERE LEFT(COALESCE(p.date,''),10) BETWEEN $1 AND $2
                   AND COALESCE(p."invoiceNumber",'') NOT LIKE 'OPEN-%'
                   AND COALESCE(p.notes,'') NOT LIKE 'رصيد افتتاحي%'
                   AND EXISTS (
                       SELECT 1 FROM journal_entries e
                       WHERE e.source_type = 'purchase_invoice' AND e.status = 'posted'
                         AND (e.source_id = p.id::text OR e.source_id LIKE p.id::text || ':revision:%')
                   )`,
        [from, to]
      ),
      pool.query(
        `SELECT 'purchase'::text AS kind,
                        p.tax_rate_snapshot::float AS rate,
                        CASE WHEN p.date < '2020-07-01' THEN 5.00::numeric
                             ELSE cfg.standard_vat_rate END::float AS applicable_standard_rate,
                        COUNT(*)::int AS document_count,
                        COALESCE(ROUND(SUM(p.subtotal_net),2),0)::float AS taxable_base,
                        COALESCE(ROUND(SUM(p.vat_total),2),0)::float AS vat,
                        COUNT(*) FILTER (WHERE p.supplier_tax_status_snapshot = 'REGISTERED'
                                         AND NULLIF(p.supplier_vat_number_snapshot,'') IS NULL)::int AS missing_supplier_vat_count,
                        COUNT(*) FILTER (WHERE NULLIF(p.supplier_tax_status_snapshot,'') IS NULL)::int AS missing_supplier_tax_status_count,
                        COUNT(*) FILTER (WHERE NULLIF(p.tax_rule_code_snapshot,'') IS NULL)::int AS missing_tax_rule_count
                   FROM "purchaseInvoices" p
                   CROSS JOIN tax_config cfg
                  WHERE cfg.id = 1
                    AND LEFT(COALESCE(p.date,''),10) BETWEEN $1 AND $2
                    AND COALESCE(p."invoiceNumber",'') NOT LIKE 'OPEN-%'
                    AND COALESCE(p.notes,'') NOT LIKE 'رصيد افتتاحي%'
                    AND EXISTS (
                        SELECT 1 FROM journal_entries e
                        WHERE e.source_type = 'purchase_invoice' AND e.status = 'posted'
                          AND (e.source_id = p.id::text OR e.source_id LIKE p.id::text || ':revision:%')
                    )
                  GROUP BY p.tax_rate_snapshot, applicable_standard_rate
                  ORDER BY p.tax_rate_snapshot NULLS FIRST`,
        [from, to]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n
                   FROM "purchaseInvoices" p
                  WHERE LEFT(COALESCE(p.date,''),10) BETWEEN $1 AND $2
                    AND COALESCE(p."invoiceNumber",'') NOT LIKE 'OPEN-%'
                    AND COALESCE(p.notes,'') NOT LIKE 'رصيد افتتاحي%'
                    AND NOT EXISTS (
                        SELECT 1 FROM journal_entries e
                        WHERE e.source_type = 'purchase_invoice' AND e.status = 'posted'
                          AND (e.source_id = p.id::text OR e.source_id LIKE p.id::text || ':revision:%')
                    )`,
        [from, to]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n
                   FROM pos_orders o
                  WHERE o.status = 'cancelled' AND o.voided_at IS NULL
                    AND (o.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date`,
        [from, to]
      ),
    ]);
    const [balances, openingBalances] = await Promise.all([
      vatBalances(pool, to, accounts),
      vatBalances(pool, openingAsOf, accounts),
    ]);
    const purchaseRows = purchaseBreakdownResult.rows;
    const purchaseBreakdown = normalizeVatRateRows(purchaseRows);
    const legacyRevenueBySource = legacyRevenueResult.rows.map(row => ({
      source: row.source,
      count: Number(row.count || 0),
      amount: Number(row.amount || 0),
    }));
    const legacyRevenue = {
      count: legacyRevenueBySource.reduce((sum, row) => sum + row.count, 0),
      amount: round2(legacyRevenueBySource.reduce((sum, row) => sum + row.amount, 0)),
      by_source: legacyRevenueBySource,
    };
    const salesBreakdown = normalizeVatRateRows(salesBreakdownResult.rows);
    const salesVatDifference = Math.abs(
      salesBreakdown.filter(row => row.kind === 'sale').reduce((sum, row) => sum + row.vat, 0) -
        salesBreakdown.filter(row => row.kind === 'void').reduce((sum, row) => sum + row.vat, 0) -
        (movement.output_vat - movement.output_vat_reversals)
    );
    const purchaseVatDifference = Math.abs(Number(purchases.rows[0]?.vat || 0) - movement.input_vat);
    const taxpayerVat = normalizeVat(taxpayerProfileResult.rows[0]?.vat_number);
    const missingSupplierTaxStatusCount = purchaseRows.reduce(
      (sum, row) => sum + Number(row.missing_supplier_tax_status_count || 0),
      0
    );
    const missingSupplierVatCount = purchaseRows.reduce(
      (sum, row) => sum + Number(row.missing_supplier_vat_count || 0),
      0
    );
    const missingTaxRuleCount = purchaseRows.reduce((sum, row) => sum + Number(row.missing_tax_rule_count || 0), 0);
    const missingTaxRateCount = purchaseBreakdown
      .filter(row => row.classification === 'missing_rate')
      .reduce((sum, row) => sum + row.document_count, 0);
    const unpostedPurchaseCount = Number(unpostedPurchases.rows[0]?.n || 0);
    const cancelledWithoutVoidDateCount = Number(cancelledWithoutDate.rows[0]?.n || 0);
    const unclassifiedRateCount = [...salesBreakdown, ...purchaseBreakdown]
      .filter(row => row.classification !== 'standard_rate')
      .reduce((sum, row) => sum + row.document_count, 0);
    const unclassifiedMovements = movement.unclassified_vat_movements;
    res.json({
      from,
      to,
      standard_vat_rate: standardRate,
      filing_period_validation: {
        frequency: filingFrequency,
        matches_frequency: periodMatchesFrequency,
      },
      taxpayer_profile: {
        seller_name: taxpayerProfileResult.rows[0]?.seller_name || null,
        vat_number: taxpayerVat && taxpayerVat !== ZATCA_PLACEHOLDER_VAT ? taxpayerVat : null,
        number_configured: Boolean(taxpayerVat && taxpayerVat !== ZATCA_PLACEHOLDER_VAT),
        registration_verified: false,
      },
      output_vat: movement.output_vat,
      output_vat_reversals: movement.output_vat_reversals,
      input_vat: movement.input_vat,
      input_vat_adjustments: movement.input_vat_adjustments,
      net_payable: movement.net_payable,
      carry_forward_credit: movement.carry_forward_credit,
      payable_balance: balances.payable,
      recoverable_balance: balances.recoverable,
      opening_balances: {
        as_of: openingAsOf,
        payable: openingBalances.payable,
        recoverable: openingBalances.recoverable,
      },
      unclassified_vat_movements: movement.unclassified_vat_movements,
      sales_breakdown: salesBreakdown,
      sales_source_counts: {
        unposted_sales: Number(salesSourceCounts.rows[0]?.unposted_sales || 0),
        unposted_voids: Number(salesSourceCounts.rows[0]?.unposted_voids || 0),
      },
      cancelled_without_void_date: cancelledWithoutVoidDateCount,
      legacy_revenue_crosscheck: legacyRevenue,
      filing_readiness: buildVatFilingReadiness({
        taxpayer_number_configured: Boolean(taxpayerVat && taxpayerVat !== ZATCA_PLACEHOLDER_VAT),
        period_matches_frequency: periodMatchesFrequency,
        legacy_revenue_count: legacyRevenue.count,
        nonstandard_rate_count: unclassifiedRateCount,
        unposted_sales: Number(salesSourceCounts.rows[0]?.unposted_sales || 0),
        unposted_voids: Number(salesSourceCounts.rows[0]?.unposted_voids || 0),
        unposted_purchases: unpostedPurchaseCount,
        cancelled_without_void_date: cancelledWithoutVoidDateCount,
        missing_tax_rate_count: missingTaxRateCount,
        missing_supplier_vat_count: missingSupplierVatCount,
        missing_supplier_tax_status_count: missingSupplierTaxStatusCount,
        missing_tax_rule_count: missingTaxRuleCount,
        unclassified_ledger_movement: Object.values(unclassifiedMovements).some(amount => amount > 0),
        sales_ledger_difference: salesVatDifference,
        purchase_ledger_difference: purchaseVatDifference,
      }),
      purchases_crosscheck: {
        count: Number(purchases.rows[0]?.n || 0),
        net: Number(purchases.rows[0]?.net || 0),
        vat: Number(purchases.rows[0]?.vat || 0),
        by_rate: purchaseBreakdown,
        unposted_count: unpostedPurchaseCount,
        missing_tax_rate_count: missingTaxRateCount,
        missing_supplier_vat_count: missingSupplierVatCount,
        missing_supplier_tax_status_count: missingSupplierTaxStatusCount,
        missing_tax_rule_count: missingTaxRuleCount,
      },
    });
  } catch (error) {
    logger.error('[ledger/vat-return]', error);
    res.status(500).json({ error: 'LEDGER_VAT_RETURN_FAILED', message: 'تعذر حساب الإقرار الضريبي' });
  }
});

/**
 * ترحيل تصفية الضريبة لشهر منتهٍ. preview افتراضيًا؛ الترحيل الفعلي بـapply:true.
 * يُرفض الشهر الجاري/المستقبلي (لا تصفية لفترة لم تنتهِ) والفترة المقفولة (423)،
 * والإعادة لنفس الشهر تُرجع replay ولا تُضاعف أبدًا.
 */
router.post('/vat-settlement', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const month = String(req.body?.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(422).json({ error: 'LEDGER_MONTH_INVALID', message: 'الشهر بصيغة YYYY-MM' });
    }
    const [_y, _m] = month.split('-').map(Number);
    const from = `${month}-01`;
    const to = new Date(Date.UTC(_y, _m, 0)).toISOString().slice(0, 10);
    if (to > riyadhToday()) {
      return res.status(422).json({ error: 'LEDGER_VAT_PERIOD_OPEN', message: 'لا تُصفّى فترة لم تنتهِ بعد' });
    }
    const apply = req.body?.apply === true;
    const accounts = await resolveAccounts(pool, 'tax', 'vat_return', {
      payable_account: '2100',
      recoverable_account: '1150',
    });
    const movement = await vatMovement(pool, from, to, accounts);
    const balances = await vatBalances(pool, to, accounts);
    const plan = buildVatSettlementPlan({
      payableBalance: balances.payable,
      recoverableBalance: balances.recoverable,
      accounts,
    });
    // قيد التصفية الموجود لهذا الشهر يُعلَن قبل أي اختصار: بعد الترحيل تصير
    // الأرصدة 0/متبقٍ، فكانت الإعادة تُرجع nothing_to_clear بدل حقيقة «مُصفّى».
    const existing =
      (
        await pool.query(
          `SELECT id, entry_no, date::text AS date, status FROM journal_entries
              WHERE source_type = 'vat_settlement' AND source_id = $1
              ORDER BY id DESC LIMIT 1`,
          [month]
        )
      ).rows[0] || null;
    const base = {
      month,
      from,
      to,
      output_vat: movement.output_vat,
      input_vat: movement.input_vat,
      net_payable: movement.net_payable,
      payable_balance: balances.payable,
      recoverable_balance: balances.recoverable,
      clearing: plan.clearing,
      net_payable_after: plan.net_payable_after,
      carry_forward_after: plan.carry_forward_after,
      lines: plan.lines,
      settled: existing ? { entry_no: existing.entry_no, date: existing.date, status: existing.status } : null,
    };
    if (!apply) {
      return res.json({ ...base, applied: false, preview: true });
    }
    if (existing) {
      return res.status(409).json({
        ...base,
        applied: false,
        error: 'LEDGER_DUPLICATE',
        message: `تصفية ${month} مُرحّلة مسبقًا`,
        entry: existing,
      });
    }
    if (!(plan.clearing > 0)) {
      return res.json({ ...base, applied: false, skipped: 'nothing_to_clear' });
    }
    const out = await postJournal(pool, {
      date: to,
      memo: `تصفية ضريبة القيمة المضافة — ${month}`,
      source_type: 'vat_settlement',
      source_id: month,
      lines: plan.lines,
      created_by: req.user?.id || null,
    });
    if (out.replay) {
      return res.status(409).json({
        ...base,
        applied: false,
        error: 'LEDGER_DUPLICATE',
        message: `تصفية ${month} مُرحّلة مسبقًا`,
        entry: out.entry,
      });
    }
    logger.info(`[LEDGER] تصفية ضريبة ${month}: ${plan.clearing} → قيد ${out.entry.entry_no}`);
    res.status(201).json({
      ...base,
      settled: { entry_no: out.entry.entry_no, date: to, status: out.entry.status || 'posted' },
      applied: true,
      entry: out.entry,
    });
  } catch (error) {
    if (error.statusCode === 423) {
      return res.status(423).json({ error: 'PERIOD_CLOSED', message: error.message });
    }
    logger.error('[ledger/vat-settlement]', error);
    res.status(500).json({ error: 'LEDGER_VAT_SETTLEMENT_FAILED', message: 'تعذر ترحيل تصفية الضريبة' });
  }
});

// ─── شجرة الحسابات ───────────────────────────────────────────────────────────
router.get('/chart', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT code, name_ar, name_en, type, parent_code, is_postable, is_active
             FROM chart_of_accounts ORDER BY code`
    );
    res.json(rows);
  } catch (error) {
    logger.error('[ledger/chart]', error);
    res.status(500).json({ error: 'LEDGER_CHART_FAILED', message: 'تعذر جلب شجرة الحسابات' });
  }
});

router.post('/chart', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const code = String(req.body?.code || '')
      .trim()
      .slice(0, 20);
    const name_ar = String(req.body?.name_ar || '')
      .trim()
      .slice(0, 255);
    const name_en = req.body?.name_en ? String(req.body.name_en).trim().slice(0, 255) : null;
    const type = String(req.body?.type || '').trim();
    const parent_code = req.body?.parent_code ? String(req.body.parent_code).trim().slice(0, 20) : null;
    if (!code || !name_ar) {
      return res.status(422).json({ error: 'LEDGER_ACCOUNT_INVALID', message: 'الكود والاسم العربي مطلوبان' });
    }
    if (!['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'].includes(type)) {
      return res.status(422).json({ error: 'LEDGER_TYPE_INVALID', message: 'نوع الحساب غير صالح' });
    }
    if (parent_code) {
      const p = await pool.query('SELECT code, type FROM chart_of_accounts WHERE code = $1 LIMIT 1', [parent_code]);
      if (!p.rows[0]) {
        return res.status(422).json({ error: 'LEDGER_PARENT_NOT_FOUND', message: 'الحساب الأب غير موجود' });
      }
      if (p.rows[0].type !== type) {
        return res.status(422).json({ error: 'LEDGER_PARENT_TYPE', message: 'نوع الأب يجب أن يطابق نوع الحساب' });
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO chart_of_accounts (id, code, name_ar, name_en, type, parent_code, is_postable)
             VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true)) RETURNING *`,
      [uid(), code, name_ar, name_en, type, parent_code, req.body?.is_postable]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'LEDGER_CODE_EXISTS', message: 'كود الحساب موجود بالفعل' });
    }
    logger.error('[ledger/chart:create]', error);
    res.status(500).json({ error: 'LEDGER_ACCOUNT_CREATE_FAILED', message: 'تعذر إنشاء الحساب' });
  }
});

// ─── ميزان المراجعة ──────────────────────────────────────────────────────────
router.get('/trial-balance', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
  try {
    const from = String(req.query.from || '2000-01-01').slice(0, 10);
    const to = String(req.query.to || '2100-12-31').slice(0, 10);
    const { rows } = await pool.query(
      `SELECT c.code, c.name_ar, c.name_en, c.type,
                    COALESCE(SUM(l.debit),0)::numeric(14,2) AS debit,
                    COALESCE(SUM(l.credit),0)::numeric(14,2) AS credit
             FROM chart_of_accounts c
             LEFT JOIN journal_lines l ON l.account_code = c.code
                 AND EXISTS (SELECT 1 FROM journal_entries e
                             WHERE e.id = l.entry_id AND e.status = 'posted'
                               AND e.date >= $1 AND e.date <= $2)
             GROUP BY c.code, c.name_ar, c.name_en, c.type
             ORDER BY c.code`,
      [from, to]
    );
    const integrityResult = await pool.query(
      `SELECT COUNT(*)::int AS unbalanced_posted_entries
             FROM (
                 SELECT e.id
                 FROM journal_entries e
                 LEFT JOIN journal_lines l ON l.entry_id = e.id
                 WHERE e.status = 'posted' AND e.date >= $1 AND e.date <= $2
                 GROUP BY e.id
                 HAVING COUNT(l.entry_id) < 2
                     OR ABS(COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)) > 0.01
             ) unbalanced`,
      [from, to]
    );
    const tDr = round2(rows.reduce((s, r) => s + Number(r.debit), 0));
    const tCr = round2(rows.reduce((s, r) => s + Number(r.credit), 0));
    const unbalancedEntries = Number(integrityResult.rows[0]?.unbalanced_posted_entries ?? 0);
    res.json({
      from,
      to,
      accounts: rows,
      total_debit: tDr,
      total_credit: tCr,
      balanced: Math.abs(tDr - tCr) <= 0.01 && unbalancedEntries === 0,
      integrity: { unbalanced_posted_entries: unbalancedEntries },
    });
  } catch (error) {
    logger.error('[ledger/trial-balance]', error);
    res.status(500).json({ error: 'LEDGER_TB_FAILED', message: 'تعذر حساب ميزان المراجعة' });
  }
});

// ─── القوائم المالية الرسمية المستخرجة من الأستاذ العام (Single Source of Truth) ───
router.get('/balance-sheet', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
  try {
    const { generateBalanceSheet } = require('./financial-statements-engine');
    const asOf = req.query.as_of ? String(req.query.as_of).slice(0, 10) : null;
    const bs = await generateBalanceSheet(pool, asOf);
    res.json(bs);
  } catch (error) {
    logger.error('[ledger/balance-sheet]', error);
    res.status(500).json({ error: 'LEDGER_BS_FAILED', message: 'تعذر استخراج قائمة المركز المالي' });
  }
});

router.get('/income-statement', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
  try {
    const { generateIncomeStatement } = require('./financial-statements-engine');
    const from = req.query.from ? String(req.query.from).slice(0, 10) : null;
    const to = req.query.to ? String(req.query.to).slice(0, 10) : null;
    const is = await generateIncomeStatement(pool, from, to);
    res.json(is);
  } catch (error) {
    logger.error('[ledger/income-statement]', error);
    res.status(500).json({ error: 'LEDGER_IS_FAILED', message: 'تعذر استخراج قائمة الدخل' });
  }
});

// ─── دفتر القيود ─────────────────────────────────────────────────────────────
router.get('/journal', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const { rows } = await pool.query(
      `SELECT e.*, u.username AS created_by_name,
                    COALESCE(json_agg(json_build_object('account_code', l.account_code, 'debit', l.debit, 'credit', l.credit, 'memo', l.memo)
                ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
             FROM journal_entries e
             LEFT JOIN journal_lines l ON l.entry_id = e.id
             LEFT JOIN users u ON u.id = e.created_by
             GROUP BY e.id, u.username ORDER BY e.date DESC, e.id DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (error) {
    logger.error('[ledger/journal]', error);
    res.status(500).json({ error: 'LEDGER_JOURNAL_FAILED', message: 'تعذر جلب القيود' });
  }
});

router.post('/journal', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const out = await postJournal(pool, {
      date: req.body?.date,
      memo: req.body?.memo,
      source_type: 'manual',
      source_id: req.body?.source_id || null,
      lines: req.body?.lines,
      created_by: req.user?.id || null,
      status: req.body?.status === 'draft' ? 'draft' : 'posted',
      // مسار بشري صريح: إن كان المرجع محجوزًا بقيد مُبطَل (خارج الأستاذ)
      // تُرحَّل نسخة منقّحة بمرجع `#rN` بدل 409 أبدي لا يشفع له أحد.
      repostVoided: true,
    });
    if (out.replay) {
      return res
        .status(409)
        .json({ error: 'LEDGER_DUPLICATE', message: 'قيد بنفس المرجع موجود مسبقًا', entry: out.entry });
    }
    res.status(201).json({ entry: out.entry, lines: out.lines });
  } catch (error) {
    const code = error.statusCode || 500;
    res
      .status(code)
      .json({ error: code === 422 ? 'LEDGER_ENTRY_INVALID' : 'LEDGER_ENTRY_FAILED', message: code === 422 ? error.message : 'حدث خطأ داخلي — يرجى المحاولة مرة أخرى' });
  }
});

// ─── إلغاء قيد (يُبقي الأثر للمراجعة — يُستبعد من الميزان) ────────────────────
router.post('/journal/:id/void', jwtAuth, requireRole(...WRITE_ROLES), crudLimiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(422).json({ error: 'LEDGER_ID_INVALID', message: 'معرف القيد غير صالح' });
    }
    const cur = (await pool.query('SELECT date FROM journal_entries WHERE id = $1', [id])).rows[0];
    if (!cur) {
      return res.status(404).json({ error: 'LEDGER_ENTRY_NOT_FOUND', message: 'القيد غير موجود' });
    }
    try {
      await require('./accounting-periods').assertPeriodOpen(cur.date);
    } catch (pe) {
      return res.status(423).json({ error: 'PERIOD_LOCKED', message: pe.message });
    }
    const { voidJournalById } = require('./journal-void');
    const out = await voidJournalById(pool, {
      entryId: id,
      reason: req.body?.reason,
      actor: req.user?.username,
      actorUserId: req.user?.id,
    });
    const rows = out.voided ? [out.entry] : [];
    if (!rows[0]) {
      return res.status(404).json({ error: 'LEDGER_ENTRY_NOT_FOUND', message: 'القيد غير موجود أو ملغي مسبقًا' });
    }
    logger.info(`[LEDGER] أُلغي القيد ${rows[0].entry_no} بواسطة ${req.user.username}`);
    if (req.io) {
      req.io.emit('entity_changed', {
        entity: 'journal',
        action: 'update',
        data: rows[0],
        changedBy: req.user.username,
      });
    }
    res.json({ ok: true, entry: rows[0] });
  } catch (error) {
    logger.error('[ledger/void]', error);
    res.status(500).json({ error: 'LEDGER_VOID_FAILED', message: 'تعذر إلغاء القيد' });
  }
});

// ─── ترحيل رواتب شهر ─────────────────────────────────────────────────────────
router.post('/post-payroll', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const month = String(req.body?.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(422).json({ error: 'LEDGER_MONTH_INVALID', message: 'الشهر بصيغة YYYY-MM' });
    }
    const total = (
      await pool.query(
        `SELECT COALESCE(SUM("netSalary"),0)::numeric(14,2) AS t, COUNT(*)::int AS n FROM payroll
             WHERE ("month" = $1 OR ("year" || '-' || LPAD("month"::text,2,'0')) = $1) AND status <> 'cancelled'`,
        [month]
      )
    ).rows[0];
    if (!total || Number(total.t) <= 0) {
      return res.status(422).json({ error: 'LEDGER_PAYROLL_EMPTY', message: 'لا رواتب مستحقة لهذا الشهر' });
    }
    // ROOT FIX 2026-10-02: التاريخ كان ثابتًا على 28 — يُحسب الآن آخر يوم
    // فعلي لشهر الرواتب (يبقى داخل الفترة المالية للشهر نفسه).
    const [_py, _pm] = month.split('-').map(Number);
    const monthEndDate = new Date(Date.UTC(_py, _pm, 0)).toISOString().slice(0, 10);
    const accounts = await resolveAccounts(pool, 'payroll', 'payroll_run', {
      expense_account: '6000',
      payable_account: '2200',
    });
    const out = await postJournal(pool, {
      date: monthEndDate,
      memo: `ترحيل رواتب شهر ${month} (${total.n} موظف)`,
      source_type: 'payroll',
      source_id: month,
      lines: [
        { account_code: accounts.expense_account, debit: Number(total.t), credit: 0, memo: `رواتب ${month}` },
        { account_code: accounts.payable_account, debit: 0, credit: Number(total.t), memo: `رواتب مستحقة ${month}` },
      ],
      created_by: req.user?.id || null,
    });
    if (out.replay) {
      return res
        .status(409)
        .json({ error: 'LEDGER_DUPLICATE', message: `رواتب ${month} مُرحّلة مسبقًا`, entry: out.entry });
    }
    res.status(201).json({ entry: out.entry, total: Number(total.t), count: Number(total.n) });
  } catch (error) {
    const code = error.statusCode || 500;
    res.status(code).json({ error: 'LEDGER_PAYROLL_FAILED', message: error.message });
  }
});

// ─── ملخص المدير المالي ──────────────────────────────────────────────────────
// الأساس الموحّد (قرار المالك 2026-10-24): كل رقم هنا تُنتجه نفس دالة قائمة
// الدخل (loadPnlInputs + buildPnlStatement) — فلا يختلف رقم على اللوحة عن الرقم
// في تقرير «قائمة الدخل» لنفس الفترة. الكتلة reconciliation تربط الدفتر بمرآة
// الكاشير يومًا بيوم؛ المرآة تُقرأ هنا فقط ولا تُكتب منها ولا عليها.
router.get('/cfo-summary', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
  try {
    const from = String(req.query.from || `${riyadhMonth()}-01`).slice(0, 10);
    const to = String(req.query.to || riyadhToday()).slice(0, 10);
    const q = async (sql, p) => (await pool.query(sql, p)).rows[0];
    const { loadPnlInputs, buildPnlStatement } = require('./finance-routes');
    const pnl = buildPnlStatement({ ...(await loadPnlInputs(from, to)), fromDay: from, toDay: to });
    // حسابات اللوحة من الخريطة (reports.cfo_summary)؛ الافتراضي هو الثوابت نفسها.
    const cfo = await resolveAccounts(pool, 'reports', 'cfo_summary', {
      cash_account: '1000',
      bank_account: '1010',
      revenue_account: '4000',
    });
    const openingEquity = await getMappedAccount(pool, 'yarasoft', 'prebooks', 'equity_account');

    const cash = await q(
      `SELECT
                COALESCE(SUM(CASE WHEN l.account_code = $1 THEN l.debit - l.credit ELSE 0 END),0)::numeric(14,2) AS petty,
                COALESCE(SUM(CASE WHEN l.account_code = $2 THEN l.debit - l.credit ELSE 0 END),0)::numeric(14,2) AS bank
            FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'`,
      [cfo.cash_account, cfo.bank_account]
    );
    const journalPeriod = await q(
      `SELECT COUNT(*)::int AS n FROM journal_entries WHERE status = 'posted' AND date >= $1::date AND date <= $2::date`,
      [from, to]
    );
    const journalAll = await q(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE status = 'posted'`, []);

    // ─── تسوية الدفتر مع مرآة الكاشير (من يوم التحول فقط) ───
    const cutover = bridgeCutover();
    const mirror = await q(
      `SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS total, COUNT(*)::int AS n,
                    COALESCE(SUM(amount) FILTER (WHERE "deptId" = 'ys_b4_ext'),0)::numeric(14,2) AS ext_total,
                    COUNT(*) FILTER (WHERE "deptId" = 'ys_b4_ext')::int AS ext_n
                FROM revenues
               WHERE amount > 0 AND LEFT(date, 10) >= $1 AND LEFT(date, 10) <= $2 AND LEFT(date, 10) >= $3`,
      [from, to, cutover]
    );
    const booked = await q(
      `SELECT COALESCE(SUM(l.credit),0)::numeric(14,2) AS total, COUNT(*)::int AS n
                FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
               WHERE e.source_type = $3 AND l.account_code = $4 AND e.date >= $1::date AND e.date <= $2::date`,
      [from, to, YARA_REVENUE_SOURCE, cfo.revenue_account]
    );
    const unposted = await q(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(r.amount),0)::numeric(14,2) AS total
                FROM revenues r
               WHERE r.amount > 0 AND LEFT(r.date, 10) >= $1 AND LEFT(r.date, 10) <= $2 AND LEFT(r.date, 10) >= $3
                 AND NOT EXISTS (SELECT 1 FROM journal_entries je
                                  WHERE je.source_type = $4
                                    AND (je.source_id = r.external_ref
                                         OR je.source_id = ('id:' || CAST(r.id AS TEXT))
                                         OR je.source_id = CAST(r.id AS TEXT)))`,
      [from, to, cutover, YARA_REVENUE_SOURCE]
    );
    const voided = await q(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(l.credit),0)::numeric(14,2) AS total
                FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'void'
               WHERE e.source_type = $3 AND l.account_code = $4 AND e.date >= $1::date AND e.date <= $2::date`,
      [from, to, YARA_REVENUE_SOURCE, cfo.revenue_account]
    );
    const opening = await q(
      `SELECT COALESCE(SUM(l.credit),0)::numeric(14,2) AS total, COUNT(*)::int AS n, MAX(e.date) AS as_of
                FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
               WHERE e.source_type = $1 AND l.account_code = $2`,
      [YARA_PREBOOK_SOURCE, openingEquity]
    );
    const difference = round2(Number(mirror.total) - Number(booked.total));
    const reconciled = Math.abs(difference) <= 0.01 && Number(unposted.n) === 0;

    res.json({
      from,
      to,
      revenue: {
        total: pnl.revenue.total,
        count: pnl.revenue.invoice_count + pnl.revenue.manual_count,
        pos_net: pnl.revenue.pos_net,
        manual: pnl.revenue.manual,
        pos_gross: pnl.revenue.pos_gross,
        vat_collected: pnl.revenue.vat_collected,
        pos_discounts: pnl.revenue.pos_discounts,
      },
      expenses: { total: pnl.operating.total, count: pnl.operating.count },
      cogs: pnl.cogs,
      shrinkage: pnl.shrinkage,
      // حركات مخزون داخلية استُبعدت من المصروفات — مرقمة لا مُخفاة
      inventory_moves: pnl.internal_moves,
      payroll_open: pnl.payroll.total,
      pos: { invoices: pnl.revenue.invoice_count, total: pnl.revenue.pos_gross },
      cash_position: round2(Number(cash.petty) + Number(cash.bank)),
      cash_ledger: { petty_cash: Number(cash.petty), bank: Number(cash.bank) },
      journal_entries: Number(journalPeriod.n),
      journal_entries_all_time: Number(journalAll.n),
      gross_profit: pnl.gross_profit,
      net_profit: pnl.net_profit,
      // alias قديم للوحة التقليدية — صار الرقم نفسه لا تقديرًا
      net_approx: pnl.net_profit.amount,
      top_expense_categories: pnl.operating.items.slice(0, 5).map(i => ({ category: i.category, total: i.amount })),
      revenue_by_dept: pnl.by_department
        .slice(0, 8)
        .map(d => ({ code: d.code, name: d.name, total: d.revenue, net: d.net, margin_pct: d.margin_pct })),
      daily_series: pnl.daily_series,
      reconciliation: {
        status: reconciled ? 'متوافق' : 'غير متوافق',
        cutover,
        mirror_revenue: Number(mirror.total),
        mirror_rows: Number(mirror.n),
        ledger_revenue: Number(booked.total),
        ledger_entries: Number(booked.n),
        difference,
        unposted_rows: Number(unposted.n),
        unposted_amount: Number(unposted.total),
        voided_duplicates: Number(voided.n),
        voided_amount: Number(voided.total),
        pre_book_opening: Number(opening.total),
        pre_book_months: Number(opening.n),
        external_revenue: Number(mirror.ext_total),
        external_revenue_rows: Number(mirror.ext_n),
        note: 'الإيراد في الدفتر يغطي كل مرآة الكاشير؛ قائمة الدخل تستثني البيع الخارجي (ys_b4_ext) بأمر المالك 2026-10-21.',
      },
      basis: {
        revenue: 'قائمة الدخل: صافي الكاشير (بلا ضريبة/خصم) + إيراد يدوي — بلا بيع خارجي',
        expenses: 'التصنيف التشغيلي الموحد: استبعاد التكلفة وفروق الجرد وحركات المخزون الداخلية',
        payroll: 'مسير الشهر موزّنًا تناسبيًا على أيام الفترة',
        ledger: 'القيود المرحّلة فقط (status=posted) — الملغاة لا تدخل أي رقم',
        cash: 'رصيد الدفتر التراكمي للصندوق والبنك',
      },
    });
  } catch (error) {
    logger.error('[ledger/cfo-summary]', error);
    res.status(500).json({ error: 'LEDGER_CFO_FAILED', message: 'تعذر حساب ملخص المدير المالي' });
  }
});

/** عكس اعتماد مخزن أُعيد — منقولة من نسخة الإنتاج للحفاظ على واجهتها */
async function postDispatchReopenToLedger(dispatchId, reopenId, { totalValue, date, deptCode } = {}, db = pool) {
    const v = round2(totalValue);
    if (!(v > 0)) {return { skipped: 'zero_total' };}
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '').slice(0, 10))
        ? String(date).slice(0, 10) : riyadhToday();
    if (deptCode) {await ensureCostCenters([deptCode]);}
    const accounts = await resolveAccounts(db, 'inventory', 'stock_return', {
        cogs_account: '5000',
        inventory_account: '1200',
    });
    const out = await postJournal(db, {
        date: day,
        memo: `إرجاع اعتماد مخزن — إذن #${dispatchId}${deptCode ? ` (${deptCode})` : ''}`,
        source_type: 'dispatch_reopen',
        source_id: String(reopenId),
        lines: buildStockMoveLines(v, 'in', deptCode || null, accounts),
    });
    logger.info(`[LEDGER] إرجاع اعتماد الصرف #${dispatchId}: ${out.replay ? 'مُرحّل مسبقًا' : `قيد ${out.entry.entry_no}`}`);
    return out;
}

module.exports = {
  router,
  postJournal,
  postSaleToLedger,
  buildSalePostingLines,
  postPurchaseToLedger,
  postOpeningToLedger,
  postDispatchToLedger,
    postDispatchReopenToLedger,
  postReturnToLedger,
  buildStockMoveLines,
  buildVatSettlementPlan,
  normalizeCostCenterCode,
  ensureCostCenters,
  resetCcCache: () => {
    _ccReady = null;
  },
};
