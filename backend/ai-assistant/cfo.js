/**
 * ai-assistant/cfo.js — مراجعة المدير المحاسبي: أرقام النظام الحيّة
 * ══════════════════════════════════════════════════════════════════════
 * لماذا هذا الملف: المالك يريد «مديرًا محاسبيًا يراجع كل الأرقام» — لا
 * شاشاتَ إضافية، بل قراءةٌ واحدة تجمع أرقام اليوم وتقول: أين الربح،
 * أين التسرّب، وما الذي يستحق قرارًا الآن.
 *
 * القاعدة الحاكمة: الأرقام من النظام فقط. لا تقدير ولا استنتاج رقمي
 * هنا — التفسير يأتي من النموذج (Gemini) على هذه الأرقام وحدها، وإن لم
 * يتوفّر النموذج تُعرض الحقائق كما هي (الوضع القواعدي).
 *
 * كل رقم مُجمَّع من مجمّعات النظام القائمة (لا استعلامات جديدة):
 *   · collectDailyReport  → مبيعات اليوم، الأقسام، طرق الدفع، المصروفات
 *   · collectBriefing     → مبيعات أمس للمقارنة، الورديات، الحضور، المخزون
 *   · pos_day_closes      → إقفال اليوم وفرق الكاش
 */
'use strict';

const { collectDailyReport } = require('../daily-report-service');
const { collectBriefing } = require('../manager-briefing');
const { riyadhToday } = require('../riyadh-date');

/* حدود الإنذار — قابلة للضبط من البيئة، وقيمها معقولة لمطعم متوسط. */
const LIMITS = {
    variance: Number(process.env.CFO_VARIANCE_LIMIT || 50),      // فرق كاش مقبول (ر.س)
    expenseRatio: Number(process.env.CFO_EXPENSE_RATIO || 0.15), // مصروفات ÷ إيرادات
    salesDrop: Number(process.env.CFO_SALES_DROP || 0.2),        // هبوط مبيعات مقبول
    coverDays: Number(process.env.CFO_COVER_DAYS || 3),          // أيام تغطية مخزون
};

const num = (v) => Number(v || 0);
const money = (v) => num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * يجمع أرقام اليوم ويقارنها بالأمس، ثم يشتقّ إنذارات القاعدة.
 * @param {any} pool
 * @param {string} [day] يوم العمل (Asia/Riyadh) — الافتراضي اليوم
 * @returns {Promise<{facts:string[], alerts:string[], day:string, lines:string[]}>}
 */
