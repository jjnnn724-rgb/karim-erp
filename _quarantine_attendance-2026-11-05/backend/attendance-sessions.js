'use strict';
/**
 * attendance-sessions.js — محرّك الجلسات: البصمة حدث، واليوم ناتج
 * ═══════════════════════════════════════════════════════════════════════════
 * المشكلة التي يُنهيها هذا الملف (موثّقة في docs/ATTENDANCE-ROOT-FIX.md):
 * كان اتجاه البصمة (دخول/انصراف) يُقرأ لحظة وصولها من `punchState` أو من
 * وجود صف مفتوح — قرارٌ لا رجعة فيه، فبصمةٌ واحدة فجرًا صارت «دخول اليوم
 * التالي» وبقي أمسها مفتوحًا، ثم جاءت الترقيعات («إصلاح اقتران»، «تفريغ
 * اقتران تالف») لتمحو الأثر.
 *
 * المبدأ هنا:
 *   ١. البصمة **عمياء**: (لحظة + مصدر + دليل). لا تحمل اتجاهًا ولا تكتب صفًّا.
 *   ٢. اليوم يُبنى **مرة واحدة** من كل بصماته بدالةٍ نقية: ترتيب زمني ← أقرب
 *      اقترانٍ ممكن للتكلفة (DP) ← جلسات ← مقاييس (١٢/١٠ ساعات).
 *   ٣. البناء **idempotent**: نفس البصمات ⇒ نفس الجلسات ⇒ نفس الصف، دائمًا.
 *      فإعادة البناء ترقيعٌ ممنوع، بل إعادةُ حسابٍ لا تتغيّر نتيجتها.
 *
 * القواعد الصلبة (لا تُخالَف):
 *   R1 لا انصراف مُختلَق: بصمةٌ وحيدة ⇒ يومٌ مفتوح `awaiting_out`، لا إغلاق.
 *   R2 ٦٠ دقيقة ≥ مدة الجلسة ≤ ٢٣:٢٠ ساعة (1400 د) — ما فوقها ليس وردية.
 *   R3 دخول ثم خروج خلال ٥ دقائق = ضغطة مزدوجة ⇒ تُهمَل وتُعلَّم.
 *   R4 يوم الوردية من **الوردية** لا من ساعة الحائط: نافذة البصمات تُحسب من
 *      لحظة بداية الوردية حتى نهايتها + سماح، فالوردية العابرة للمنتصف تبقى
 *      يومًا واحدًا.
 *   R5 كل بصمة تُستهلك مرة واحدة بالضبط أو تُفسَّر بسببها (لا بصمة تُهمَل صامتة).
 *
 * طبقة الحوكمة (G1–G4) — «لا يوم ينهار لأي موظف»:
 *   G1 **الوردية تُستنتج من البصمات** إذا لم تُفسّرها الوردية المسجّلة
 *      (إعدادٌ خاطئ، أو دوامٌ تغيّر، أو موظف بلا وردية). الاستنتاج محصورٌ في
 *      نطاقٍ ضيّق حول الإعداد حتى لا يسرق بصمات يومٍ مجاور.
 *   G2 **حدود مرنة** إذا كانت البصمتان موجودتين لكن المدة خارج ٦٠د–٢٣:٢٠س
 *      (دوامٌ قصير أو استمرارٌ طويل): تُحسب الجلسة وتُعلَّم `loose` للمراجعة.
 *   G3 **صفٌّ جزئي بدل الانهيار**: بصمةٌ وحيدة تُكتب في طرفها الصحيح
 *      (دخولٌ أو انصراف) بساعات `null` — لا اختراع ولا اختفاء.
 *   G4 كل انحرافٍ يُسجَّل في `governance` (قاعدة + وردية مستخدمة) ليُقرأ في
 *      التدقيق ولا يمرّ صامتًا.
 *
 * الملف نقيّ: لا قاعدة بيانات، لا وقت حالي — يُختبر كدالةٍ رياضية.
 */

/** وردية الرياض: UTC+3 بلا تغيير موسمي (نفس ثابت المحرك). */
const BUSINESS_TZ_OFFSET_MS = 3 * 60 * 60 * 1000;

