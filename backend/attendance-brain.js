/**
 * attendance-brain.js — محرك قرارات الحضور الذكي (محلي 100%، بلا إنترنت)
 * ────────────────────────────────────────────────────────────────────────────
 * يتعلم النمط الطبيعي لكل موظف (وسيط الدخول/الخروج ± انحراف، آخر 30 يومًا)
 * ويحسم البصمات الغامضة:
 *  • بصمة "خروج" بلا صف مفتوح في وقت الدخول المعتاد → دخول (زر الجهاز الخاطئ شائع)
 *  • بصمة مكررة خلال 5 دقائق → تجاهل
 *  • بصمة خارج النوافذ → القرار الاعتيادي + تصعيد مراجعة عند الثقة المنخفضة
 * كل قرار مثير (مخالف للجهاز أو ثقة < 0.85) يُسجَّل في attendance_decisions
 * بأسبابه — قابل للمراجعة والتراجع. لا يمسّ القيم الحقيقية أبدًا.
 */

'use strict';

const { pool } = require('./shared-pool');
const { logger } = require('./logger');

const IN_STATES = new Set([0, 2, 4]);
const OUT_STATES = new Set([1, 3, 5]);

function toMin(hhmm) {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** نمط الموظف: وسيط الدخول/الخروج من 30 يومًا مكتملة */
async function learnPattern(employeeId) {
    const { rows } = await pool.query(
        `SELECT "checkIn", "checkOut" FROM attendance
          WHERE "employeeId" = $1 AND "checkIn" IS NOT NULL AND "checkOut" IS NOT NULL
            AND checkin_inferred = false AND checkout_inferred = false
          ORDER BY date DESC LIMIT 30`,
        [employeeId]
    ).catch(() => ({ rows: [] }));
    const med = (arr) => {
        if (!arr.length) {return null;}
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
    };
    const ins = rows.map(r => toMin(r.checkIn)).filter(v => v != null);
    const outs = rows.map(r => {
        let v = toMin(r.checkOut);
        if (v == null) {return null;}
        const iv = toMin(r.checkIn);
        if (iv != null && v <= iv) {v += 24 * 60;} // ليلية
        return v;
    }).filter(v => v != null);
    return {
        samples: rows.length,
        medianIn: med(ins),
        medianOut: med(outs),
    };
}

/**
 * تصنيف بصمة: { action: 'in'|'out'|'ignore', confidence, reason, override }
 * override=true تعني مخالفة حالة الجهاز — تُسجَّل حتمًا.
 * lastPunch: {min, out} لآخر بصمة — التكرار يُتجاهل فقط بنفس الاتجاه.
 */
function classify({ punchState, wallMin, shiftStartMin, shiftEndMin, hasOpenRow, lastPunch, pattern }) {
    const deviceIn = IN_STATES.has(Number(punchState));
    const deviceOut = OUT_STATES.has(Number(punchState));
    const thisOut = deviceOut && !deviceIn;
    // بصمة مكررة بنفس الاتجاه خلال 5 دقائق → تجاهل (ارتداد إصبع/ضغط مزدوج)
    if (lastPunch && lastPunch.out === thisOut && Math.abs(wallMin - lastPunch.min) <= 5) {
        return { action: 'ignore', confidence: 0.95, reason: 'بصمة مكررة بنفس الاتجاه خلال 5 دقائق', override: false };
    }
    if (hasOpenRow) {
        // صف مفتوح: المنطق الاعتيادي (خروج يُغلق، دخول مكرر يُتجاهل لاحقًا)
        if (deviceOut) {return { action: 'out', confidence: 0.9, reason: 'صف مفتوح + حالة خروج', override: false };}
        return { action: 'in', confidence: 0.7, reason: 'صف مفتوح + حالة دخول', override: false };
    }
    // بلا صف مفتوح: أين تقع البصمة؟
    const near = (target, tol) => target != null && Math.abs(wallMin - target) <= tol;
    const patIn = pattern?.medianIn;
    const patOut = pattern?.medianOut != null ? pattern.medianOut % (24 * 60) : null;
    const inZone = near(shiftStartMin, 120) || near(patIn, 60);
    const outZone = near(shiftEndMin % (24 * 60), 180) || (patOut != null && near(patOut, 90));
    if (!deviceOut && (inZone || !outZone)) {
        return { action: 'in', confidence: inZone ? 0.9 : 0.6, reason: 'بلا صف مفتوح + وقت دخول', override: false };
    }
    if (deviceOut && inZone && !outZone) {
        // الحالة الذهبية: زر خروج بالخطأ صباحًا → دخول بثقة
        return { action: 'in', confidence: 0.85, reason: 'حالة الجهاز خروج لكن الوقت وقت دخول (زر خاطئ)', override: true };
    }
    if (outZone) {
        return { action: 'out', confidence: 0.85, reason: 'بلا صف مفتوح + وقت انصراف', override: !deviceOut };
    }
    return { action: 'out', confidence: 0.5, reason: 'خارج النوافذ — مراجعة بشرية مستحسنة', override: !deviceOut };
}

/** تسجيل القرارات المثيرة فقط (مخالِفة أو منخفضة الثقة) */
async function logDecision({ employeeId, date, decision, confidence, reason, punchState, deviceId }) {
    try {
        await pool.query(
            `INSERT INTO attendance_decisions (id, "employeeId", date, decision, confidence, reason, punch_state, device_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [Date.now() * 1000 + Math.floor(Math.random() * 999), employeeId, date, decision, confidence, reason, punchState, deviceId || null]
        );
    } catch (e) { logger.warn('[BRAIN] تعذر تسجيل القرار:', e.message); }
}

module.exports = { learnPattern, classify, logDecision, IN_STATES, OUT_STATES };
