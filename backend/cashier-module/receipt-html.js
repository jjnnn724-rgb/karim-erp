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
    --gold: #b45309;
    --gold-deep: #8a3c07;
    --gold-soft: #f8ecd8;
    --gold-pale: #fdf8ee;
    --ink: #1c1917;
    --ink-soft: #57534e;
    --line: #e7e2d6;
    --line-soft: #efeadd;
    --crimson: #b91c1c;
    --emerald: #047857;
    --cream: #fffef9;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: var(--cream); }
  body {
    font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    color: var(--ink);
    font-size: 12px;
    line-height: 1.55;
    max-width: 80mm;
    margin: 0 auto;
    padding: 8mm 6mm 8mm;
    font-variant-numeric: tabular-nums;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .cur { font-size: 9px; color: var(--ink-soft); }

  /* ═══ الترويسة — إطار ذهبي مزدوج ═══════════════════════════════════════════ */
  .rule.double { border: none; border-top: 3px double var(--gold); margin: 4px 0 6px; }
  .rule.thin { border: none; border-top: 1px solid var(--line); margin: 5px 0; }
  .rule.solid { border-top: 1.6px solid var(--gold-deep); }

  .inv-strip {
    display: flex; align-items: center; justify-content: center; gap: 6mm;
    background: var(--gold-deep); color: #ffe9c7;
    border-radius: 8px; padding: 2mm 4mm; margin: 5px 0 6px;
  }
  .inv-strip .lbl { font-size: 8px; font-weight: 700; letter-spacing: 1.2px; opacity: .92; }
  .inv-strip .num { font-size: 19px; font-weight: 900; letter-spacing: .5px; line-height: 1; }

  .item-ar { display: block; font-weight: 700; }
  .item-en { display: block; font-size: 7.5px; color: var(--ink-soft); letter-spacing: .3px; margin-top: 1px; }

  .brand { text-align: center; padding: 2px 0 6px; }
  .brand-mark {
    display: inline-flex; align-items: center; justify-content: center;
    width: 62px; height: 62px; border: 1px solid var(--gold);
    border-radius: 50%; outline: 3px double var(--gold-deep); outline-offset: 3px;
    background: var(--gold-pale);
  }
  .brand-logo {
    width: 48px; height: 48px; object-fit: contain;
  }
  .brand h1 { font-size: 15.5px; font-weight: 900; margin-top: 8px; letter-spacing: 0; line-height: 1.3; }
  .brand .en {
    font-size: 8.5px; color: var(--gold-deep); letter-spacing: 1.6px;
    text-transform: uppercase; margin-top: 2px; font-weight: 700;
  }
  .doc-type {
    display: inline-block; margin-top: 6px; padding: 3px 14px 4px;
    border: 1.6px solid var(--gold-deep); border-radius: 999px;
    color: var(--gold-deep); font-size: 9.5px; font-weight: 800;
    letter-spacing: .4px; background: var(--gold-soft);
  }
  .shop-meta {
    display: flex; justify-content: center; gap: 8px; flex-wrap: wrap;
    font-size: 8.5px; color: var(--ink-soft); margin-top: 6px; line-height: 1.7;
  }
  .shop-meta span { display: inline-flex; align-items: center; }
  .shop-meta .vat {
    direction: ltr; border: 1px solid var(--line); border-radius: 4px;
    padding: 0 5px; background: #fff; font-weight: 700; letter-spacing: .4px;
  }

  /* ═══ لوحة بيانات الفاتورة ═════════════════════════════════════════════════ */
  .meta-panel {
    margin: 8px 0 6px; padding: 6px 8px;
    background: var(--gold-pale);
    border: 1px solid var(--line-soft);
    border-inline-start: 3px solid var(--gold);
    border-radius: 8px;
  }
  .m-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 10.5px; padding: 1.5px 0; }
  .m-label { color: var(--ink-soft); font-size: 8.5px; letter-spacing: .3px; }
  .m-value { font-weight: 700; text-align: left; direction: ltr; }
  .m-value.rtl { direction: rtl; }
  .uuid { font-size: 8px; color: #8a857c; letter-spacing: .4px; font-family: 'IBM Plex Mono', Consolas, monospace; }

  /* ═══ جدول الأصناف ════════════════════════════════════════════════════════ */
  table { width: 100%; border-collapse: collapse; }
  .items th {
    font-size: 8.5px; font-weight: 800; color: #fff; background: var(--gold-deep);
    padding: 5px 5px; text-align: right; letter-spacing: .4px;
  }
  .items th.qty, .items td.qty { width: 11%; text-align: center; }
  .items th.price, .items td.price { width: 19%; text-align: center; }
  .items th.total, .items td.total { width: 24%; text-align: left; }
  .items td { padding: 5px 5px; border-bottom: 1px solid var(--line-soft); font-size: 11px; vertical-align: top; }
  .items tbody tr:nth-child(even) td { background: var(--gold-pale); }
  .items tr:last-child td { border-bottom: none; }
  .items td.item { font-weight: 700; }
  .line-disc { display: block; font-size: 8.5px; font-weight: 600; color: var(--crimson); }

  .buffet-banner {
    text-align: center; font-weight: 800; font-size: 11.5px; color: #fff;
    background: var(--gold-deep); border-radius: 8px;
    padding: 6px; margin-bottom: 6px; letter-spacing: .2px;
  }
  .buffet-persons th, .buffet-persons td { padding: 4px 4px; border-bottom: 1px solid var(--line-soft); font-size: 11px; text-align: right; }
  .buffet-persons th { background: var(--gold-deep); color: #fff; font-size: 8.5px; font-weight: 800; letter-spacing: .4px; }
  .buffet-persons .c { text-align: center; }
  .buffet-persons .t { text-align: left; font-weight: 700; }
  .persons-total {
    display: flex; justify-content: space-between; margin-top: 6px;
    background: var(--gold-soft); border: 1px solid #e5cf9f; border-radius: 8px;
    padding: 6px 8px; color: var(--gold-deep); font-weight: 800; font-size: 12px;
  }

  .totals { margin-top: 6px; padding: 2px 2px 0; }
  .totals .row { display: flex; justify-content: space-between; font-size: 11.5px; padding: 2.5px 0; }
  .totals .row .k { color: var(--ink-soft); }
  .totals .row .v { font-weight: 700; }
  .totals .row.discount .v { color: var(--crimson); }
  .grand {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-top: 8px; padding: 10px 12px; border-radius: 10px;
    background: linear-gradient(160deg, #d97706, #8a3c07);
    color: #fff; border: 1px solid #6d2c05;
    box-shadow: 0 2px 0 #6d2c05 inset, 0 -1px 0 rgb(255 255 255 / 30%) inset;
  }
  .grand .k { font-size: 11px; font-weight: 800; opacity: .95; letter-spacing: .3px; }
  .grand .v { font-size: 22px; font-weight: 900; letter-spacing: .2px; }
  .grand .v .cur { color: #ffe3ae; font-size: 10px; }

  .pay-title { font-size: 9px; font-weight: 800; color: var(--gold-deep); letter-spacing: 1px; margin-bottom: 4px; text-transform: uppercase; }
  .pay-row { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; border-bottom: 1px dotted var(--line-soft); }
  .pay-row:last-child { border-bottom: none; }
  .pay-row .method { color: var(--ink-soft); font-weight: 600; }
  .pay-row .ref { font-size: 8px; color: #a8a29e; }
  .pay-row.change { font-weight: 800; color: var(--emerald); }

  .qr-section { text-align: center; margin-top: 10px; }
  .qr-section .qr-frame {
    display: inline-block; padding: 7px;
    border: 1.6px solid var(--gold-deep); outline: 3px double var(--gold-deep); outline-offset: 2px;
    border-radius: 10px; background: #fff;
  }
  .qr-section img { width: 104px; height: 104px; display: block; }
  .qr-cap { font-size: 8.5px; color: var(--ink-soft); margin-top: 6px; letter-spacing: .4px; font-weight: 600; }

  .footer { text-align: center; margin-top: 12px; padding-top: 10px; border-top: 3px double var(--gold); }
  .footer .thanks { font-size: 14px; font-weight: 900; color: var(--gold-deep); letter-spacing: .2px; }
  .footer .note { font-size: 9.5px; color: var(--ink-soft); margin-top: 2px; }
  .footer .legal { font-size: 8px; color: #b5aea1; margin-top: 6px; letter-spacing: .2px; }
  .footer .brandline { font-size: 7px; color: #c7c0b2; letter-spacing: 1.6px; text-transform: uppercase; margin-top: 2px; }

  .void-banner {
    margin: 8px 0; padding: 7px; text-align: center; font-weight: 900; font-size: 15px;
    color: var(--crimson); border: 2.4px double var(--crimson); border-radius: 6px; letter-spacing: 4px;
  }
  .void-reason { text-align: center; font-size: 10px; color: var(--crimson); margin-top: 3px; font-weight: 600; }

  @media print {
    @page { size: 80mm 200mm; margin: 2mm; }
    body { max-width: none; padding: 0; background: #fff; }
    .inv-strip { background: #000 !important; color: #fff !important; border-radius: 0; }
    .grand {
      background: #000 !important; color: #fff !important;
      border: 2px solid #000; box-shadow: none; outline: none;
    }
    .grand .v .cur { color: #fff !important; }
    .items th { background: #000 !important; color: #fff !important; }
    .items tbody tr:nth-child(even) td { background: #f5f5f5 !important; }
    .buffet-banner, .buffet-persons th { background: #000 !important; color: #fff !important; }
    .meta-panel { border-inline-start: 4px solid #000 !important; background: #fafafa !important; }
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
    <h1>${escHtml(order.department_name || 'مطاعم الشرفه العالمي')}</h1>
    ${order.department_name_en ? `<div class="en">${escHtml(order.department_name_en)}</div>` : ''}
    <div class="doc-type">فاتورة ضريبية مبسطة</div>
    <div class="shop-meta">
      ${order.vat_number ? `<span class="vat">VAT ${escHtml(order.vat_number)}</span>` : ''}
      ${order.location ? `<span>${escHtml(order.location)}</span>` : ''}
    </div>
  </div>
  <hr class="rule double">
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
