'use strict';

/**
 * riyadh-date.js — التاريخ "اليوم" بتوقيت الرياض (UTC+3) لكل الوحدات المالية.
 * ────────────────────────────────────────────────────────────────────────────
 * new Date().toISOString() يعطي توقيت UTC — في الساعات 00:00–02:59 بتوقيت
 * الرياض يعيد اليوم *السابق*، فكان الإقفال اليومي والإهلاك والميزانيات تحسب
 * الشهر الخطأ. en-CA يعطي الصيغة YYYY-MM-DD مباشرة.
 *
 * @returns {string} YYYY-MM-DD بتوقيت Asia/Riyadh
 */
function riyadhToday() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
}

/** @returns {string} YYYY-MM (الشهر الحالي بتوقيت الرياض) */
function riyadhMonth() {
    return riyadhToday().slice(0, 7);
}

/**
 * تاريخ يوم عمل بتوقيت الرياض ل��طابع زمني محدَّد (فاتورة/قيد/حركة).
 * toISOString() وحدها تُرجع اليوم السابق في 00:00–02:59 الرياض — لذلك
 * أي تاريخ مالي مشتق من_created_at_ كان ينزلق يومًا للخلف.
 * @param {Date|string|number} value
 * @returns {string} YYYY-MM-DD بتوقيت Asia/Riyadh
 */
function riyadhDateOf(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) {return riyadhToday();}
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
}

module.exports = { riyadhToday, riyadhMonth, riyadhDateOf };