async function collectCfoReview(pool, day = riyadhToday()) {
    const [report, brief, close, openShifts, series, lastClose, negStock, gaps] = await Promise.all([
        collectDailyReport(pool, day).catch((e) => ({ error: String(e.message).slice(0, 120) })),
        collectBriefing(pool, day).catch((e) => ({ error: String(e.message).slice(0, 120) })),
        pool.query(
            'SELECT z_number, close_date, total_expected, total_actual, total_variance FROM pos_day_closes WHERE close_date = $1::date LIMIT 1',
            [day]
        ).catch(() => ({ rows: [] })),
        pool.query("SELECT COUNT(*)::int AS n FROM pos_shift_sessions WHERE status = 'open'").catch(() => ({ rows: [{ n: 0 }] })),
        // سلسلة ٧ أيام بمصدرين: نقاط البيع وسجل الإيرادات — للمقارنة بمصدر واحد
        // (revenues.date نصّي ⇒ يُقارن بالنص لا بالتاريخ)
        pool.query(`
            SELECT d::date AS day,
                   COALESCE((SELECT SUM(o.total_amount)::float FROM pos_orders o
                              WHERE o.status IN ('issued','reported')
                                AND (o.created_at AT TIME ZONE 'Asia/Riyadh')::date = d::date), 0) AS pos_total,
                   COALESCE((SELECT SUM(r.amount)::float FROM revenues r
                              WHERE r.date = d::date::text AND r."deptId" != 'ys_b4_ext'), 0) AS rev_total
              FROM generate_series((NOW() AT TIME ZONE 'Asia/Riyadh')::date - 6,
                                   (NOW() AT TIME ZONE 'Asia/Riyadh')::date, '1 day') AS d
             ORDER BY d`).catch((e) => ({ rows: [], error: String(e.message).slice(0, 120) })),
        // آخر إقفال مسجَّل — «منذ متى» سؤال المدقق الأول
        pool.query('SELECT MAX(close_date) AS last_close FROM pos_day_closes').catch(() => ({ rows: [{}] })),
        // الأصناف السالبة بقيمتها (الأثر على ثقة تكلفة البضاعة)
        pool.query(`SELECT name, unit, COALESCE(qty,0)::float AS qty, COALESCE("avgCost",0)::float AS avg_cost
                      FROM inventory WHERE COALESCE(qty,0) < 0 ORDER BY qty LIMIT 20`).catch(() => ({ rows: [] })),
        // فجوات الحضور: من تأثّر الرواتب
        pool.query(`SELECT a."employeeId" AS emp, LEFT(COALESCE(a.date,''),10) AS day,
                           a."checkIn" AS check_in, a."checkOut" AS check_out
                      FROM attendance a
                     WHERE LEFT(COALESCE(a.date,''),10) = $1
                       AND (("checkIn" IS NULL) OR ("checkOut" IS NULL))
                     LIMIT 20`, [day]).catch(() => ({ rows: [] })),
    ]);

    const posTotal = num(brief.pos && brief.pos.total);
    const posInvoices = num(brief.pos && brief.pos.invoices);
    const posYTotal = num(brief.posY && brief.posY.total);
    const cashTotal = num(brief.cashiersTotal && brief.cashiersTotal.total);
    const cashYTotal = num(brief.cashiersY && brief.cashiersY.total);
    const expenses = num(brief.expenses && brief.expenses.total);
    const expensesY = num(brief.expensesY && brief.expensesY.total);
    const attendance = brief.attendance || {};
    const pending = brief.pending || {};
    const z = (close.rows && close.rows[0]) || null;
    const openShiftsCount = num(openShifts.rows && openShifts.rows[0] && openShifts.rows[0].n);
    const revenueToday = cashTotal || posTotal;   // الإيراد المرجعي: الكاشير، وإلا POS
    const net = revenueToday - expenses;

    const lines = [];
    const facts = [];
    const alerts = [];

    const daysSince = (value) => {
        if (!value) {return null;}
        const iso = value instanceof Date ? value.toISOString() : String(value);
        const t = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
        if (Number.isNaN(t)) {return null;}
        const today = new Date(`${day}T00:00:00Z`).getTime();
        return Math.round((today - t) / 86400000);
    };
    const lastCloseDay = (lastClose.rows && lastClose.rows[0] && lastClose.rows[0].last_close) || null;
    const lastCloseIso = lastCloseDay instanceof Date ? lastCloseDay.toISOString().slice(0, 10) : (lastCloseDay ? String(lastCloseDay).slice(0, 10) : null);
    const sinceClose = daysSince(lastCloseDay);
    // نقاط البيع: هل تحرّكت أصلًا خلال الأسبوع؟ (إلا فـ«انفصال المصادر» إيجابية كاذبة)
    const posEverActive = (series.rows || []).some((r) => num(r.pos_total) > 0);
    // هل اكتمل اليوم؟ بعد العشاء (15:00) تكتمل一天的 مبيعات؛ وقبلها فاليوم
    // ناقصٌ وقياس «انخفاض المبيعات» ظلمٌ (يقارن جزءًا بكامل).
    const hourNow = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', hour12: false }).format(new Date()));
    const dayComplete = hourNow >= 15;
    const isoDay = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));

    lines.push(`## اليوم ${day} (Asia/Riyadh)`);
    lines.push('### الأرقام');
    lines.push(`- مبيعات نقاط البيع: ${money(posTotal)} ر.س (${posInvoices} فاتورة)`);
    lines.push(`- مبيعات الأمس (نفس المصدر): ${money(posYTotal)} ر.س`);
    lines.push(`- إيراد سجل الإيرادات (الكاشير): ${money(cashTotal)} ر.س — أمس: ${money(cashYTotal)} ر.س`);
    lines.push(`- المصروفات: ${money(expenses)} ر.س — أمس: ${money(expensesY)} ر.س`);
    lines.push(`- صافٍ تقديري (إيراد − مصروفات): ${money(net)} ر.س`);
    if (z) {
        lines.push(`- إقفال اليوم: Z${z.z_number} — متوقع ${money(z.total_expected)} · فعلي ${money(z.total_actual)} · فرق ${money(z.total_variance)} ر.س`);
    } else {
        lines.push(`- إقفال اليوم: لم يُقفل بعد${sinceClose != null ? ` (آخر إقفال: ${lastCloseIso} — قبل ${sinceClose} يوم)` : ''}`);
    }
    lines.push(`- ورديات مفتوحة: ${openShiftsCount}`);
    lines.push(`- الحضور (السجل الخام): ${num(attendance.with_record)} موظف مسجَّل · ${num(attendance.checked_in)} دخول · ${num(attendance.missing_out)} سطر بلا انصراف · ${num(attendance.missing_in)} بلا دخول`);
    lines.push(`- أصناف رصيدها سالب: ${(brief.stockOut || []).length} · تحت الحد الأدنى: ${(brief.stockLow || []).length} · تغطيتها أقل من ${LIMITS.coverDays} أيام: ${(brief.forecast || []).length}`);
    lines.push(`- معلّق: ${num(pending.leavesPending)} إجازة · ${num(pending.reviewItems)} مراجعة · ${num(pending.unmappedSections)} قسم غير مطابَق`);
    if (series.rows && series.rows.length) {
        lines.push('- آخر ٧ أيام (نقاط البيع | سجل الإيرادات): ' + series.rows.map((r) => `${isoDay(r.day).slice(5)} ${money(r.pos_total)} | ${money(r.rev_total)}`).join(' · '));
    }
    if (!dayComplete) {
        lines.push(`- اليوم غير مكتمل (الساعة ${hourNow}:00 الرياض) — لا مقارنة بالأمس قبل اكتماله.`);
    }
    if (series.error) {
        // قياسٌ فاشل يُعلن ولا يُخفى — وإلا بُني استنتاجٌ على قياسٍ ناقص.
        lines.push(`- تعذّر قياس السلسلة الأسبوعية: ${series.error}`);
    }
    if ((negStock.rows || []).length) {
        const value = negStock.rows.reduce((s, r) => s + Math.abs(num(r.qty) * num(r.avg_cost)), 0);
        lines.push(`- قيمة الأصناف السالبة (سالب × متوسط التكلفة): ${money(value)} ر.س — ${negStock.rows.slice(0, 8).map((r) => `${r.name} (${num(r.qty)} ${r.unit || ''})`).join('، ')}`);
    }
    if ((gaps.rows || []).length) {
        lines.push('- فجوات الحضور: ' + gaps.rows.map((g) => `موظف ${g.emp} دخول ${g.check_in || '—'} انصراف ${g.check_out || '—'}`).join('، '));
    }
    if ((brief.topItems || []).length) {
        lines.push('- الأعلى مبيعًا: ' + brief.topItems.slice(0, 5).map((t) => `${t.name || t.product_name || '—'} (${money(t.revenue ?? t.total)})`).join('، '));
    }
    if ((brief.departments || []).length) {
        lines.push('- الإيراد حسب القسم: ' + brief.departments.slice(0, 6).map((d) => `${d.name || d.deptId || '—'} ${money(d.total)}`).join('، '));
    }
    if (report.error) { lines.push(`- تعذّر جمع التقرير اليومي: ${report.error}`); }
    if (brief.error) { lines.push(`- تعذّر جمع الإحاطة: ${brief.error}`); }

    /* ── قواعد التدقيق (الأخطر أولًا) ────────────────────────────────── */
    // (١) انفصال المصادر: مبيعات POS صفر وسجل الإيرادات فيه رقم ⇒ تغطية
    //     المبيعات ناقصة — بشرط أن تكون نقاط البيع قد تحرّكت فعلًا خلال
    //     الأسبوع؛ وإلا فالمبيعات تأتي من YaraSoft وهذا وضعٌ طبيعي.
    if (posTotal === 0 && cashTotal > 0 && posEverActive) {
        alerts.push(`انفصال مصادر: نقاط البيع ${money(posTotal)} وسجل الإيرادات ${money(cashTotal)} — المبيعات غير مغطّاة بالكامل، وأي هامش يُبنى عليها مضلّل.`);
    } else if (posTotal === 0 && cashTotal > 0 && !posEverActive) {
        lines.push('- ملاحظة: نقاط البيع بلا حركة طوال الأسبوع — المبيعات مسجَّلة في سجل الإيرادات (قاعدة الكاشير). لا إنذار على ذلك.');
    }
    // (٢) صفر مبيعات في يوم تشغيل
    if (posTotal === 0 && cashTotal === 0) {
        alerts.push('لا مبيعات اليوم (نقاط البيع والكاشير صفر) — إما إغلاقٌ متعمّد أو توقف في البيع.');
    }
    // (٣) الإقفال: منذ متى
    if (!z) {
        alerts.push(`إقفال اليوم لم يُسجَّل${sinceClose != null ? ` — وآخر إقفال قبل ${sinceClose} يوم (${lastCloseIso})` : ''}: النقد غير محسوب.`);
    } else if (Math.abs(num(z.total_variance)) > LIMITS.variance) {
        alerts.push(`فرق الإقفال ${money(z.total_variance)} ر.س يتجاوز الحدّ (${LIMITS.variance}) — فرقٌ كبير يستحق المراجعة.`);
    }
    if (openShiftsCount > 0) {
        alerts.push(`${openShiftsCount} وردية مفتوحة — نقد لم يُقفل بعد.`);
    }
    // (٤) الحضور affecting الرواتب — مع استثناء الوردية الجارية:
    //     سطر دخل الساعة 03:53 وليس بعده انصرافٌ هو ورديةٌ تعمل الآن
    //     (تنتهي فجرًا) لا نقصٌ في السجل. النقص الحقيقي: سطر بلا انصراف
    //     مضى على دخوله أكثر من ١٢ ساعة (وردية كاملة) أو سطر انصراف بلا دخول.
    const nowMs = Date.now();
    const openShiftMinutes = (row) => {
        if (!row.check_in) {return null;}
        const t = new Date(`${day}T${row.check_in}:00Z`).getTime();
        return Number.isNaN(t) ? null : Math.round((nowMs - t) / 60000);
    };
    const staleOpen = (gaps.rows || []).filter((g) => {
        const mins = openShiftMinutes(g);
        return mins != null && mins > 12 * 60;      // أقدم من وردية كاملة
    });
    const missingIn = (gaps.rows || []).filter((g) => !g.check_in && g.check_out);
    const onShift = (gaps.rows || []).filter((g) => {
        const mins = openShiftMinutes(g);
        return mins != null && mins <= 12 * 60;
    });
    if (staleOpen.length > 0 || missingIn.length > 0) {
        alerts.push(`حضور ناقص يستوجب مراجعة الرواتب: ${staleOpen.length} سطر بلا انصراف بعد وردية كاملة${missingIn.length ? ` · ${missingIn.length} انصراف بلا دخول` : ''}.`);
    }
    if (onShift.length > 0) {
        lines.push(`- وردياتٌ جارية الآن (لا تُعدّ نقصًا): ${onShift.length}`);
    }
    // (٥) المخزون السالب ⇒ ثقة التكلفة مهدورة
    if ((negStock.rows || []).length > 0) {
        const value = negStock.rows.reduce((s, r) => s + Math.abs(num(r.qty) * num(r.avg_cost)), 0);
        alerts.push(`${negStock.rows.length} صنف رصيده سالب بقيمة ${money(value)} ر.س — الاستهلاك بلا صرف، فالتكلفة المباعة غير موثوقة.`);
    }
    if ((brief.forecast || []).length > 0) {
        alerts.push(`${brief.forecast.length} صنف تغطيته أقل من ${LIMITS.coverDays} أيام — سيتوقف البيع.`);
    }
    // (٦) مقارنة بمصدر واحد: POS مع POS فقط — ويومٌ غير مكتمل لا يُقارَن
    if (dayComplete && posYTotal > 0 && posTotal < posYTotal * (1 - LIMITS.salesDrop)) {
        alerts.push(`مبيعات نقاط البيع انخفضت ${Math.round((1 - posTotal / posYTotal) * 100)}% عن أمس (حدّ الإنذار ${Math.round(LIMITS.salesDrop * 100)}%) — مقارنة بمصدر واحد.`);
    }
    if (dayComplete && cashYTotal > 0 && cashTotal < cashYTotal * (1 - LIMITS.salesDrop)) {
        alerts.push(`إيراد سجل الإيرادات انخفض ${Math.round((1 - cashTotal / cashYTotal) * 100)}% عن أمس (حدّ الإنذار ${Math.round(LIMITS.salesDrop * 100)}%) — مقارنة بمصدر واحد.`);
    }
    // (٧) المصروفات: الصفر المشبوه
    if (expenses === 0 && revenueToday > 0) {
        alerts.push('المصروفات صفر في يوم تشغيل — إمّا لم تُسجَّل مصروفات أو سلسلة تسجيلها ناقصة.');
    }
    if (revenueToday > 0 && expenses > revenueToday * LIMITS.expenseRatio) {
        alerts.push(`المصروفات ${Math.round((expenses / revenueToday) * 100)}% من الإيراد — فوق الحدّ (${Math.round(LIMITS.expenseRatio * 100)}%).`);
    }
    if (num(pending.reviewItems) > 0 || num(pending.unmappedSections) > 0) {
        alerts.push(`${num(pending.reviewItems)} مراجعة و${num(pending.unmappedSections)} قسم غير مطابَق لم تُحسم — أرقام الفروع غير مكتملة.`);
    }

    facts.push('قياسات النظام (المصدر الوحيد للأرقام):');
    for (const l of lines) {facts.push(l);}
    if (alerts.length) {
        facts.push('إنذارات القاعدة (مرتّبة الأخطر أولًا):');
        for (const a of alerts) {facts.push('- ' + a);}
    } else {
        facts.push('إنذارات القاعدة: لا شيء — الأرقام سليمة.');
    }

    return { day, facts: facts.join('\n'), alerts, lines };
}

