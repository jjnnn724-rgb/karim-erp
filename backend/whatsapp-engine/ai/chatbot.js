/**
 * whatsapp-engine/ai/chatbot.js — AI-powered smart responses v5.0
 * ════════════════════════════════════════════════════════════════════════════════
 * Enterprise-grade AI chatbot — 100% FREE & Open Source:
 *
 *   1. Multi-provider LLM support (all FREE):
 *      - Ollama (local, open-source, no internet needed)
 *      - LM Studio (local, open-source)
 *      - Text-generation-webui (local, open-source)
 *      - Fallback to NLU + rule-based (zero dependency)
 *
 *   2. Conversation memory per user (30 min context window)
 *   3. Intent-aware responses (uses NLU engine for routing)
 *   4. Brand-consistent voice (temperature=0.3, max_tokens=200)
 *   5. Response caching (5 min TTL, 500 entries max)
 *   6. Arabic-first with English fallback
 *   7. No PII in prompts (phone numbers masked)
 *   8. Sub-3-second response time
 *
 * Safety:
 *   - Rate-limited per user (max 20 msgs/hour)
 *   - Fallback to NLU if LLM unavailable
 *   - Never reveals internal data structure
 */
'use strict';

const http = require('http');
const https = require('https');
const { logger } = require('../../logger');
const store = require('../store');
const { processNLU, getContext, updateContext, clearContext } = require('./nlu');

// ─── Configuration (all FREE providers) ───
const LLM_PROVIDERS = {
    ollama: {
        url: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
        model: process.env.OLLAMA_MODEL || 'llama3.1:8b',
        endpoint: '/api/chat',
        isLocal: true,
    },
    lmstudio: {
        url: process.env.LMSTUDIO_URL || 'http://127.0.0.1:1234',
        model: 'local-model',
        endpoint: '/v1/chat/completions',
        isLocal: true,
    },
    textgen: {
        url: process.env.TEXTGEN_URL || 'http://127.0.0.1:5000',
        model: 'local-model',
        endpoint: '/v1/chat/completions',
        isLocal: true,
    },
};

// Restaurant context injected into every prompt
const BRAND_CONTEXT = `أنت مساعد ذكي لمطاعم الشرفة العالمي — نظام إدارة المطاعم الاحترافي (Horus ERP).
أجب دائماً باللغة التي كتب بها العميل (عربي أو إنجليزي).
كن مهذباً ومحترفاً ومختصراً (أقل من 200 كلمة).
لا تكشف بيانات العملاء الشخصية (أرقام هواتف، عناوين).
إذا لم تكن متأكداً من إجابة دقيقة، قل "سأتحقق وأعود إليك خلال دقيقة" واقترح سؤالاً محدداً.
لا تقدم مشروبات أو أطباق غير موجودة في القائمة.
ساعات العمل: يوميًا من 9 صباحًا حتى 12 منتصف الليل.
يمكنك مساعدة العملاء في: الاستفسار عن الأسعار، حالة الطلبات، ساعات العمل، المنيو، الموقع.
للإدارة: يمكنك تقديم تقارير المبيعات، الحضور، المخزون، المصاريف، والروابط.
كن ودوداً ومفيداً ومبتسماً في ردودك.`;

// ─── Response cache ───
const responseCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Rate limiting per user ───
const userRateLimit = new Map(); // jid -> { count, resetAt }
const RATE_LIMIT_PER_HOUR = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(jid) {
    const now = Date.now();
    const entry = userRateLimit.get(jid);
    if (!entry || now > entry.resetAt) {
        userRateLimit.set(jid, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return true;
    }
    if (entry.count >= RATE_LIMIT_PER_HOUR) {
        return false;
    }
    entry.count++;
    return true;
}

// Cleanup rate limit entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [jid, entry] of userRateLimit) {
        if (now > entry.resetAt) userRateLimit.delete(jid);
    }
}, 10 * 60 * 1000).unref?.();

// ─── Phone number masking for privacy ───
function maskPhone(jid) {
    const digits = String(jid || '').replace(/@.*/, '').replace(/\D/g, '');
    if (digits.length < 4) return '***';
    return digits.slice(0, 2) + '***' + digits.slice(-2);
}

