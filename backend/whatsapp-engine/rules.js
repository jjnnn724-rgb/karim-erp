/**
 * whatsapp-engine/rules.js — منطق نقي قابل للاختبار: تطبيع + مطابقة + JID + backoff
 * ────────────────────────────────────────────────────────────────────────────
 * بلا اعتماد على قاعدة البيانات أو الشبكة — كل الدوال خالصة.
 */
'use strict';

/** تطبيع نص عربي/إنجليزي للمطابقة: تشكيل + تقليم + توحيد مسافات + همزات/ة-ه/ى-ي */
function normalizeText(s) {
    return String(s == null ? '' : s)
        .replace(/[ً-ٰٟ]/g, '')
        .replace(/[\s\u0640\u200c\u200d]+/g, ' ')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .trim()
        .toLowerCase();
}

/** مطابقة قاعدة على نص: exact | contains | command (أمر + باقي النص وسائط) */
function matchRule(rule, text) {
    const t = normalizeText(text);
    if (!t) {return null;}
    const p = normalizeText(rule.pattern);
    if (!p) {return null;}
    if (rule.match_type === 'exact') {
        return t === p ? { rule, args: '' } : null;
    }
    if (rule.match_type === 'contains') {
        return t.includes(p) ? { rule, args: '' } : null;
    }
    if (rule.match_type === 'command') {
        if (t === p) {return { rule, args: '' };}
        if (t.startsWith(p + ' ')) {return { rule, args: t.slice(p.length + 1).trim() };}
        return null;
    }
    return null;
}

/** أول قاعدة مطابقة حسب الأولوية (تُمرر مرتبة) */
function firstMatch(rules, text) {
    for (const r of rules || []) {
        if (r.enabled === false) {continue;}
        const hit = matchRule(r, text);
        if (hit) {return hit;}
    }
    return null;
}

/** التحقق من JID (خاص/مجموعة فقط — بلا بث). v7 يستخدم @lid للأرقام */
function isValidChatJid(jid) {
    if (typeof jid !== 'string') {return false;}
    const m = jid.match(/^([^@\s]+)@(s\.whatsapp\.net|g\.us|lid)$/);
    if (!m) {return false;}
    if (m[2] === 'g.us') {return true;}
    return /^\d{7,20}(:\d+)?$/.test(m[1]);
}
function isGroupJid(jid) { return typeof jid === 'string' && jid.endsWith('@g.us'); }
function isLidJid(jid) { return typeof jid === 'string' && jid.endsWith('@lid'); }
/** أرقام الهاتف من أي JID (يزيل لاحقة الجهاز :xx) */
function phoneDigitsOf(jid) {
    const u = String(jid || '').split('@')[0].split(':')[0];
    const d = u.replace(/\D/g, '');
    return d.length >= 7 ? d : '';
}

/** استخراج النص الآمن من حمولة Baileys (لا يفترض وجود نص) */
function extractText(msg) {
    try {
        const m = msg?.message;
        if (!m) {return '';}
        return String(
            m.conversation ||
            m.extendedTextMessage?.text ||
            ''
        ).slice(0, 4000);
    } catch (_) { return ''; }
}

/** backoff أسي مع jitter: base*2^(n-1) ±20% بحد أقصى maxMs */
function backoffDelayMs(attempt, baseMs, maxMs, rand = Math.random) {
    const n = Math.max(1, Math.min(10, Number(attempt) || 1));
    const raw = Math.min(maxMs, baseMs * 2 ** (n - 1));
    const jitter = raw * 0.2 * (rand() * 2 - 1);
    return Math.max(0, Math.round(raw + jitter));
}

// ─── درع الحظر: دوال نقية ──────────────────────────────────────────────

/** تحليل جدول التهيئة "20,40,80" → [20,40,80] (يتجاهل القيم الفاسدة، ≥1 عنصر) */
function parseSchedule(raw, fallback = [20]) {
    const list = String(raw || '').split(',')
        .map((x) => Math.round(Number(String(x).trim())))
        .filter((n) => Number.isFinite(n) && n > 0);
    return list.length ? list : fallback.slice();
}

/** السقف المسموح ليوم عمري معين (اليوم 1 = أول عنصر؛ الأخير سقف دائم) */
function scheduleAllowance(schedule, ageDays) {
    const s = Array.isArray(schedule) && schedule.length ? schedule : [20];
    const idx = Math.min(Math.max(1, Math.round(Number(ageDays) || 1)) - 1, s.length - 1);
    return s[idx];
}

/**
 * كشف القصف الجماعي: نفس البصمة لأكثر من threshold جهات مميزة داخل النافذة؟
 * recent: [{hash, jid, at}] — at بالمللي ثانية.
 */
function bulkFrozen(recent, bodyHash, nowMs, windowMs, threshold) {
    if (!bodyHash || !(threshold >= 2)) {return false;}
    const seen = new Set();
    for (const r of recent || []) {
        if (r && r.hash === bodyHash && (nowMs - Number(r.at || 0)) <= windowMs) {
            seen.add(String(r.jid));
            if (seen.size >= threshold) {return true;}
        }
    }
    return false;
}

/** فجوة بشرية قبل الإرسال: حد أدنى + jitter عشوائي */
function humanGapMs(minGapMs, jitterMs, rand = Math.random) {
    const base = Math.max(0, Number(minGapMs) || 0);
    const jit = Math.max(0, Number(jitterMs) || 0);
    return Math.round(base + rand() * jit);
}

/** بصمة نص للكشف الجماعي (تطبيع خفيف حتى لا تُكسر بمسافة زائدة) */
function bodyHash(text) {
    const norm = normalizeText(text).replace(/\d+/g, '#');
    let h = 5381;
    for (let i = 0; i < norm.length; i++) {h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;}
    return 'b' + h.toString(36);
}

module.exports = {
    normalizeText, matchRule, firstMatch, isValidChatJid, isGroupJid, isLidJid,
    phoneDigitsOf, extractText, backoffDelayMs,
    parseSchedule, scheduleAllowance, bulkFrozen, humanGapMs, bodyHash,
};
