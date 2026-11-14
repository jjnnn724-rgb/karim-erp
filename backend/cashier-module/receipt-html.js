/**
 * receipt-html.js — قالب الفاتورة الواحد (80mm) الذي تقرأه الشاشة ويُطبع.
 * ────────────────────────────────────────────────────────────────────────────
 * قبل هذا الملف كان عرض الفاتورة على الشاشة صفوفًا نصية بلا أصناف، والنسخة
 * المطبوعة قالبًا ثانيًا منفصلًا — فأي تعديل يصلح واحدة ويترك الأخرى. هنا
 * مصدر واحد: نفس HTML يُعرض داخل نافذة «تم البيع» ويُطبع من المتصفح مباشرة.
 *
 * القواعد:
 *   · لا سكربتات ولا موارد خارجية — الصور QR مضمّنة كـ data URL، فالملف
 *     يُكتب في نافذة فارغة أو iframe بلا تحميل إضافي.
 *   · أحجام بخطوط نظامية مع أرقام جدولية (tabular-nums) حتى تصطف الأعمدة.
 *   · اللون الذهبي للمطاعم هو الهوية؛ الطباعة بالأبيض والأسود تبقى مقروءة.
 */

'use strict';

const { assertBalanced } = require('./vat-engine');

const METHOD_LABELS = {
    cash: 'نقدي',
    card: 'شبكة / بطاقة',
    wallet: 'محفظة',
    bank_transfer: 'تحويل بنكي',
    voucher: 'قسيمة',
    loyalty: 'نقاط ولاء',
};

/** @param {*} value — أي قيمة تُحوَّل إلى نص ويُهرَّب منها HTML */
function escHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * @param {*} value المبلغ
 * @param {string} [currency] رمز العملة
 */
function money(value, currency = 'ر.س') {
    const n = Number(value);
    const text = Number.isFinite(n) ? n.toFixed(2) : '0.00';
    return `${text} <span class="cur">${escHtml(currency)}</span>`;
}

/** @param {string} method مفتاح طريقة الدفع */
function methodLabel(method) {
    return METHOD_LABELS[/** @type {keyof typeof METHOD_LABELS} */ (method)] || String(method || '');
}

/** @param {string|null|undefined} status حالة الأوردر */
function isVoidStatus(status) {
    return status === 'cancelled' || status === 'voided';
}

/**
 * @param {{ items: any[], isBuffet?: boolean }} opts
 * @returns {string}
 */