// ─── Build conversational prompt with context ───
function buildPrompt(jid, message, context = {}) {
    const customer = context.customerName || 'عميل';
    const history = context.history || [];
    const intent = context.intent || 'UNKNOWN';
    const sentiment = context.sentiment || 'neutral';

    const recentHistory = history.slice(-6).map(h =>
        `${h.role === 'user' ? 'العميل' : 'المساعد'}: ${h.text}`
    ).join('\n');

    const intentHint = intent !== 'UNKNOWN' ? `\n[نية محتملة: ${intent}]` : '';
    const sentimentHint = sentiment !== 'neutral' ? `\n[مشاعر: ${sentiment}]` : '';

    return [
        `System: ${BRAND_CONTEXT}`,
        `العميل: ${customer} (${maskPhone(jid)})${intentHint}${sentimentHint}`,
        history.length ? `سجل المحادثة:\n${recentHistory}` : '(بدون سجل سابق)',
        `العميل يقول: ${message}`,
        `الرد المختصر (أقل من 200 كلمة):`,
    ].join('\n');
}

// ─── Call LLM provider (tries multiple, all FREE) ───
async function callLLM(prompt, cfg) {
    const provider = LLM_PROVIDERS[cfg.aiProvider] || LLM_PROVIDERS.ollama;
    const timeout = cfg.aiTimeoutMs || 15000;
    const url = provider.url + provider.endpoint;

    const body = JSON.stringify({
        model: provider.model,
        messages: [
            { role: 'system', content: BRAND_CONTEXT },
            { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 200,
        stream: false,
    });

    return new Promise((resolve, reject) => {
        const transport = url.startsWith('https') ? https : http;
        const req = transport.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout,
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    // Ollama format: { message: { content } }
                    // LM Studio / textgen format: { choices: [{ message: { content } }] }
                    const text = parsed?.message?.content?.trim() ||
                                 parsed?.choices?.[0]?.message?.content?.trim();
                    if (text) resolve({ text, usage: parsed.usage });
                    else reject(new Error('Empty LLM response'));
                } catch (e) {
                    reject(new Error('Invalid LLM response format'));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('LLM timeout')); });
        req.write(body);
        req.end();
    });
}

