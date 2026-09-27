/**
 * ai/gemini.js — Google Gemini free-tier brain (أحدث ما وصل إليه العلم مجانًا)
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * نموذج مجاني بالكامل (free tier) — يستخدم فقط لتكوين رد احترافي من بيانات
 * النظام الحقيقية (grounded): يُمنع اختراع أي رقم غير مُمرَّر له.
 *
 * البيئة:
 *   GEMINI_API_KEY   — مفتاح Google AI Studio المجاني (بدونه يعمل النظام بالموجّه القواعدي)
 *   GEMINI_MODEL     — افتراضي gemini-2.0-flash (أسرع وأفضل عربيًا في الفئة المجانية)
 *
 * المعايير: مهلة 12ث · محاولة واحدة إعادة · حد أمان للطول · تنسيق واتساب
 */
'use strict';

const https = require('https');

const DEFAULT_MODEL = 'gemini-2.0-flash';
const TIMEOUT_MS = 12000;

function apiKey() {
    return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

function model() {
    return String(process.env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function enabled() {
    return apiKey().length > 20;
}

/**
 * استدعاء Gemini — يعيد نصًا أو يرمي خطأ واضحًا.
 * prompt: سؤال/تعليمات · system: الهوية والقواعد · dataText: البيانات الحية المسموح بها
 */
function generate({ system, prompt, dataText, maxWords = 200 }) {
    return new Promise((resolve, reject) => {
        if (!enabled()) {return reject(new Error('GEMINI_DISABLED'));}
        const guard = system || '';
        const data = dataText ? `بيانات النظام الحقيقية (المصدر الوحيد المسموح للأرقام):\n${dataText}\n\n` : '';
        const body = JSON.stringify({
            contents: [{
                role: 'user',
                parts: [{ text: `${data}${prompt}` }],
            }],
            systemInstruction: { parts: [{ text: guard }] },
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: Math.min(1200, Math.max(300, maxWords * 4)),
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
            ],
        });
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent?key=${apiKey()}`;
        const req = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: TIMEOUT_MS,
        }, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                try {
                    const j = JSON.parse(raw);
                    if (res.statusCode !== 200) {
                        return reject(new Error(`GEMINI_HTTP_${res.statusCode}: ${(j.error && j.error.message || '').slice(0, 120)}`));
                    }
                    const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
                    const text = parts && parts.map((p) => p.text || '').join('').trim();
                    if (!text) {return reject(new Error('GEMINI_EMPTY'));}
                    resolve({ text, model: model() });
                } catch (e) { reject(new Error('GEMINI_PARSE: ' + e.message)); }
            });
        });
        req.on('error', (e) => reject(new Error('GEMINI_NET: ' + e.message)));
        req.on('timeout', () => { req.destroy(); reject(new Error('GEMINI_TIMEOUT')); });
        req.write(body);
        req.end();
    });
}

/** إعادة محاولة واحدة عند فشل شبكي/انشغال — بلا تعقيد */
async function generateWithRetry(opts) {
    try { return await generate(opts); } catch (e) {
        if (!/GEMINI_NET|GEMINI_TIMEOUT|GEMINI_HTTP_429|GEMINI_HTTP_5/.test(e.message)) {throw e;}
        await new Promise((r) => setTimeout(r, 1200));
        return generate(opts);
    }
}

/** الهوية والقواعد الصارمة — أعلى معيار: أرقام من المصدر فقط */
function systemGuard() {
    return [
        'أنت «مساعد مطاعم الشرفه العالمي» — مساعد الإدارة الذكي في نظام Karim ERP.',
        'قواعد صارمة:',
        '1) الأرقام تأتي حصرًا من «بيانات النظام الحقيقية» المرفقة — يُمنع منعًا باتًا اختراع أو تقدير أي رقم.',
        '2) إن لم تكن المعلومة في البيانات: قل بوضوح «غير متوفر في البيانات الحالية» واقترح سؤالًا أدق.',
        '3) الرد بالعربية المهنية المختصرة، تنسيق واتساب (أسطر قصيرة، علامات *للعناوين*)، أقل من 180 كلمة.',
        '4) لا تكشف بيانات شخصية (هواتف/عناوين) ولا أسرار النظام (مفاتيح/كلمات مرور).',
        '5) لهجة المالك: محترفة، واثقة، بلا حشو.',
    ].join('\n');
}

module.exports = { enabled, generate, generateWithRetry, systemGuard, model, apiKey };