function buildItemsSection({ items, isBuffet }) {
    if (isBuffet) {
        const personsTotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
        return `
<div class="buffet-banner">البوفيه المفتوح — الفوترة بعدد الأشخاص</div>
<table class="buffet-persons">
  <thead><tr><th>الفئة</th><th class="c">الأشخاص</th><th class="c">سعر الفرد</th><th class="t">المجموع</th></tr></thead>
  <tbody>
  ${items.map((it) => `
    <tr>
      <td>${escHtml(it.product_name)}</td>
      <td class="c">${Number(it.quantity)}</td>
      <td class="c">${Number(it.unit_price) > 0 ? Number(it.unit_price).toFixed(2) : 'ضيافة'}</td>
      <td class="t">${Number(it.line_total).toFixed(2)}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="persons-total"><span>إجمالي عدد الأشخاص</span><strong>${personsTotal} فرد</strong></div>`;
    }
    return `
<table class="items">
  <thead><tr><th class="item">الصنف / Item</th><th class="qty">الكمية</th><th class="price">السعر</th><th class="total">الإجمالي</th></tr></thead>
  <tbody>
  ${items.map((it) => {
      const nameAr = String(it.product_name ?? '');
      const nameEn = String(it.name_en ?? '').trim();
      return `
    <tr>
      <td class="item"><span class="item-ar">${escHtml(nameAr)}</span>${nameEn ? `<span class="item-en" dir="ltr">${escHtml(nameEn)}</span>` : ''}${Number(it.discount) > 0 ? '<span class="line-disc">خصم السطر</span>' : ''}</td>
      <td class="qty">${Number(it.quantity)}</td>
      <td class="price">${Number(it.unit_price).toFixed(2)}</td>
      <td class="total">${Number(it.line_total).toFixed(2)}</td>
    </tr>`;
  }).join('')}
  </tbody>
</table>`;
}

/**
 * @param {*} label عنوان السطر
 * @param {*} value القيمة (تُفترَض مُهرَّبة من النداء)
 * @returns {string}
 */
function metaRow(label, value) {
    return `<div class="m-row"><span class="m-label">${escHtml(label)}</span><span class="m-value">${value}</span></div>`;
}

/**
 * @param {object} [opts]
 * @param {*} [opts.order] صف الأوردر (أعمدته مرنة من القاعدة)
 * @param {any[]} [opts.items] أسطر الأصناف
 * @param {any[]} [opts.payments] سجل الدفعات
 * @param {string|null} [opts.qrImageDataUrl] صورة QR مضمّنة
 * @param {boolean} [opts.isBuffet] فوترة بوفيه
 * @returns {string}
 */
function buildReceiptHtml({ order = {}, items = [], payments = [], qrImageDataUrl = null, isBuffet = false } = {}) {
    // ── Never print an unbalanced invoice ────────────────────────────────────
    // Printing net/vat/total that do not add up is a compliance failure and it
    // used to be "fixed" by printing a "تسوية" line, which is now forbidden.
    // Legacy rows are parked here; accounting must correct them first.
    assertBalanced({
        subtotal: order.subtotal,
        tax_total: order.tax_total,
        total_amount: order.total_amount,
        line_items: items,
    }, { phase: 'receipt-print', order_id: order.id || null });

    const currency = order.currency_code || 'SAR';
    const currencyLabel = currency === 'SAR' ? 'ر.س' : currency;
    const date = new Date(order.created_at || Date.now()).toLocaleString('ar-SA-u-ca-gregory', {
        timeZone: 'Asia/Riyadh',
        dateStyle: 'medium',
        timeStyle: 'short',
    });
    const voided = isVoidStatus(order.status);
    const sellerName = String(order.seller_name ?? order.department_name ?? 'مطاعم الشرفه العالمي').trim();
    const sellerEn = String(order.department_name_en ?? '').trim();
    const branchName = String(order.branch_name ?? '').trim();
    const sellerAddress = String(order.seller_address ?? order.location ?? '').trim();
    const crn = String(order.crn ?? '').trim();
    const shopVat = String(order.vat_number ?? '').trim();

    const inPayments = payments.filter((p) => p.direction !== 'out');
    const changeGiven = payments
        .filter((p) => p.direction === 'out' && p.payer_info && p.payer_info.reason === 'change')
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const paidIn = inPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const distinctVatRates = [...new Set(items.map((it) => Number(it.vat_rate)).filter((v) => Number.isFinite(v) && v > 0))];
    const vatLabel = distinctVatRates.length === 1 ? `ضريبة القيمة المضافة (${distinctVatRates[0]}%)` : 'ضريبة القيمة المضافة';

    const itemsHtml = items.length ? buildItemsSection({ items, isBuffet }) : '';

    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>فاتورة رقم ${escHtml(order.invoice_counter)}</title>
<style>
  :root {
    /* أحادي بالكامل: الطابعة الحرارية أبيض/أسود — والمعاينة = نفس المطبوعة */
    --accent: #000000;
    --accent-deep: #000000;
    --accent-soft: #f1f1f1;
    --accent-pale: #fafafa;
    --ink: #000000;
    --ink-soft: #4a4a4a;
    --line: #b5b5b5;
    --line-soft: #dcdcdc;
    --crimson: #000000;
    --emerald: #000000;
    --cream: #ffffff;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: var(--cream); }
  body {
    font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    color: var(--ink);
    font-size: 13px;
    line-height: 1.6;
    max-width: 80mm;
    margin: 0 auto;
    padding: 7mm 5mm 7mm;
    font-variant-numeric: tabular-nums;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .cur { font-size: 9px; color: var(--ink-soft); }

  /* ═══ الترويسة — إطار ذهبي مزدوج ═══════════════════════════════════════════ */
  .rule.double { border: none; border-top: 3px double var(--accent); margin: 4px 0 6px; }
  .rule.thin { border: none; border-top: 1px solid var(--line); margin: 5px 0; }
  .rule.solid { border-top: 1.6px solid var(--accent-deep); }

  .inv-strip {
    display: flex; align-items: center; justify-content: center; gap: 7mm;
    background: #ffffff; color: #000000;
    border: 1.8px solid #000000; border-radius: 4px;
    padding: 3mm 4mm; margin: 5px 0 7px;
  }
  .inv-strip .lbl { font-size: 9px; font-weight: 800; letter-spacing: 1.4px; opacity: .92; }
  .inv-strip .num { font-size: 24px; font-weight: 900; letter-spacing: .5px; line-height: 1; }

  .item-ar { display: block; font-weight: 700; }
  .item-en { display: block; font-size: 7.5px; color: var(--ink-soft); letter-spacing: .3px; margin-top: 1px; }

  .brand { text-align: center; padding: 2px 0 8px; }
  .brand-mark {
    display: inline-flex; align-items: center; justify-content: center;
    width: 74px; height: 74px; border: 1.5px solid var(--accent);
    border-radius: 50%; outline: 3.5px double var(--accent-deep); outline-offset: 4px;
    background: var(--accent-pale);
  }
  .brand-logo {
    width: 58px; height: 58px; object-fit: contain;
  }
  .brand h1 { font-size: 18px; font-weight: 900; margin-top: 10px; letter-spacing: 0; line-height: 1.3; }
  .brand .en {
    font-size: 10px; color: var(--accent-deep); letter-spacing: 2px;
    text-transform: uppercase; margin-top: 3px; font-weight: 800;
  }
  .doc-type {
    display: inline-block; margin-top: 7px; padding: 4px 16px 5px;
    border: 1.8px solid var(--accent-deep); border-radius: 999px;
    color: var(--accent-deep); font-size: 10.5px; font-weight: 800;
    letter-spacing: .5px; background: var(--accent-soft);
  }
  .doc-type small { display: block; font-size: 7px; font-weight: 700; letter-spacing: 1.4px; opacity: .85; }
  .seller-panel {
    margin: 0 0 6px; padding: 7px 9px 8px;
    border: 1px solid var(--line); border-radius: 10px;
    background: #ffffff;
  }
  .sp-title {
    font-size: 7.5px; font-weight: 800; letter-spacing: 1.2px;
    color: var(--accent-deep); text-transform: uppercase;
    border-block-end: 1px solid var(--line-soft); padding-block-end: 3px; margin-block-end: 5px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .sp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; }
  .sp-item { display: flex; flex-direction: column; gap: 0.5px; min-inline-size: 0; }
  .sp-item.sp-full { grid-column: 1 / -1; }
  .sp-label { font-size: 7.5px; color: var(--ink-soft); letter-spacing: .3px; }
  .sp-value { font-size: 9.5px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
  .sp-value.ltr { direction: ltr; text-align: right; font-variant-numeric: tabular-nums; letter-spacing: .4px; }

  /* ═══ لوحة بيانات الفاتورة ═════════════════════════════════════════════════ */
  .meta-panel {
    margin: 9px 0 7px; padding: 7px 10px;
    background: var(--accent-pale);
    border: 1px solid var(--line-soft);
    border-inline-start: 3.5px solid var(--accent);
    border-radius: 9px;
  }
  .m-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 11.5px; padding: 2px 0; }
  .m-label { color: var(--ink-soft); font-size: 9px; letter-spacing: .3px; }
  .m-value { font-weight: 800; text-align: left; direction: ltr; font-size: 11px; }
  .m-value.rtl { direction: rtl; }
  .uuid { font-size: 8px; color: #6f6f6f; letter-spacing: .4px; font-family: 'IBM Plex Mono', Consolas, monospace; }

  /* ═══ جدول الأصناف ════════════════════════════════════════════════════════ */
  table { width: 100%; border-collapse: collapse; }
  .items th {
    font-size: 9.5px; font-weight: 800; color: #000; background: #ffffff;
    border-bottom: 1.6px solid #000;
    padding: 6px 5px; text-align: right; letter-spacing: .5px;
  }
  .items th.qty, .items td.qty { width: 11%; text-align: center; }
  .items th.price, .items td.price { width: 19%; text-align: center; }
  .items th.total, .items td.total { width: 24%; text-align: left; }
  .items td { padding: 6px 5px; border-bottom: 1px solid var(--line-soft); font-size: 12px; vertical-align: top; }
  .items tbody tr:nth-child(even) td { background: var(--accent-pale); }
  .items tr:last-child td { border-bottom: none; }
  .items td.item { font-weight: 700; }
  .line-disc { display: block; font-size: 8.5px; font-weight: 600; color: var(--crimson); }

  .buffet-banner {
    text-align: center; font-weight: 800; font-size: 11.5px; color: #000;
    background: #ffffff; border: 1.4px solid #000; border-radius: 4px;
    padding: 6px; margin-bottom: 6px; letter-spacing: .2px;
  }
  .buffet-persons th, .buffet-persons td { padding: 4px 4px; border-bottom: 1px solid var(--line-soft); font-size: 11px; text-align: right; }
  .buffet-persons th { background: #ffffff; color: #000; border-bottom: 1.4px solid #000; font-size: 8.5px; font-weight: 800; letter-spacing: .4px; }
  .buffet-persons .c { text-align: center; }
  .buffet-persons .t { text-align: left; font-weight: 700; }
  .persons-total {
    display: flex; justify-content: space-between; margin-top: 6px;
    background: #f1f1f1; border: 1px solid #000; border-radius: 4px;
    padding: 6px 8px; color: #000; font-weight: 800; font-size: 12px;
  }

  .totals { margin-top: 6px; padding: 2px 2px 0; }
  .totals .row { display: flex; justify-content: space-between; font-size: 11.5px; padding: 2.5px 0; }
  .totals .row .k { color: var(--ink-soft); }
  .totals .row .v { font-weight: 700; }
  .totals .row.discount .v { color: var(--crimson); }
  .grand {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-top: 9px; padding: 7px 2px 6px;
    border-top: 2.6px double #000; border-bottom: 2.6px double #000;
    background: #ffffff; color: #000;
  }
  .grand .k { font-size: 12px; font-weight: 800; opacity: .95; letter-spacing: .4px; }
  .grand .v { font-size: 26px; font-weight: 900; letter-spacing: .3px; }
  .grand .v .cur { color: #000; font-size: 11px; }

  .pay-title { font-size: 9px; font-weight: 800; color: var(--accent-deep); letter-spacing: 1px; margin-bottom: 4px; text-transform: uppercase; }
  .pay-row { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; border-bottom: 1px dotted var(--line-soft); }
  .pay-row:last-child { border-bottom: none; }
  .pay-row .method { color: var(--ink-soft); font-weight: 600; }
  .pay-row .ref { font-size: 8px; color: #8c8c8c; }
  .pay-row.change { font-weight: 800; color: var(--emerald); }

  .qr-section { text-align: center; margin-top: 10px; }
  .qr-section .qr-frame {
    display: inline-block; padding: 7px;
    border: 1.6px solid var(--accent-deep); outline: 3px double var(--accent-deep); outline-offset: 2px;
    border-radius: 10px; background: #fff;
  }
  .qr-section img { width: 132px; height: 132px; display: block; }
  .qr-cap { font-size: 8.5px; color: var(--ink-soft); margin-top: 6px; letter-spacing: .4px; font-weight: 600; }

  .footer { text-align: center; margin-top: 12px; padding-top: 10px; border-top: 3px double var(--accent); }
  .footer .thanks { font-size: 14px; font-weight: 900; color: var(--accent-deep); letter-spacing: .2px; }
  .footer .note { font-size: 9.5px; color: var(--ink-soft); margin-top: 2px; }
  .footer .legal { font-size: 8px; color: #9a9a9a; margin-top: 6px; letter-spacing: .2px; }
  .footer .brandline { font-size: 7px; color: #b0b0b0; letter-spacing: 1.6px; text-transform: uppercase; margin-top: 2px; }

  .void-banner {
    margin: 8px 0; padding: 7px; text-align: center; font-weight: 900; font-size: 15px;
    color: var(--crimson); border: 2.4px double var(--crimson); border-radius: 6px; letter-spacing: 4px;
  }
  .void-reason { text-align: center; font-size: 10px; color: var(--crimson); margin-top: 3px; font-weight: 600; }

  @media print {
    @page { size: 80mm 200mm; margin: 2mm; }
    body {
      max-width: none; padding: 0; background: #fff;
      /* بلا تلوين خفيف: الطباعة بالأبيض والأسود فقط */
      -webkit-print-color-adjust: economy;
      print-color-adjust: economy;
    }
    .inv-strip { background: #fff !important; color: #000 !important; border: 1.8px solid #000 !important; border-radius: 0; }
    .grand {
      background: #fff !important; color: #000 !important;
      border-top: 2.6px double #000 !important; border-bottom: 2.6px double #000 !important;
      box-shadow: none; outline: none;
    }
    .grand .v .cur { color: #000 !important; }
    .items th { background: #fff !important; color: #000 !important; border-bottom: 1.6px solid #000 !important; }
    .items tbody tr:nth-child(even) td { background: #f4f4f4 !important; }
    .buffet-banner, .buffet-persons th { background: #fff !important; color: #000 !important; border-color: #000 !important; }
    .meta-panel { border-inline-start: 4px solid #000 !important; background: #fafafa !important; }
    .seller-panel { border: 1.6px solid #000 !important; background: #fff !important; }
    .sp-title { color: #000 !important; border-block-end-color: #000 !important; }
    .qr-section .qr-frame { border: 2px solid #000 !important; outline: none; }
  }
</style>
</head>
<body>
  <hr class="rule double">
  <div class="brand">
    <div class="brand-mark">
      <img class="brand-logo" src="/app/assets/karim-logo.png" alt="">
    </div>
    <h1>${escHtml(sellerName)}</h1>
    ${sellerEn ? `<div class="en">${escHtml(sellerEn)}</div>` : ''}
    <div class="doc-type">فاتورة ضريبية مبسطة<small>SIMPLIFIED TAX INVOICE</small></div>
  </div>
  <div class="seller-panel" aria-label="بيانات البائع">
    <div class="sp-title"><span>بيانات البائع · SELLER</span><span>المملكة العربية السعودية</span></div>
    <div class="sp-grid">
      ${branchName ? `<div class="sp-item"><span class="sp-label">الفرع / Branch</span><span class="sp-value">${escHtml(branchName)}</span></div>` : ''}
      ${shopVat ? `<div class="sp-item"><span class="sp-label">الرقم الضريبي / VAT</span><span class="sp-value ltr">${escHtml(shopVat)}</span></div>` : ''}
      ${crn ? `<div class="sp-item"><span class="sp-label">السجل التجاري / CRN</span><span class="sp-value ltr">${escHtml(crn)}</span></div>` : ''}
      ${sellerAddress ? `<div class="sp-item sp-full"><span class="sp-label">العنوان الوطني / Address</span><span class="sp-value">${escHtml(sellerAddress)}</span></div>` : ''}
    </div>
  </div>
  <div class="inv-strip"><span class="lbl">فاتورة / No.</span><span class="num" dir="ltr">#${escHtml(order.invoice_counter)}</span></div>
  <hr class="rule double">

  <div class="meta-panel">
   ${metaRow('التاريخ والوقت', `<span class="m-value">${escHtml(date)}</span>`)}
  ${order.notes ? metaRow(isBuffet ? 'العائلة / المناسبة' : 'العميل / Customer', `<span class="m-value rtl">${escHtml(order.notes)}</span>`) : ''}
  ${metaRow('الكاشير / Cashier', `<span class="m-value rtl">${escHtml(order.cashier_name || '—')}${order.cashier_id ? ` (#${escHtml(order.cashier_id)})` : ''}</span>`)}
  ${order.session_id ? metaRow('الوردية', `<span class="m-value">${escHtml(order.session_id)}</span>`) : ''}
  ${order.invoice_uuid ? `<div class="m-row"><span class="m-label">UUID</span><span class="uuid">${escHtml(String(order.invoice_uuid).slice(0, 36))}</span></div>` : ''}
  ${voided ? `<div class="void-banner">ملغاة</div>${order.void_reason ? `<div class="void-reason">${escHtml(order.void_reason)}</div>` : ''}` : ''}
  </div>

  <hr class="rule thin">
  ${itemsHtml}

  <hr class="rule">
  <div class="totals">
    <div class="row"><span class="k">المجموع قبل الضريبة</span><span class="v">${money(order.subtotal, currencyLabel)}</span></div>
    ${Number(order.discount_total) > 0 ? `<div class="row discount"><span class="k">الخصم</span><span class="v">-${money(order.discount_total, currencyLabel)}</span></div>` : ''}
    <div class="row"><span class="k">${escHtml(vatLabel)}</span><span class="v">${money(order.tax_total, currencyLabel)}</span></div>
  </div>
  <div class="grand"><span class="k">الإجمالي المستحق</span><span class="v">${money(order.total_amount, currencyLabel)}</span></div>

  ${inPayments.length ? `
  <hr class="rule solid">
  <div class="pay-title">الدفع</div>
  ${inPayments.map((p) => {
      const info = (() => {
          const raw = p.payer_info;
          if (!raw) return {};
          if (typeof raw === 'object') return raw;
          try { return JSON.parse(String(raw)); } catch { return {}; }
      })();
      const brandLabels = { mada: 'مدى', visa: 'فيزا', mastercard: 'ماستركارد', amex: 'أمريكان إكسبريس' };
      const brandLabel = info.brand ? (brandLabels[info.brand] || String(info.brand)) : '';
      const last4 = info.last4 ? String(info.last4) : '';
      const cardTxt = brandLabel ? ` · ${brandLabel}${last4 ? ` ····${last4}` : ''}` : '';
      return `
    <div class="pay-row">
      <span class="method">${escHtml(methodLabel(p.method))}${cardTxt}${p.reference ? ` <span class="ref">#${escHtml(p.reference)}</span>` : ''}</span>
      <span>${money(p.amount, currencyLabel)}</span>
    </div>`;
  }).join('')}
  ${changeGiven > 0 ? `<div class="pay-row change"><span class="method">الباقي للعميل</span><span>${money(changeGiven, currencyLabel)}</span></div>` : ''}
  ` : (paidIn > 0 ? `<hr class="rule solid"><div class="pay-row"><span class="method">المدفوع</span><span>${money(paidIn, currencyLabel)}</span></div>` : '')}

  ${qrImageDataUrl ? `
  <div class="qr-section">
    <div class="qr-frame"><img src="${qrImageDataUrl}" alt="رمز ZATCA"></div>
    <div class="qr-cap">رمز التحقق الضريبي — ZATCA</div>
  </div>` : ''}

  <div class="footer">
    <div class="thanks">✦ شكرًا لزيارتكم ✦</div>
    <div class="note">نتطلع لخدمتكم مرة أخرى</div>
    <div class="legal">هذه فاتورة إلكترونية صادرة وفق هيئة الزكاة والضريبة والجمارك — لا تحتاج ختمًا أو توقيعًا</div>
    <div class="brandline">SHARFA AL ALAMI · KARIM ERP</div>
  </div>
</body>
</html>`;
}

module.exports = { buildReceiptHtml, escHtml, methodLabel, METHOD_LABELS };