const MIN_SESSION_MIN = 60;        // أقل من ساعة ليست وردية (الوضع الصارم)
const MAX_SESSION_MIN = 1400;      // ٢٣:٢٠ ساعة — ما فوقها اقتران خاطئ (حصار المحرك)
const SAME_PRESS_MIN = 5;          // لمسة واحدة يمرّ بها الجهاز دخولًا ثم خروجًا
const DEFAULT_KARIM = 12;

/** حدود الحوكمة G2: أقصر زيارةٍ حقيقية وأطول استمرارٍ معقول. */
const LOOSE_MIN_SESSION_MIN = 5;
const LOOSE_MAX_SESSION_MIN = 26 * 60;
/** شبكة استنتاج الوردية (G1): مرساة كل بصمة، مقرّبة إلى ١٥ دقيقة. */
const INFER_STEP_MIN = 15;
/** سماح G1: الاقتران المستنتج يجب أن يقارب الدوام المطلوب (±ساعتين). */
const INFER_PAIR_TOL_MIN = 120;

/** حالة الجهاز → اتجاه مقترح (تلميحٌ للترجيح، لا حكم). */
const IN_STATES = new Set([0, 2, 4]);
const OUT_STATES = new Set([1, 3, 5]);

/** تكلفة ترك بصمةٍ بلا مقابل (بالساعات) — مرتفعة كي لا تُهمَل الأدلة. */
const ORPHAN_COST = 25;
/** مكافأة/عقوبة تطابق تلميح الجهاز (بالساعات). */
const HINT_BONUS = 1;
const HINT_MISMATCH = 2;
/** سماح الوردية: بصمات تصل قبل البداية/بعد النهاية. */
const PRE_WINDOW_MIN = 6 * 60;     // تفتح النافذة ٦ ساعات قبل الوردية
const POST_WINDOW_MIN = 3 * 60;    // وتُغلق ٣ ساعات بعد نهايتها

const pad2 = (n) => String(n).padStart(2, '0');

/** 'HH:MM' → دقائق من منتصف الليل (أو null). */
function toMin(hhmm) {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {return null;}
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) {return null;}
    return h * 60 + mi;
}

