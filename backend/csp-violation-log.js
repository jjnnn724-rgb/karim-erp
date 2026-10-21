/**
 * csp-violation-log.js — مصرف دائم لمخالفات CSP (ملف JSONL، بلا كتابة في القاعدة)
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا ملف وليس جدول في القاعدة:
 *   · القياس يستمر أسبوعًا، والخدمة تُعاد تشغيلها (نشر/تحديث) ⇒ العدّاد
 *     في الذاكرة يُفقد. الملف يبقى.
 *   · لا كتابة في قاعدة الإنتاج إطلاقًا (مبدأ "لا مساس بالبيانات أثناء القياس").
 *   · لا يحتوي بيانات شخصية: نخزّن المسار والتوجيه فقط، ونحذف الاستعلامات.
 *
 * آ��مان:
 *   · حدّ حجم للملف (الدوران: نحتفظ بملف سابق واحد فقط).
 *   · الكتابة غير متزامنة ولا تُسقط الطلب أبدًا (أخطاء الكتابة تُبتلع).
 *   · المسار يُنظَّف: يُحتفظ بالمسار فقط بلا استعلام ولا أصل.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const KEEP_ROTATIONS = 1;

/** يزيل الاستعلام والأصل ويبقي المسار فقط. */
function sanitizeUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) {return '';}
    try {
        const u = new URL(s);
        const p = u.pathname;
        return (p && p.length > 200 ? `${p.slice(0, 200)}…` : p) || '/';
    } catch (_) {
        // ليس URL كاملًا — نقبله كنص مع قطع الاستعلام
        const noQuery = s.split('?')[0];
        return noQuery.slice(0, 200);
    }
}

/**
 * ينشئ مصرف ملفات لمخالفات CSP.
 * @param {string} filePath مسار الملف (بدون الامتداد يُضاف .jsonl)
 * @param {{maxBytes?:number}} [options]
 */
function createCspViolationLog(filePath, options = {}) {
    const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : DEFAULT_MAX_BYTES;
    let target = String(filePath || '');
    if (!target) {return { append() { /* مُعطّل */ }, path: '', flush() { return Promise.resolve(); } };}
    if (!/\.jsonl$/i.test(target)) {target = `${target}.jsonl`;}

    let queue = Promise.resolve();

    function rotateIfNeeded() {
        try {
            const st = fs.statSync(target);
            if (st.size < maxBytes) {return;}
            const old = `${target}.${KEEP_ROTATIONS}`;
            try {fs.rmSync(old, { force: true });} catch (_) {}
            fs.renameSync(target, old);
        } catch (_) { /* الملف غير موجود — لا دوران */ }
    }

    return {
        path: target,
        /** يكتب مخالفة واحدة (غير متزامن، لا يرمي). */
        append(entry) {
            const line = `${JSON.stringify({
                ts: new Date().toISOString(),
                directive: entry.directive || 'unknown',
                blocked: sanitizeUrl(entry.blocked),
                document: sanitizeUrl(entry.document),
                source: entry.source ? sanitizeUrl(entry.source) : '',
            })}\n`;
            queue = queue.then(() => new Promise((resolve) => {
                try {
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    rotateIfNeeded();
                    fs.appendFile(target, line, 'utf8', () => resolve());
                } catch (_) {resolve();}
            })).catch(() => {});
        },
        /** انتظار انتهاء كل الكتابات المعلّقة (للمغادرة النظيفة). */
        flush() {return queue;},
    };
}

module.exports = { createCspViolationLog, sanitizeUrl, DEFAULT_MAX_BYTES };
