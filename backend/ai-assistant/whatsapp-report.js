/**
 * ai-assistant/whatsapp-report.js — التقرير الذكي «وين الزيادة؟» لواتساب
 * ════════════════════════════════════════════════════════════════════════
 * يُلحق بالإحاطة اليومية (٢٣:٣٠) بنفس المجرى (manager_jids + idempotency).
 * القواعد الحاكمة:
 *   • لا رقم إلا من محرك التحليل الحتمي (analyzer.js) — لا نموذج ولا تقدير.
 *   • التوصية: قاعدة صريحة لكل نوع تنبيه — لا سرد حر.
 *   • إن تعذّر حساب التحليل: تُلغى الفقرة فقط ويُسجَّل التحذير — الإحاطة تصل.
 */
'use strict';

const money = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const int = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const arrow = (pct) => (Number(pct) >= 0 ? `▲ +${Number(pct).toFixed(1)}%` : `▼ ${Math.abs(Number(pct)).toFixed(1)}%`);
const divider = '━━━━━━━━━━━━━━━━━━━━━';
const pct1 = (v) => `${Number(v || 0).toFixed(1)}%`;

function weekdayAr(isoDay) {
    try {
        return new Intl.DateTimeFormat('ar', { timeZone: 'Asia/Riyadh', weekday: 'long' }).format(new Date(`${isoDay}T00:00:00+03:00`));
    } catch (_) { return ''; }
}

/** الكتلة الأساسية: مؤشرات الـ٧ أيام. */
function weekBlock(w) {
    const m = w.metrics;
    return [
        `📅 من ${w.current.from} إلى ${w.current.to} مقابل الـ٧ السابقة`,
        `📈 المبيعات: ${money(m.sales.current)} ر.س ${arrow(m.sales.deltaPct)}`,
        `🧾 عدد الفواتير: ${int(w.sales.curInvoices)} ${arrow(w.sales.invoicesDeltaPct)}`,
        `🎟️ متوسط الفاتورة: ${money(m.avgTicket.current)} ر.س ${arrow(m.avgTicket.deltaPct)}`,
        `💸 المصروفات: ${money(m.expenses.current)} ر.س ${arrow(m.expenses.deltaPct)}`,
        `🥩 مواد خام (الكوست): ${money(m.materials.current)} ر.س ${arrow(m.materials.deltaPct)}`,
        `🏭 صرف المخزن: ${money(m.warehouseOut.current)} ر.س ${arrow(m.warehouseOut.deltaPct)}`,
        `📋 أذونات الصرف: ${int(m.dispatches.current)} (${int(w.dispatches.curItems)} بند) ${arrow(m.dispatches.deltaPct)}`,
    ];
}

/** «وين الزيادة؟» — زيادة الأسبوع أولًا ثم الشهر، معلّمة بمصدرها. */
function increasesBlock(week, month) {
    const tag = (a, src) => ({ ...a, _src: src });
    const upAlerts = (week.alerts || []).filter((a) => String(a.direction || '') === 'up').map((a) => tag(a, 'الأسبوع'));
    const monthUp = (month.alerts || []).filter((a) => String(a.direction || '') === 'up').map((a) => tag(a, 'الشهر'));
    const weight = { high: 3, medium: 2, low: 1 };
    const top = [...upAlerts, ...monthUp]
        .sort((a, b) => (weight[b.severity] || 0) - (weight[a.severity] || 0))
        .slice(0, 3);
    if (!top.length) {
        return ['🟢 لا توجد زيادات فوق الحد — كل المؤشرات في الاتجاه الطبيعي.'];
    }
    const lines = ['🔻 وين الزيادة؟'];
    for (const a of top) {
        const dot = a.severity === 'high' ? '🔴' : '🟠';
        lines.push(`${dot} ${a.title} (${a._src})`);
    }
    return lines;
}

/** ملخص الشهر (بمعدل اليوم عند تغطية أقصر). */
function monthBlock(month) {
    const m = month.metrics;
    const basis = month.fairNotes && month.fairNotes.length ? ' (بمعدل اليوم — التغطية أقصر)' : '';
    return [
        `📊 الشهر مقابل الشهر${basis}`,
        `▫️ مبيعات ${arrow(m.sales.deltaPct)} · مصروفات ${arrow(m.expenses.deltaPct)} · صرف مخزن ${arrow(m.warehouseOut.deltaPct)} · أذونات ${arrow(m.dispatches.deltaPct)}`,
    ];
}

/** فرص التخفيض (أعلى ٣ زيادات مطلقة). */
function reductionBlock(week) {
    const rows = (week.reductionTargets || []).slice(0, 3);
    if (!rows.length) {return [];}
    const lines = ['💡 فرص التخفيض (الأكبر أولًا)'];
    rows.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.area}: +${money(r.increase)} ر.س (${pct1(r.increasePct)}) — استرجعها بمراجعة بنودها`);
    });
    return lines;
}

/** توصية واحدة عملية — صريحة لكل نوع تنبيه. */
const RECOMMENDATIONS = {
    'sales-drop': 'افهم سبب انخفاض عدد الفواتير هذا الأسبوع مع مشرفي الأقسام قبل أي قرار',
    'expenses-up': 'راجع بنود المصروفات الأعلى زيادة اليوم وحدد بندين للتجميد',
    'materials-up': 'قارن أسعار آخر توريدة بآخر ٣ توريدات وحدد المورد والصنف المسؤول',
    'warehouse-out-up': 'راجع أذونات الصرف المعلقة والهالك — الصرف أعلى من معدله',
    'dispatches-up': 'راجع الأقسام الأعلى طلبًا آخر ٧ أيام وامنع الطلبات المكررة',
    'correction-up': 'افحص آخر جرد — أصناف سالبة أو عجز يحتاج تحقيقًا',
    'ratio-up': 'جمّد الطلبات غير العاجلة حتى مراجعة الفئات الأعلى زيادة',
};
function recommendationBlock(week) {
    const alerts = (week.alerts || []).slice();
    if (!alerts.length) {
        return ['✅ التوصية: ثبّت الوضع الحالي — لا تخفيضات طارئة، فقط مراقبة عادية.'];
    }
    const top = alerts[0];
    const direct = RECOMMENDATIONS[top.id];
    if (direct) {return [`✅ التوصية: ${direct}`];}
    const short = String(top.action || '').trim().split('—')[0].split('،')[0].trim();
    return [`✅ التوصية: ${short || 'راجع التنبيه الأعلى وحدد البند المسؤول'}`];
}

/**
 * يبني فقرة «التقرير الذكي» كاملة (≤ ~1200 حرف).
 * @param {object} week — نتيجة analyzer للأسبوع
 * @param {object} month — نتيجة analyzer للشهر
 * @param {string} day — يوم الإحاطة YYYY-MM-DD
 */
function formatSmartReport(week, month, day) {
    const lines = [
        divider,
        '🧠 التقرير الذكي «وين الزيادة؟»',
        `${weekdayAr(day)} ${day}`.trim(),
        '',
        ...weekBlock(week),
        '',
        ...increasesBlock(week, month),
        '',
        ...monthBlock(month),
        '',
        ...reductionBlock(week),
        ...recommendationBlock(week),
        divider,
        'كاريم ERP · تحليل حتمي من بيانات النظام — الرقم أمانة',
    ];
    return lines.filter((l) => l !== null && l !== undefined).join('\n');
}

module.exports = { formatSmartReport, weekBlock, monthBlock, increasesBlock, reductionBlock, recommendationBlock };