/** دقائق → 'HH:MM' (تدور على ٢٤ ساعة). */
function toHHMM(min) {
    const v = ((Math.round(min) % 1440) + 1440) % 1440;
    return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`;
}

/** 'YYYY-MM-DD' + دقائق اليوم → لحظة مطلقة (epoch ms) بتوقيت الرياض. */
function instantOf(shiftDate, minutesOfDay) {
    const [y, m, d] = String(shiftDate).split('-').map(Number);
    return Date.UTC(y, m - 1, d, 0, 0, 0) + (minutesOfDay * 60000) - BUSINESS_TZ_OFFSET_MS;
}

/** لحظة مطلقة → {shiftDate المقابل بتوقيت الرياض, دقائق اليوم}. */
function wallOf(ms) {
    const shifted = new Date(Number(ms) + BUSINESS_TZ_OFFSET_MS);
    const date = `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
    return { date, minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

/**
 * نافذة يوم الوردية: من بدايتها (٦ ساعات قبل) إلى نهايتها + ٣ ساعات.
 * كل بصمة داخل النافذة تنتمي لهذا اليوم — لا لليوم التقويمي.
 */
function dayWindow({ shiftDate, shiftStart, karim }) {
    const startMin = toMin(shiftStart);
    const lengthMin = (Number(karim) > 0 ? Number(karim) : DEFAULT_KARIM) * 60;
    if (startMin == null) {
        return { startMs: null, endMs: null, fromMs: null, toMs: null, lengthMin };
    }
    const startMs = instantOf(shiftDate, startMin);
    const endMs = startMs + lengthMin * 60000;
    return {
        startMs, endMs, lengthMin,
        fromMs: startMs - PRE_WINDOW_MIN * 60000,
        toMs: endMs + POST_WINDOW_MIN * 60000,
    };
}

/** تطبيع بصمةٍ خامة إلى {at, state, source, deviceId}. */
function normalizePunch(p) {
    const at = p && p.at != null ? Number(p.at) : (p && p.instant != null ? Number(p.instant) : NaN);
    if (!Number.isFinite(at)) {return null;}
    const rawState = p.state != null ? p.state : (p.punchState != null ? p.punchState : null);
    const state = rawState == null || rawState === '' ? null : Number(rawState);
    return {
        at,
        state: Number.isFinite(state) ? state : null,
        source: p.source ? String(p.source) : 'device',
        deviceId: p.deviceId != null ? String(p.deviceId) : null,
    };
}

/** تلميح اتجاه الجهاز للبصمة: 'in' | 'out' | null. */
function deviceHint(state) {
    if (state == null) {return null;}
    if (IN_STATES.has(state)) {return 'in';}
    if (OUT_STATES.has(state)) {return 'out';}
    return null;
}

/**
 * تكلفة اقتران بصمتين كجلسة (بالساعات). Infinity = اقتران غير صالح.
 * التكلفة = بعد المدة عن الدوام المطلوب + عقوبة تلميحٍ مخالف + عقوبة فتحٍ مبكّر جدًا.
 * `relaxed` (G2) يوسّع حدود المدة ويلغي عقوبة الفتح المبكّر — للحوكمة فقط.
 */
function pairCost(inP, outP, ctx, relaxed = false) {
    const durMin = (outP.at - inP.at) / 60000;
    const loMin = relaxed ? LOOSE_MIN_SESSION_MIN : MIN_SESSION_MIN;
    const hiMin = relaxed ? LOOSE_MAX_SESSION_MIN : MAX_SESSION_MIN;
    if (!(durMin >= loMin) || durMin > hiMin) {return Infinity;}
    let cost = Math.abs(durMin - ctx.requiredMin) / 60;
    const hi = deviceHint(inP.state), ho = deviceHint(outP.state);
    if (hi === 'in') {cost -= HINT_BONUS;} else if (hi === 'out') {cost += HINT_MISMATCH;}
    if (ho === 'out') {cost -= HINT_BONUS;} else if (ho === 'in') {cost += HINT_MISMATCH;}
    if (!relaxed) {
        // دخول قبل الوردية بأكثر من ٣ ساعات: يومٌ آخر تسرّب إلى هذه النافذة
        const leadMin = (ctx.startMs - inP.at) / 60000;
        if (leadMin > 180) {cost += (leadMin - 180) / 60;}
    }
    return cost;
}

/**
 * يختار الاقتران الأقل تكلفة لكل البصمات (DP على البادئة).
 * @returns {{pairs:Array<{inP:object,outP:object,cost:number}>, orphans:Array<object>, cost:number}}
 */
function optimizePairs(punches, ctx, relaxed = false) {
    const n = punches.length;
    // مصفوفة تكلفة مسبقة: الاقتران (k,j) لا يغيّر تكلفته بحسب السياق.
    const pairCostAt = Array.from({ length: n }, () => new Array(n).fill(Infinity));
    for (let k = 0; k < n; k += 1) {
        for (let j = k + 1; j < n; j += 1) {pairCostAt[k][j] = pairCost(punches[k], punches[j], ctx, relaxed);}
    }
    const memoCost = new Array(n + 1).fill(0);
    const memoChoice = new Array(n + 1).fill(null);
    // f(k): أقل تكلفة من البصمة k حتى النهاية
    for (let k = n - 1; k >= 0; k -= 1) {
        // خيار ١: ترك البصمة k بلا مقابل
        let best = ORPHAN_COST + memoCost[k + 1];
        let choice = { kind: 'orphan' };
        // خيار ٢: اقترانها بكل بصمة لاحقة ممكنة — **والبصمات الوسيطة تُحسب
        // يتيمة**: الاقتران البعيد لا يمحو الأدلة التي بينهما (كانت تُسقط
        // صامتة، فكان اقتران ٢٢:٤٥–٢٣:٣٠ يختفي بلا أثر).
        for (let j = k + 1; j < n; j += 1) {
            const c = pairCostAt[k][j];
            if (!Number.isFinite(c)) {continue;}
            const total = c + (ORPHAN_COST * (j - k - 1)) + memoCost[j + 1];
            if (total < best) {best = total; choice = { kind: 'pair', j, cost: c };}
        }
        memoCost[k] = best;
        memoChoice[k] = choice;
    }

    const pairs = [];
    const orphans = [];
    let k = 0;
    while (k < n) {
        const choice = memoChoice[k];
        if (choice && choice.kind === 'pair') {
            // البصمات الوسيطة دليلٌ محفوظ لا يُسقط صامتًا (تُحسب تكلفتها في DP).
            for (let mid = k + 1; mid < choice.j; mid += 1) {orphans.push(punches[mid]);}
            pairs.push({ inP: punches[k], outP: punches[choice.j], cost: choice.cost });
            k = choice.j + 1;
        } else {
            orphans.push(punches[k]);
            k += 1;
        }
    }
    return { pairs, orphans, cost: memoCost[0] };
}

/**
 * محاولة بناء واحدة على نافذةٍ محدّدة.
 * @returns {{win:object, pairs:Array, orphans:Array, cost:number, samePress:Array, used:Array}}
 */
function attemptWindow(punches, win, requiredMin, relaxed = false) {
    // ضغطة مزدوجة (R3): بصمتان متتاليتان يفصلهما ≤ ٥ دقائق بنفس تلميح الجهاز
    // = محاولة قراءة مكرّرة، لا جلسة. تُعلَّم وتُهمَل قبل المحسّن.
    const samePress = [];
    const candidate = [];
    for (const p of punches) {
        const prev = candidate[candidate.length - 1];
        if (prev && p.at - prev.at <= SAME_PRESS_MIN * 60000
            && deviceHint(prev.state) === deviceHint(p.state)) {
            samePress.push(p);
            continue;
        }
        candidate.push(p);
    }
    const ctx = { requiredMin, startMs: win.startMs, endMs: win.endMs };
    const { pairs, orphans, cost } = optimizePairs(candidate, ctx, relaxed);
    return { win, pairs, orphans, cost, samePress, used: candidate };
}

/**
 * G1: تستنتج بداية ورديةٍ تُفسّر بصمات اليوم حين تفشل الوردية المسجّلة.
 * المراسي مرشّحة في ±٣ ساعات حول الإعداد (أو حول أول بصمةٍ إن غاب الإعداد).
 * @returns {{win:object, attempt:object, startMin:number}|null}
 */
function inferShift({ punches, shiftDate, karim, requiredMin, configuredStart }) {
    // المراسي: وردية الموظف المسجّلة + كل بصمةٍ **تقع في يومها** (وردية اليوم
    // تبدأ في يومها). بصمة اليوم السابق/التالي لا تُقترح مرساة، فلا يسرق يومٌ بصمة جاره.
    const anchors = [];
    if (configuredStart != null) {anchors.push(configuredStart);}
    for (const p of punches) {
        const w = wallOf(p.at);
        if (w.date !== shiftDate) {continue;}
        anchors.push(Math.round(w.minutes / INFER_STEP_MIN) * INFER_STEP_MIN);
    }
    const seen = new Set();
    let best = null;
    for (const rawStart of anchors) {
        const startMin = ((rawStart % 1440) + 1440) % 1440;
        const key = Math.round(startMin);
        if (seen.has(key)) {continue;}
        seen.add(key);
        const win = dayWindow({ shiftDate, shiftStart: toHHMM(startMin), karim });
        if (win.fromMs == null) {continue;}
        const inside = punches.filter((p) => p.at >= win.fromMs && p.at <= win.toMs);
        if (inside.length < 2) {continue;}
        const attempt = attemptWindow(inside, win, requiredMin, false);
        if (!attempt.pairs.length) {continue;}
        // بوابة القبول — على الدليل لا على النافذة المسجّلة وحدها: النافذة
        // المسجّلة قد تكون هي الخطأ (واقعة EMP-114: مسجّل 13:00 ويعمل
        // 04:45→16:45، فكانت البوابة القديمة ترفض الوردية الصحيحة وتُبقي
        // اليوم مقلوبًا: 16:40 «دخولًا» و04:47 «انصرافًا»).
        // القيد: مدةٌ تقارب الدوام المطلوب، وتلميحا الجهاز لا يقولان «خروج ثم
        // دخول». فبصمةُ انصرافِ الأمس (تلميحها خروج، ومداها بعيد عن المطلوب)
        // لا تصلح دخولًا، والاقتران المقلوب يُرفض.
        const leadPair = attempt.pairs[0];
        const pairMin = (leadPair.outP.at - leadPair.inP.at) / 60000;
        if (Math.abs(pairMin - requiredMin) > INFER_PAIR_TOL_MIN) {continue;}
        if (deviceHint(leadPair.inP.state) === 'out' || deviceHint(leadPair.outP.state) === 'in') {continue;}
        // ترجيحٌ طفيف للوردية المسجّلة: لا نبتعد عنها إلا إن كان التفسير أفضل.
        const drift = configuredStart == null ? 0 : Math.abs(startMin - configuredStart) / 60;
        const score = attempt.cost + attempt.orphans.length * ORPHAN_COST + drift * 0.05;
        if (!best || score < best.score) {
            best = { win, attempt, startMin, score };
        }
    }
    return best;
}

/**
 * يبني يومًا كاملًا من بصماتٍ خامة.
 * @param {object} args
 * @param {Array} args.punches بصمات خامة (أي ترتيب — تُرتَّب هنا)
 * @param {string} args.shiftDate 'YYYY-MM-DD' ليوم الوردية
 * @param {string} args.shiftStart 'HH:MM' (قد يكون null ⇒ تُستنتج)
 * @param {number} args.karim ساعات الدوام المطلوبة (10 / 12)
 * @param {number} args.graceMin سماح التأخير بالدقائق (قرار المالك: ١٥)
 * @returns {{status:string, sessions:Array, metrics:object, orphans:Array, window:object, cost:number, governance:object, punches:Array}}
 */
function buildDay({ punches = [], shiftDate, shiftStart, karim, graceMin = 0 } = {}) {
    const karimN = Number(karim) > 0 ? Number(karim) : DEFAULT_KARIM;
    const grace = Number.isFinite(Number(graceMin)) && Number(graceMin) > 0 ? Number(graceMin) : 0;
    const requiredMin = Math.round(karimN * 60);
    const clean = punches.map(normalizePunch).filter(Boolean).sort((a, b) => a.at - b.at);
    const configuredStart = toMin(shiftStart);

    // ── موظفٌ بلا وردية: المرساة أول بصمة (G1) ──────────────────────────────
    let win = dayWindow({ shiftDate, shiftStart, karim });
    let governance = { rule: 'strict', shiftStart: configuredStart == null ? null : toHHMM(configuredStart) };
    if (win.startMs == null) {
        if (!clean.length) {
            return {
                status: 'no_shift', sessions: [], orphans: [], cost: 0, punches: [],
                governance: { rule: 'no_shift', shiftStart: null },
                window: { fromMs: null, toMs: null, startMs: null, endMs: null },
                metrics: { requiredMin, workedMin: 0, lateMin: 0, earlyMin: 0, balanceMin: 0, sessionCount: 0, late: false, earlyLeave: false },
            };
        }
        const anchor = wallOf(clean[0].at).minutes;
        win = dayWindow({ shiftDate, shiftStart: toHHMM(anchor), karim });
        governance = { rule: 'inferred_shift', shiftStart: toHHMM(anchor), note: 'لا وردية مسجّلة — المرساة أول بصمة' };
    }

    const inWindow = clean.filter((p) => p.at >= win.fromMs && p.at <= win.toMs);
    let attempt = attemptWindow(inWindow, win, requiredMin, false);
    let usedStartMin = configuredStart;

    // ── G1: الوردية المسجّلة لا تُفسّر البصمات ⇒ استنتاجها من البصمات ───────
    if (!attempt.pairs.length && clean.length >= 2) {
        const guess = inferShift({
            punches: clean, shiftDate, karim: karimN, requiredMin, configuredStart,
        });
        if (guess) {
            attempt = guess.attempt;
            win = guess.win;
            usedStartMin = guess.startMin;
            governance = {
                rule: 'inferred_shift',
                shiftStart: toHHMM(guess.startMin),
                shiftEnd: toHHMM(guess.startMin + requiredMin),
                configured: configuredStart == null ? null : toHHMM(configuredStart),
                note: 'وردية الموظف المسجّلة لا تُفسّر بصماته — استُنتجت من البصمات',
            };
        }
    }

    // ── G1ب: بصمةٌ وحيدة لا تشملها نافذة الوردية ⇒ تُثبت النافذة على البصمة ──
    // بصمةُ دخولٍ واحدة تسبق نافذة الوردية المسجّلة (وردية أُدخلت متأخرة أو
    // تبديلٌ لم يُسجَّل) كانت تُهمل، فلا يُكتب لها صفّ ويظهر الموظف غائبًا وقد
    // بصم (واقعة EMP-114: 04:42 يوم 2026-11-05). تُثبت النافذة على البصمة
    // **إن كانت تلمح دخولًا فقط**؛ بصمةُ انصرافِ ليلةٍ سابقة لا تُزحزح نافذة
    // اليوم ولا تُنشئ له صفًّا (R1: لا اختلاق، ولا استعارة لحظة يومٍ آخر).
    if (!attempt.pairs.length && !inWindow.length) {
        const ownIn = clean.find((p) => wallOf(p.at).date === shiftDate && deviceHint(p.state) === 'in');
        if (ownIn) {
            const anchor = Math.round(wallOf(ownIn.at).minutes / INFER_STEP_MIN) * INFER_STEP_MIN;
            const guessedWin = dayWindow({ shiftDate, shiftStart: toHHMM(anchor), karim: karimN });
            const inside = clean.filter((p) => p.at >= guessedWin.fromMs && p.at <= guessedWin.toMs);
            attempt = attemptWindow(inside, guessedWin, requiredMin, false);
            win = guessedWin;
            usedStartMin = ((anchor % 1440) + 1440) % 1440;
            governance = {
                rule: 'inferred_shift',
                configured: configuredStart == null ? null : toHHMM(configuredStart),
                note: 'الوردية المسجّلة لا تشمل بصمات اليوم — أُثبتت النافذة على أول بصمة دخول',
            };
        }
    }

    // ── G2: البصمتان موجودتان لكن المدة خارج الحدود ⇒ اقترانٌ مرن مُعلَّم ────
    if (!attempt.pairs.length && attempt.used.length >= 2) {
        const loose = attemptWindow(attempt.used, win, requiredMin, true);
        if (loose.pairs.length) {
            attempt = loose;
            governance = {
                ...governance,
                rule: 'loose',
                note: 'المدة خارج ٦٠د–٢٣:٢٠س — حُسبت الجلسة للمراجعة',
            };
        }
    }

    const { pairs, orphans, cost } = attempt;

    const sessions = pairs.map((p, i) => {
        const minutes = Math.round((p.outP.at - p.inP.at) / 60000);
        return {
            seq: i + 1,
            inAt: new Date(p.inP.at).toISOString(),
            outAt: new Date(p.outP.at).toISOString(),
            inHHMM: toHHMM(wallOf(p.inP.at).minutes),
            outHHMM: toHHMM(wallOf(p.outP.at).minutes),
            minutes,
            cost: Math.round(p.cost * 100) / 100,
            sources: [p.inP.source, p.outP.source],
        };
    });

    const workedMin = sessions.reduce((s, x) => s + x.minutes, 0);
    // قرار المالك 2026-11-03: ربع ساعة واحدة لليوم كله، تُستهلك من أول دخول أو
    // آخر انصراف معًا — نفس قاعدة shift-day.js حرفيًا.
    // قبل ذلك كان للدخول سماحٌ لكل جلسة (١٥ × عدد الجلسات) وللانصراف صفر سماح
    // (فخمس دقائق خروج كانت تُعلَّم). اليوم المصدر واحد.
    const firstInMs = pairs.length ? pairs[0].inP.at : null;
    const lastOutMs = pairs.length ? pairs[pairs.length - 1].outP.at : null;
    const arrivalRaw = firstInMs == null ? 0 : Math.max(0, Math.round((firstInMs - win.startMs) / 60000));
    const earlyRaw = lastOutMs == null ? 0 : Math.max(0, Math.round((win.endMs - lastOutMs) / 60000));
    const spent = arrivalRaw + earlyRaw;
    const withinBudget = spent <= grace;
    const lateMin = withinBudget ? 0 : arrivalRaw;
    const earlyMin = withinBudget ? 0 : earlyRaw;

    // الحالة: هل ثبت اليوم بدليل؟
    let status = 'closed';
    if (!sessions.length && !orphans.length) {status = 'empty';}
    else if (!sessions.length) {status = 'awaiting_out';}      // بصمة بلا مقابل — لا انصراف مُختلَق
    else if (orphans.length) {status = 'open_tail';}           // جلسة + بصمة زائدة (مراجعة)
    if (sessions.length && (workedMin < requiredMin - 15)) {status = 'short';}
    if (sessions.some((s) => s.minutes >= MAX_SESSION_MIN)) {status = 'review';}
    // G2: أي يومٍ حُسب بحدود مرنة يُعلَّم للمراجعة مهما كانت مدته.
    if (governance.rule === 'loose') {status = 'review';}

    return {
        status,
        sessions,
        orphans: orphans.map((p) => ({
            at: new Date(p.at).toISOString(),
            hhmm: toHHMM(wallOf(p.at).minutes),
            source: p.source,
            state: p.state,
        })),
        ignoredSamePress: attempt.samePress.map((p) => new Date(p.at).toISOString()),
        cost: Math.round(cost * 100) / 100,
        governance: { ...governance, shiftStart: usedStartMin == null ? null : toHHMM(usedStartMin) },
        /** بصمات اليوم بعد الترشيح — مصدر الصفّ الجزئي (G3). */
        punches: attempt.used.map((p) => ({
            at: p.at,
            hhmm: toHHMM(wallOf(p.at).minutes),
            state: p.state,
            source: p.source,
        })),
        window: {
            // اللحظات الرقمية أوّلًا: المستهلك (سكربت إعادة البناء) يقرأ النافذة
            // لحسابها لا لطباعتها — غيابها كان يُسقط كل يوم بصمت.
            fromMs: win.fromMs, toMs: win.toMs, startMs: win.startMs, endMs: win.endMs,
            from: new Date(win.fromMs).toISOString(),
            to: new Date(win.toMs).toISOString(),
            start: new Date(win.startMs).toISOString(),
            end: new Date(win.endMs).toISOString(),
        },
        metrics: {
            requiredMin,
            workedMin,
            graceMin: grace,
            lateMin,
            earlyMin,
            balanceMin: workedMin - requiredMin,
            sessionCount: sessions.length,
            late: lateMin > 0,
            earlyLeave: earlyMin > 0,
        },
    };
}

/**
 * G3: صفّ الحضور المشتق من اليوم — **لا يعود null أبدًا إذا وُجدت بصمة**.
 * بصمةٌ وحيدة تُكتب في طرفها (دخول/انصراف) بساعاتٍ null: لا اختراع، ولا يومٌ يختفي.
 * الطرفان يُكتبان لحظتين مع نصّهما: نصٌّ بلا لحظة يجعل اليوم مفتوحًا في كل
 * استعلام نافذة يعتمد على checkInAt/checkOutAt (واقعة EMP-091، نوفمبر 2026).
 */
function rowFromDay(day) {
    if (!day) {return null;}
    const { sessions, metrics } = day;
    if (sessions.length) {
        return {
            checkIn: sessions[0].inHHMM,
            checkOut: sessions[sessions.length - 1].outHHMM,
            checkInAt: sessions[0].inAt,
            checkOutAt: sessions[sessions.length - 1].outAt,
            workMinutes: metrics.workedMin,
            late: metrics.late,
            earlyLeave: metrics.earlyLeave,
            status: day.status,
        };
    }
    const punches = Array.isArray(day.punches) ? day.punches : [];
    if (!punches.length) {return null;}
    // طرف اليوم: **الزمن** هو الحكم (منتصف الوردية فاصل)، لا تلميح الجهاز:
    // أجهزة كثيرة ترسل الحالة معكوسة (ثبت عمليًا: بصمة ٠٤:٣٠ وصلت out)،
    // وتلميحٌ معكوس يحوّل دخول الصباح إلى انصراف. النصف الأول = دخول.
    const startMs = day.window && day.window.startMs;
    const endMs = day.window && day.window.endMs;
    const midMs = startMs != null && endMs != null ? (startMs + endMs) / 2 : null;
    const side = midMs == null ? 'in' : (punches[0].at > midMs ? 'out' : 'in');
    if (side === 'out') {
        return {
            checkIn: null, checkOut: punches[punches.length - 1].hhmm, workMinutes: null,
            checkInAt: null, checkOutAt: new Date(punches[punches.length - 1].at).toISOString(),
            late: false, earlyLeave: false, status: 'awaiting_in',
        };
    }
    return {
        checkIn: punches[0].hhmm, checkOut: null, workMinutes: null,
        checkInAt: new Date(punches[0].at).toISOString(), checkOutAt: null,
        late: metrics.lateMin > 0, earlyLeave: false, status: day.status === 'empty' ? 'awaiting_out' : day.status,
    };
}

module.exports = {
    buildDay,
    rowFromDay,
    dayWindow,
    inferShift,
    instantOf,
    wallOf,
    toMin,
    toHHMM,
    optimizePairs,
    pairCost,
    normalizePunch,
    deviceHint,
    MIN_SESSION_MIN,
    MAX_SESSION_MIN,
    LOOSE_MIN_SESSION_MIN,
    LOOSE_MAX_SESSION_MIN,
    SAME_PRESS_MIN,
    ORPHAN_COST,
    DEFAULT_KARIM,
};
