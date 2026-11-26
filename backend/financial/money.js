'use strict';
/**
 * money.js — حساسات مالية بلا أرقام عائمة ولا تبعية جديدة (Stage 3).
 * كل مبلغ يُحوَّل إلى «سنتات» BigInt قبل أي جمع/طرح، ثم يُقارَن بالضبط.
 * قاعدة البيانات NUMERIC(14,2) ⇒ أي كسر ثالث غير صفري خطأ وليس تقريبًا صامتًا.
 */
function toCents(value) {
    if (value === null || value === undefined || value === '') {return 0n;}
    const text = String(value).trim();
    const match = /^([+-]?)(\d*)(?:\.(\d{0,2})(\d*))?$/.exec(text);
    if (!match || (!match[2] && !match[3])) {
        throw Object.assign(new Error('INVALID_MONEY'), { code: 'INVALID_MONEY' });
    }
    if (match[4] && /[1-9]/.test(match[4])) {
        throw Object.assign(new Error('MONEY_PRECISION_LOSS'), { code: 'MONEY_PRECISION_LOSS' });
    }
    const sign = match[1] === '-' ? -1n : 1n;
    const whole = BigInt(match[2] || '0');
    const frac = BigInt((match[3] || '').padEnd(2, '0') || '0');
    return sign * (whole * 100n + frac);
}

/**
 * فحص توازن قيد بالسنتات.
 * @param {Array<{account_code?:string,debit?:any,credit?:any}>} lines
 */
function validateBalancedEntry(lines) {
    const rows = Array.isArray(lines) ? lines : [];
    if (rows.length < 2) {
        return { ok: false, reason: 'MIN_LINES', debitCents: 0n, creditCents: 0n, differenceCents: 0n };
    }
    let debitCents = 0n;
    let creditCents = 0n;
    for (const row of rows) {
        if (!row || !String(row.account_code || '').trim()) {
            return { ok: false, reason: 'MISSING_ACCOUNT', debitCents, creditCents, differenceCents: debitCents - creditCents };
        }
        let d;
        let c;
        try {
            d = toCents(row.debit);
            c = toCents(row.credit);
        } catch (error) {
            return { ok: false, reason: error.code || 'INVALID_MONEY', debitCents, creditCents, differenceCents: debitCents - creditCents };
        }
        if (d < 0n || c < 0n || (d > 0n && c > 0n) || (d === 0n && c === 0n)) {
            return { ok: false, reason: 'INVALID_LINE', debitCents, creditCents, differenceCents: debitCents - creditCents };
        }
        debitCents += d;
        creditCents += c;
    }
    const differenceCents = debitCents - creditCents;
    return { ok: differenceCents === 0n, reason: differenceCents === 0n ? null : 'UNBALANCED', debitCents, creditCents, differenceCents };
}

/** كمية بثلاثة منازل عشرية إلى «ملي-وحدات» BigInt (inventory.qty NUMERIC(10,3)). */
function toMillis(value) {
    if (value === null || value === undefined || value === '') {return 0n;}
    const text = String(value).trim();
    const match = /^([+-]?)(\d*)(?:\.(\d{0,3})(\d*))?$/.exec(text);
    if (!match || (!match[2] && !match[3])) {
        throw Object.assign(new Error('INVALID_QUANTITY'), { code: 'INVALID_QUANTITY' });
    }
    if (match[4] && /[1-9]/.test(match[4])) {
        throw Object.assign(new Error('QUANTITY_PRECISION_LOSS'), { code: 'QUANTITY_PRECISION_LOSS' });
    }
    const sign = match[1] === '-' ? -1n : 1n;
    return sign * (BigInt(match[2] || '0') * 1000n + BigInt((match[3] || '').padEnd(3, '0') || '0'));
}

/**
 * متوسط تكلفة مرجّح بالسنتات — BigInt بالكامل، تقريب بنصف وحدة لأعلى.
 * @returns {bigint} متوسط التكلفة بالسنتات
 */
function movingAverageCents(oldQty, oldAvgCost, addedQty, addedCost) {
    const q0 = toMillis(oldQty);
    const q1 = toMillis(addedQty);
    const c0 = toCents(oldAvgCost);
    const c1 = toCents(addedCost);
    const denominator = q0 + q1;
    if (denominator <= 0n) {return 0n;}
    const numerator = q0 * c0 + q1 * c1;
    return (numerator + denominator / 2n) / denominator;
}

/** فحص ظلّي: هل انحرف المتوسط المحسوب بالعوائم عن القيمة الدقيقة بأكثر من سنت؟ */
function avgCostDrift(oldQty, oldAvgCost, addedQty, addedCost, observedAvg) {
    const exact = movingAverageCents(oldQty, oldAvgCost, addedQty, addedCost);
    let observed;
    try { observed = toCents(observedAvg); } catch (_) { return { exact, driftCents: null, drifted: true }; }
    const diff = observed - exact;
    return { exact, driftCents: diff, drifted: diff > 1n || diff < -1n };
}

/** يعطي صفرًا عند التساوي؛ يُستخدم للفحص الظلّي بلا تغيير سلوك الترحيل. */
function isToleratedButUnbalanced(lines, toleranceCents = 1n) {
    let dr = 0;
    let cr = 0;
    for (const row of Array.isArray(lines) ? lines : []) {
        dr += Number(row?.debit) || 0;
        cr += Number(row?.credit) || 0;
    }
    const exact = validateBalancedEntry(lines);
    const withinTolerance = BigInt(Math.round(Math.abs(dr - cr) * 100)) <= toleranceCents;
    return !exact.ok && withinTolerance;
}

module.exports = { toCents, toMillis, validateBalancedEntry, isToleratedButUnbalanced, movingAverageCents, avgCostDrift };
