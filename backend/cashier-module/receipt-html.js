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
  <thead><tr><th class="item">الصنف</th><th class="qty">الكمية</th><th class="price">السعر</th><th class="total">الإجمالي</th></tr></thead>
  <tbody>
  ${items.map((it) => `
    <tr>
      <td class="item">${escHtml(it.product_name)}${Number(it.discount) > 0 ? '<span class="line-disc">خصم السطر</span>' : ''}</td>
      <td class="qty">${Number(it.quantity)}</td>
      <td class="price">${Number(it.unit_price).toFixed(2)}</td>
      <td class="total">${Number(it.line_total).toFixed(2)}</td>
    </tr>`).join('')}
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
    --gold-soft: #fbf3e4;
    --ink: #171717;
    --ink-soft: #52525b;
    --line: #e7e5e4;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  body {
    font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    color: var(--ink);
    font-size: 12px;
    line-height: 1.55;
    max-width: 80mm;
    margin: 0 auto;
    padding: 6px 10px 10px;
    font-variant-numeric: tabular-nums;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .cur { font-size: 9px; color: var(--ink-soft); }

  .brand { text-align: center; padding: 4px 0 8px; }
  .brand-logo {
    width: 62px; height: 62px; object-fit: contain;
    border: 1.5px solid var(--gold); border-radius: 50%;
    padding: 6px; background: #fff;
  }
  .brand h1 { font-size: 15px; font-weight: 800; margin-top: 6px; letter-spacing: .2px; }
  .brand .en { font-size: 9.5px; color: var(--ink-soft); letter-spacing: .6px; text-transform: uppercase; }
  .doc-type {
    display: inline-block; margin-top: 6px; padding: 2px 12px;
    border: 1px solid var(--gold); border-radius: 999px;
    color: var(--gold); font-size: 10px; font-weight: 800; background: var(--gold-soft);
  }
  .shop-meta { text-align: center; font-size: 9.5px; color: var(--ink-soft); margin-top: 4px; }
  .shop-meta span + span::before { content: '·'; margin: 0 5px; color: #c8c4bd; }

  .rule { border: none; border-top: 1px dashed #b9b3a9; margin: 8px 0; }
  .rule.solid { border-top-style: solid; border-top-color: var(--line); }

  .m-row { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding: 1.5px 0; }
  .m-label { color: var(--ink-soft); }
  .m-value { font-weight: 700; text-align: left; direction: ltr; }
  .m-value.rtl { direction: rtl; }
  .uuid { font-size: 8.5px; color: #9a948b; letter-spacing: .3px; }

  table { width: 100%; border-collapse: collapse; }
  .items th {
    font-size: 9.5px; font-weight: 800; color: var(--gold);
    background: var(--gold-soft); padding: 4px 3px; text-align: right;
  }
  .items th.qty, .items td.qty { width: 12%; text-align: center; }
  .items th.price, .items td.price { width: 20%; text-align: center; }
  .items th.total, .items td.total { width: 25%; text-align: left; }
  .items td { padding: 4px 3px; border-bottom: 1px dotted var(--line); font-size: 11.5px; vertical-align: top; }
  .items tr:last-child td { border-bottom: none; }
  .items td.item { font-weight: 700; }
  .line-disc { display: block; font-size: 9px; font-weight: 600; color: #b91c1c; }

  .buffet-banner {
    text-align: center; font-weight: 800; font-size: 12px; color: var(--gold);
    background: var(--gold-soft); border: 1px solid #e9d3a9; border-radius: 8px;
    padding: 5px; margin-bottom: 6px;
  }
  .buffet-persons th, .buffet-persons td { padding: 4px 3px; border-bottom: 1px dotted var(--line); font-size: 11px; text-align: right; }
  .buffet-persons th { background: var(--gold-soft); color: var(--gold); font-size: 9.5px; font-weight: 800; }
  .buffet-persons .c { text-align: center; }
  .buffet-persons .t { text-align: left; }
  .persons-total {
    display: flex; justify-content: space-between; margin-top: 6px;
    background: var(--gold-soft); border: 1px solid #e9d3a9; border-radius: 8px;
    padding: 5px 8px; color: var(--gold); font-weight: 800; font-size: 12px;
  }

  .totals { margin-top: 2px; }
  .totals .row { display: flex; justify-content: space-between; font-size: 11.5px; padding: 2px 0; }
  .totals .row .k { color: var(--ink-soft); }
  .totals .row.discount .v { color: #b91c1c; }
  .grand {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-top: 6px; padding: 8px 10px; border-radius: 10px;
    background: var(--gold); color: #fff;
  }
  .grand .k { font-size: 12px; font-weight: 700; opacity: .95; }
  .grand .v { font-size: 21px; font-weight: 900; letter-spacing: .3px; }
  .grand .v .cur { color: #ffe9c7; font-size: 10px; }

  .pay-title { font-size: 10px; font-weight: 800; color: var(--gold); margin-bottom: 3px; }
  .pay-row { display: flex; justify-content: space-between; font-size: 11px; padding: 1.5px 0; }
  .pay-row .method { color: var(--ink-soft); }
  .pay-row .ref { font-size: 8.5px; color: #9a948b; }
  .pay-row.change { font-weight: 800; color: #047857; }

  .qr-section { text-align: center; margin-top: 10px; }
  .qr-section .qr-frame {
    display: inline-block; padding: 6px; border: 1px solid var(--line);
    border-radius: 10px; background: #fff;
  }
  .qr-section img { width: 104px; height: 104px; display: block; }
  .qr-cap { font-size: 8.5px; color: #9a948b; margin-top: 4px; }

  .footer { text-align: center; margin-top: 10px; padding-top: 8px; border-top: 1px dashed #b9b3a9; }
  .footer .thanks { font-size: 13px; font-weight: 800; color: var(--gold); }
  .footer .note { font-size: 9.5px; color: var(--ink-soft); margin-top: 2px; }
  .footer .legal { font-size: 8.5px; color: #a8a29e; margin-top: 5px; }

  .void-banner {
    margin: 8px 0; padding: 6px; text-align: center; font-weight: 900; font-size: 15px;
    color: #b91c1c; border: 2px double #b91c1c; border-radius: 6px; letter-spacing: 2px;
  }
  .void-reason { text-align: center; font-size: 10px; color: #b91c1c; margin-top: 2px; }

  @media print {
    @page { size: 80mm 200mm; margin: 2mm; }
    body { max-width: none; padding: 0; }
    .grand { background: #fff !important; color: #000 !important; border: 2px solid #000; }
    .grand .v .cur { color: #000 !important; }
    .items th { background: #f2f2f2 !important; color: #000 !important; }
  }
</style>
</head>
<body>
  <div class="brand">
    <img class="brand-logo" src="/app/assets/karim-logo.png" alt="">
    <h1>${escHtml(order.department_name || 'مطاعم الشرفه العالمي')}</h1>
    ${order.department_name_en ? `<div class="en">${escHtml(order.department_name_en)}</div>` : ''}
    <div class="doc-type">فاتورة ضريبية مبسطة</div>
    <div class="shop-meta">
      ${order.vat_number ? `<span>الرقم الضريبي ${escHtml(order.vat_number)}</span>` : ''}
      ${order.location ? `<span>${escHtml(order.location)}</span>` : ''}
    </div>
  </div>

  <hr class="rule">
  ${metaRow('رقم الفاتورة', `<span class="m-value">#${escHtml(order.invoice_counter)}</span>`)}
  ${metaRow('التاريخ والوقت', `<span class="m-value">${escHtml(date)}</span>`)}
  ${metaRow('الكاشير', `<span class="m-value rtl">${escHtml(order.cashier_name || '—')}</span>`)}
  ${order.session_id ? metaRow('الوردية', `<span class="m-value">${escHtml(order.session_id)}</span>`) : ''}
  ${order.invoice_uuid ? `<div class="m-row"><span class="m-label">UUID</span><span class="uuid">${escHtml(String(order.invoice_uuid).slice(0, 36))}</span></div>` : ''}
  ${voided ? `<div class="void-banner">ملغاة</div>${order.void_reason ? `<div class="void-reason">${escHtml(order.void_reason)}</div>` : ''}` : ''}

  <hr class="rule">
  ${itemsHtml}
  ${isBuffet && order.notes ? `<div class="m-row"><span class="m-label">العائلة / المناسبة</span><span class="m-value rtl">${escHtml(order.notes)}</span></div>` : ''}

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
  ${inPayments.map((p) => `
    <div class="pay-row">
      <span class="method">${escHtml(methodLabel(p.method))}${p.reference ? ` <span class="ref">#${escHtml(p.reference)}</span>` : ''}</span>
      <span>${money(p.amount, currencyLabel)}</span>
    </div>`).join('')}
  ${changeGiven > 0 ? `<div class="pay-row change"><span class="method">الباقي للعميل</span><span>${money(changeGiven, currencyLabel)}</span></div>` : ''}
  ` : (paidIn > 0 ? `<hr class="rule solid"><div class="pay-row"><span class="method">المدفوع</span><span>${money(paidIn, currencyLabel)}</span></div>` : '')}

  ${qrImageDataUrl ? `
  <div class="qr-section">
    <div class="qr-frame"><img src="${qrImageDataUrl}" alt="رمز ZATCA"></div>
    <div class="qr-cap">رمز التحقق الضريبي — ZATCA</div>
  </div>` : ''}

  <div class="footer">
    <div class="thanks">شكراً لزيارتكم</div>
    <div class="note">نتطلع لخدمتكم مرة أخرى</div>
    <div class="legal">هذه فاتورة إلكترونية صادرة من نظام المطاعم — لا تحتاج ختمًا أو توقيعًا</div>
  </div>
</body>
</html>`;
}

module.exports = { buildReceiptHtml, escHtml, methodLabel, METHOD_LABELS };
