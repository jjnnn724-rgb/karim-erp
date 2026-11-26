/**
 * late-notice-logic.js — دوال نقية لإشعارات التأخير (لا DB ولا WhatsApp هنا).
 * مستخدمة من whatsapp-engine/genius.js + قابلة للاختبار بلا بيئة.
 *
 * القاعدة (قرار المالك 2026-11-18):
 *   «تأخير» يُحتسب فقط حين يكون العجز < وردية كاملة للموظف (shift_karim):
 *   12 ساعة للموظف اللي بيعمل 12 ساعة، و10 ساعات للموظف اللي بيعمل 10 ساعات… إلخ.
 *   العجز ≥ وردية كاملة = غياب، لا يُرسل عنه «أنت تأخرت».
 */
'use strict';

/**
 * تطبيع رقم الجوال السعودي إلى 9665XXXXXXXX — أو null لو الرقم مش صالح.
 * تقبل: 05XXXXXXXX | +9665XXXXXXXX | 009665XXXXXXXX | 5XXXXXXXX (مع أي رموز/مسافات).
 */
function normalizeSaudiMobile(raw) {
    let digits = String(raw ?? '').replace(/\D/g, '');
    if (!digits) {return null;}
    if (digits.startsWith('00')) {digits = digits.slice(2);}
    if (/^05\d{8}$/.test(digits)) {return `966${digits.slice(1)}`;}   // 05XXXXXXXX → 9665XXXXXXXX
    if (/^9665\d{8}$/.test(digits)) {return digits;}                  // 9665XXXXXXXX
    if (/^5\d{8}$/.test(digits)) {return `966${digits}`;}             // 5XXXXXXXX → 9665XXXXXXXX
    return null;
}

/** هل العجز «تأخير» (أقل من وردية كاملة)؟ ≥ الوردية كاملة = غياب، لا إشعار. */
function isLatenessWithinShift(shortfallMinutes, shiftHours) {
    const shortfall = Number(shortfallMinutes) || 0;
    const shiftMin = Math.round((Number(shiftHours) || 10) * 60);
    if (shortfall <= 0) {return false;}
    return shortfall < shiftMin;
}

/** نص الإشعار الشخصي — موجه للموظف عن نفسه (لا أسماء الآخرين). */
function formatLateNotice({ shiftStart, lateMinutes }) {
    const minutes = Math.round(Number(lateMinutes) || 0);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const human = h > 0 ? `${h} س ${m} د` : `${m} د`;
    return `⏰ إشعار تأخير — أنت تأخرت اليوم ${human} عن وردية ${shiftStart || '—'}.\nبرجاء الالتزام بمواعيد الحضور.`;
}

module.exports = { normalizeSaudiMobile, isLatenessWithinShift, formatLateNotice };