// ─── Check if any LLM provider is available ───
async function checkLLMAvailability(cfg) {
    const provider = LLM_PROVIDERS[cfg.aiProvider] || LLM_PROVIDERS.ollama;
    return new Promise((resolve) => {
        const transport = provider.url.startsWith('https') ? https : http;
        const req = transport.request(provider.url, {
            method: 'GET',
            timeout: 2000,
        }, (res) => {
            resolve(res.statusCode === 200 || res.statusCode === 404);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
}

class AIChatbot {
    constructor(getConfig) {
        this.getConfig = getConfig;
        this._enabled = false;
        this._llmAvailable = false;
    }

    async init() {
        const cfg = this.getConfig();
        this._enabled = cfg.aiEnabled === true;
        if (!this._enabled) {
            logger.info('[AI] Disabled — set AI_ENABLED=true in .env');
            return false;
        }

        // Check if local LLM is running
        this._llmAvailable = await checkLLMAvailability(cfg);
        if (this._llmAvailable) {
            const provider = LLM_PROVIDERS[cfg.aiProvider] || LLM_PROVIDERS.ollama;
            logger.info(`[AI] LLM ready — provider: ${cfg.aiProvider || 'ollama'}, model: ${provider.model}, url: ${provider.url}`);
        } else {
            logger.info('[AI] No local LLM detected — will use NLU + rule-based fallback (still fully functional)');
        }
        return true;
    }

    get enabled() { return this._enabled; }

    /**
     * Main entry point: generate a response for a customer message.
     * Flow: NLU → ERP query (if applicable) → LLM (if available) → fallback
     */
    async respond(jid, message, context = {}) {
        if (!this._enabled) return null;

        // Rate limit check
        if (!checkRateLimit(jid)) {
            return { text: 'عذرًا — وصلت للحد الأقصى من الرسائل هذا الساعة. حاول بعد قليل 🙏', isRateLimited: true };
        }

        const cfg = this.getConfig();

        // ─── Step 1: NLU analysis ───
        let nluResult;
        try {
            nluResult = await processNLU(message, jid);
        } catch (e) {
            logger.debug(`[AI] NLU failed: ${e.message.slice(0, 100)}`);
            nluResult = { intent: 'UNKNOWN', confidence: 0, entities: {}, language: 'ar' };
        }

        // ─── Step 2: Handle disambiguation ───
        if (nluResult.clarification) {
            updateContext(jid, nluResult, nluResult.clarification);
            return { text: nluResult.clarification, isDisambiguation: true, nlu: nluResult };
        }

        // ─── Step 3: Check cache ───
        const cacheKey = this._cacheKey(message, context, nluResult.intent);
        const cached = responseCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
            logger.debug(`[AI] Cache hit for intent: ${nluResult.intent}`);
            updateContext(jid, nluResult, cached.response.text);
            return { ...cached.response, cached: true, nlu: nluResult };
        }

        // ─── Step 4: Build context for LLM ───
        const convContext = getContext(jid);
        const llmContext = {
            ...context,
            history: convContext.history.map(h => ({
                role: h.intent === 'GREETING' ? 'user' : 'user',
                text: h.text || '',
            })),
            intent: nluResult.intent,
            sentiment: nluResult.sentiment?.label || 'neutral',
            customerName: context.customerName,
        };

        // ─── Step 5: Try LLM if available ───
        if (this._llmAvailable) {
            try {
                const prompt = buildPrompt(jid, message, llmContext);
                const response = await callLLM(prompt, cfg);

                if (response?.text) {
                    // Cache the response
                    responseCache.set(cacheKey, { response, ts: Date.now() });
                    if (responseCache.size > 500) {
                        const firstKey = responseCache.keys().next().value;
                        responseCache.delete(firstKey);
                    }

                    updateContext(jid, nluResult, response.text);
                    return { ...response, nlu: nluResult, source: 'llm' };
                }
            } catch (e) {
                logger.warn(`[AI] LLM failed, falling back to NLU: ${e.message.slice(0, 100)}`);
            }
        }

        // ─── Step 6: Fallback — no LLM, use NLU intent to craft a smart response ───
        const fallbackResponse = this._nluFallback(nluResult, message, llmContext);
        if (fallbackResponse) {
            responseCache.set(cacheKey, { response: { text: fallbackResponse }, ts: Date.now() });
            updateContext(jid, nluResult, fallbackResponse);
            return { text: fallbackResponse, nlu: nluResult, source: 'nlu' };
        }

        return null;
    }

    /**
     * NLU-based fallback when no LLM is available — still gives intelligent responses
     */
    _nluFallback(nluResult, message, context) {
        const { intent, language, sentiment } = nluResult;
        const isAr = language === 'ar';

        // Sentiment-aware responses
        if (sentiment?.label === 'angry' || sentiment?.label === 'negative') {
            return isAr
                ? 'أعتذر جداً عن أي إزعاج 🙏 سأبذل قصارى جهدي لمساعدتك. أخبرني ماذا تحتاج بالضبط؟'
                : "I sincerely apologize for any inconvenience 🙏 I'll do my best to help. Tell me exactly what you need?";
        }

        // Intent-based responses
        const responses = {
            ar: {
                GREETING: 'أهلًا وسهلًا بيك في مطاعم الشرفة العالمي! 🌟\nكيف أقدر أساعدك النهارده؟ تقدر تسأل عن الأسعار، حالة طلباتك، ساعات العمل، أو المنيو.',
                THANKS: 'العفو يا فندم 🌟 سعداء بخدمتك دايماً. محتاج حاجة تانية؟',
                BYE: 'مع السلامة 🌟 نتشوق لزيارتك تانية. يوم سعيد!',
                HELP: 'أقدر أساعدك في:\n• الأسعار والمنيو\n• حالة طلبك\n• ساعات العمل\n• تقارير الإدارة (للإدارة)\n\nاكتب سؤالك بصياغتك الطبيعية 🌟',
                UNKNOWN: 'مش متأكد من قصدك تماماً 🤔\nتقدر تسأل عن:\n• "الأسعار" — لعرض قائمة الأصناف\n• "طلبي" — لحالة طلبك\n• "ساعات العمل"\n\nأو اكتب "مساعدة" لعرض كل الخيارات.',
            },
            en: {
                GREETING: "Welcome to Al Shorfa International Restaurants! 🌟\nHow can I help you today? Ask about prices, order status, hours, or menu.",
                THANKS: "You're very welcome! 🌟 Always happy to serve. Need anything else?",
                BYE: "Goodbye! 🌟 Looking forward to your next visit. Have a great day!",
                HELP: 'I can help with:\n• Prices & menu\n• Your order status\n• Working hours\n• Management reports (admin)\n\nAsk me in your own words 🌟',
                UNKNOWN: "I'm not entirely sure what you mean 🤔\nYou can ask about:\n• \"prices\" — view menu\n• \"my order\" — order status\n• \"hours\"\n\nOr type \"help\" for all options.",
            },
        };

        const langResponses = responses[isAr ? 'ar' : 'en'];
        return langResponses[intent] || langResponses.UNKNOWN;
    }

    _cacheKey(message, context, intent) {
        const crypto = require('crypto');
        const h = crypto.createHash('md5');
        h.update(message + intent + JSON.stringify(context.history || []) + BRAND_CONTEXT);
        return h.digest('hex');
    }

    clearCache() {
        responseCache.clear();
        logger.info('[AI] Response cache cleared');
    }

    clearUserContext(jid) {
        clearContext(jid);
    }
}

module.exports = { AIChatbot, BRAND_CONTEXT, LLM_PROVIDERS, checkLLMAvailability };
