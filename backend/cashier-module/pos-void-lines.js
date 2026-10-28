'use strict';

/**
 * pos-void-lines.js — بناء سطور القيد العكسي لإلغاء فاتورة كاشير.
 * ────────────────────────────────────────────────────────────────────────────
 * فصلٌ مقصود عن المسار: رياضيات القيد المالي تُختبر بلا قاعدة بيانات.
 *
 * القاعدة الأولى: إن وُجد قيد البيع الأصلي، يُقلَب حرفيًا (مدين↔دائن) —
 * فيُعكس الصندوق والبنك والمخزون والتكلفة والإيراد والضريبة بأرقامها
 * الفعلية، ولو تغيّرت سياسة الترحيل بعد البيع.
 * القاعدة الثانية: بلا قيد أصلي (بيع سابق لتفعيل الأستاذ) يُعاد بناء العكس
 * من بيانات الفاتورة والتحصيل وتكلفة الاستهلاك: Dr 4000/2100/1200 ←
 * Cr 5000/1010/1000.
 */

/**
 * @typedef {object} JournalLine
 * @property {string} account_code
 * @property {number} [debit]
 * @property {number} [credit]
 * @property {string} [memo]
 * @property {string|null} [cost_center_code]
 */

/**
 * @typedef {object} PaymentRow
 * @property {number|string} [amount]
 * @property {string} [method]
 * @property {string} [direction]
 */

/** @param {unknown} n @returns {number} */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * قلب سطور قيد منشور: كل مدين يصبح دائنًا وبالعكس.
 * @param {JournalLine[]|null|undefined} lines
 * @param {string} [fallbackMemo]
 * @returns {JournalLine[]}
 */
function reverseJournalLines(lines, fallbackMemo = 'سطر قيد البيع') {
    return (Array.isArray(lines) ? lines : [])
        .map((l) => ({
            account_code: String(l.account_code || '').trim(),
            debit: round2(l.credit),
            credit: round2(l.debit),
            memo: `عكس ${l.memo || fallbackMemo}`.slice(0, 255),
            cost_center_code: l.cost_center_code || null,
        }))
        .filter((l) => l.account_code && (l.debit > 0 || l.credit > 0));
}

/**
 * قيد عكسي مُعاد بناؤه عندما لا يوجد قيد بيع أصلي في الأستاذ.
 * @param {object} input
 * @param {number|string} [input.invoiceCounter]
 * @param {number|string} [input.total]
 * @param {number|string} [input.tax]
 * @param {number|string} [input.cogs]
 * @param {PaymentRow[]} [input.payments]
 * @returns {JournalLine[]}
 */
function buildFallbackVoidLines({ invoiceCounter, total, tax, cogs, payments }) {
    const t = round2(total);
    const taxAmt = round2(tax);
    const revenue = round2(t - taxAmt);
    const cogsAmt = round2(cogs);
    // تجاهل صفوف «الباقي» (direction=out) وصنّف غير النقدي كبنك.
    const nonCash = round2((Array.isArray(payments) ? payments : [])
        .filter((p) => p.direction !== 'out' && String(p.method).toLowerCase() !== 'cash')
        .reduce((s, p) => s + Number(p.amount || 0), 0));
    const cardPart = round2(Math.min(nonCash, Math.max(0, t)));
    const cashPart = round2(Math.max(0, t - cardPart));
    const lines = [];
    if (revenue > 0) { lines.push({ account_code: '4000', debit: revenue, credit: 0, memo: `عكس مبيعات فاتورة #${invoiceCounter}` }); }
    if (taxAmt > 0) { lines.push({ account_code: '2100', debit: taxAmt, credit: 0, memo: 'عكس ضريبة الفاتورة' }); }
    if (cogsAmt > 0) {
        lines.push({ account_code: '1200', debit: cogsAmt, credit: 0, memo: `إعادة مخزون فاتورة #${invoiceCounter}` });
        lines.push({ account_code: '5000', debit: 0, credit: cogsAmt, memo: `عكس تكلفة فاتورة #${invoiceCounter}` });
    }
    if (cardPart > 0) { lines.push({ account_code: '1010', debit: 0, credit: cardPart, memo: 'رد تحصيل غير نقدي — إلغاء فاتورة' }); }
    if (cashPart > 0) { lines.push({ account_code: '1000', debit: 0, credit: cashPart, memo: 'رد تحصيل نقدي — إلغاء فاتورة' }); }
    return lines;
}

/**
 * @param {JournalLine[]|null|undefined} [lines]
 * @returns {{debit:number,credit:number}}
 */
const totals = (lines) => ({
    debit: round2((lines || []).reduce((s, l) => s + Number(l.debit || 0), 0)),
    credit: round2((lines || []).reduce((s, l) => s + Number(l.credit || 0), 0)),
});

module.exports = { reverseJournalLines, buildFallbackVoidLines, totals, round2 };