/** ذاكرة قصيرة للمراجعة: سؤالٌ متكرّر لا يعيد الحساب. */
let cache = { at: 0, day: null, review: null };
const CACHE_MS = Number(process.env.CFO_CACHE_MS || 180000);
const DEADLINE_MS = Number(process.env.CFO_DEADLINE_MS || 12000);

/**
 * المراجعة بجهدٍ محدود: ميزانيةُ وقتٍ صارمة (لا انتظار خلف مزامنة
 * YaraSoft الثقيلة) وذاكرة قصيرة. فإن تعذّر الفحص: يُقال ذلك صراحةً ولا
 * تُفتعل أرقام.
 *
 * ملاحظة: تُجمع الاستعلامات عبر **المجموعة** (لا عميل واحد) — فالعميل
 * الواحد لا يقبل استعلامات متوازية (سباقٌ يُنتج نتائج ناقصة).
 * @param {any} pool
 * @param {string} [day]
 */
async function cfoReview(pool, day = riyadhToday()) {
    if (cache.day === day && cache.review && Date.now() - cache.at < CACHE_MS) {return cache.review;}
    const deadline = new Promise((resolve) => {
        const timer = setTimeout(() => resolve({
            day,
            facts: `تعذّر جمع المراجعة المالية ضمن ${Math.round(DEADLINE_MS / 1000)} ثوانٍ (القاعدة مشغولة بمزامنة المبيعات) — أعد المحاولة بعد قليل.`,
            alerts: [],
            lines: [],
            degraded: true,
        }), DEADLINE_MS);
        if (typeof timer.unref === 'function') {timer.unref();}
    });
    try {
        const review = await Promise.race([collectCfoReview(pool, day), deadline]);
        if (!review.degraded) {cache = { at: Date.now(), day, review };}
        return review;
    } catch (e) {
        return {
            day,
            facts: `تعذّر جمع المراجعة المالية: ${String(e && e.message ? e.message : e).slice(0, 140)}`,
            alerts: [],
            lines: [],
            degraded: true,
        };
    }
}

module.exports = { collectCfoReview, cfoReview, LIMITS };
