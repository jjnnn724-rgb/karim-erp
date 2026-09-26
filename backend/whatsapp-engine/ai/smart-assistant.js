/**
 * whatsapp-engine/ai/smart-assistant.js — مساعد ذكي احترافي للنظام بالكامل
 * ═════════════════════════════════════════════════════════════════════════════════════════════════
 * مساعد ذكي شامل يفهم أي استعلام عن النظام ويجيب باحترافية:
 * 1. فهم النية (NLU) + استخراج الكيانات
 * 2. التوجيه للاستعلام المناسب في ERP
 * 2. استخدام LLM إن توفر، وإلا fallback ذكي
 * 3. دعم العربية/الإنجليزية مع سياق المحادثة
 * 4. ردود مهنية منسقة مع تنسيق موحد
 * 5. ذاكرة سياقية للمحادثة
 * 6. لا يتطلب صلاحيات مدير للاستعلامات العامة
 */

'use strict';

const path = require('path');
const { pool } = require(path.join(__dirname, '..', '..', 'shared-pool'));
const { logger } = require(path.join(__dirname, '..', '..', 'logger'));
const store = require(path.join(__dirname, '..', 'store'));
const { processNLU, getContext, updateContext, clearContext } = require('./nlu');
const { answerFreeText } = require('../answer');
const { callLLM, checkLLMAvailability, maskPhone } = require('./chatbot');
const { loadConfig } = require('../config.js');
const { riyadhDay, fnum } = require('../answer');

const BRAND_CONTEXT = `أنت مساعد ذكي رسمي لمطاعم الشرفة العالمي (Horus ERP) — نظام إدارة مطاعم احترافي متكامل.
أجب دائماً باللغة التي كتب بها المستخدم (عربي/إنجليزي).
كن مهذباً، محترفاً، مختصراً (أقل من 300 كلمة)، ومنظماً.
استخدم التنسيق: عناوين واضحة، نقاط مرقمة، أرقام منسقة.
لا تكشف بيانات شخصية حساسة (هواتف، عناوين، رواتب تفصيلية).
إذا لم تتأكد من إجابة دقيقة: "سأتحقق وأعود إليك خلال دقائق" + اقترح سؤالاً محدداً.
بياناتك مصدرها قاعدة البيانات لحظة السؤال — دقيقة ولحظية.`;

const responseCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

const userRateLimit = new Map();
const RATE_LIMIT_PER_HOUR = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(jid) {
    const now = Date.now();
    const entry = userRateLimit.get(jid);
    if (!entry || now > entry.resetAt) {
        userRateLimit.set(jid, { count: 1, resetAt: now + 60 * 60 * 1000 });
        return true;
    }
    if (entry.count >= 60) return false;
    entry.count++;
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [jid, entry] of userRateLimit) {
        if (now > entry.resetAt) userRateLimit.delete(jid);
    }
}, 10 * 60 * 1000).unref?.();

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// SMART ASSISTANT CLASS
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

class SmartAssistant {
    constructor(getConfig = () => ({})) {
        this.getConfig = getConfig;
        this._initialized = false;
        this._llmAvailable = false;
    }

    async init() {
        const cfg = this.getConfig();
        this._enabled = cfg.aiEnabled === true;
        if (!this._enabled) {
            logger.info('[SmartAssistant] Disabled — set AI_ENABLED=true in .env');
            return false;
        }
        this._llmAvailable = await checkLLMAvailability(cfg);
        this._initialized = true;
        logger.info(`[SmartAssistant] Initialized — LLM: ${this._llmAvailable ? 'Available' : 'Fallback mode'}`);
        return true;
    }

    get enabled() { return this._enabled; }

    // ══════════════════════════════════════════════════════════════════════════════════════════════════════
    // MAIN ENTRY POINT — يفهم أي استعلام ويرد باحترافية
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════

    async respond(jid, message, context = {}) {
        const started = Date.now();
        const cfg = this.getConfig();

        if (!this._enabled) {
            return { text: 'المساعد الذكي معطل حالياً. تواصل مع الإدارة لتفعيله.', source: 'disabled' };
        }

        if (!checkRateLimit(jid)) {
            return { text: 'عذراً — وصلت للحد الأقصى من الاستعلامات هذه الساعة. حاول بعد قليل 🙏', source: 'rate_limited' };
        }

        // ─── Step 1: NLU Analysis ───
        let nluResult;
        try {
            nluResult = await this._processNLU(message, jid);
        } catch (e) {
            logger.debug(`[SmartAssistant] NLU failed: ${e.message.slice(0, 100)}`);
            nluResult = { intent: 'UNKNOWN', confidence: 0, entities: {}, language: 'ar', sentiment: { label: 'neutral' } };
        }

        // ─── Step 2: Disambiguation ───
        if (nluResult.clarification) {
            return { text: nluResult.clarification, isDisambiguation: true, nlu: nluResult };
        }

        // ─── Step 3: Check cache ───
        const cacheKey = this._cacheKey(message, context, nluResult);
        const cached = responseCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
            logger.debug(`[SmartAssistant] Cache hit: ${nluResult.intent}`);
            return { ...cached.response, cached: true, nlu: nluResult };
        }

        // ─── Step 4: Try ERP Query Router (answerFreeText) ───
        let routerResponse = null;
        try {
            const router = require('../answer');
            const free = await router.answerFreeText({ getConfig: () => loadConfig() }, message, { ...context, remoteJid: message.from || message.jid });
            if (free) {
                routerResponse = free;
                logger.debug(`[SmartAssistant] Router matched: ${nluResult.intent}`);
            }
        } catch (e) {
            logger.debug(`[SmartAssistant] Router failed: ${e.message.slice(0, 100)}`);
        }

        // ─── Step 4.5: Genius — deep real-data answers (attendance detail, stock, briefing) ───
        try {
            const genius = require('../genius');
            const g = await genius.handleText(message, {
                remoteJid: jid, senderPn: context.senderPn,
                customerName: context.customerName,
            });
            if (g && g.text) {
                logger.debug('[SmartAssistant] Genius answered');
                return { text: g.text, nlu: nluResult, source: 'genius', latencyMs: Date.now() - started };
            }
        } catch (e) {
            logger.debug(`[SmartAssistant] Genius failed: ${e.message.slice(0, 100)}`);
        }

        // ─── Step 5: Build LLM Context ───
        const convContext = getContext(jid);
        const llmContext = {
            ...context,
            history: convContext.history.slice(-6).map(h => `${h.role === 'user' ? 'العميل' : 'المساعد'}: ${h.text}`).join('\n'),
            intent: nluResult.intent,
            sentiment: nluResult.sentiment?.label || 'neutral',
            entities: nluResult.entities,
        };

        // ─── Step 5: Try LLM if available ───
        if (this._llmAvailable) {
            try {
                const prompt = this._buildPrompt(message, nluResult, llmContext, routerResponse);
                const response = await callLLM(prompt, this.getConfig());
                if (response?.text) {
                    const responseObj = { text: response.text, nlu: nluResult, source: 'llm', latencyMs: Date.now() - started };
                    this._cacheResponse(message, nluResult, responseObj);
                    return responseObj;
                }
            } catch (e) {
                logger.warn(`[SmartAssistant] LLM failed: ${e.message.slice(0, 100)}`);
            }
        }

        // ─── Step 6: Fallback — NLU-based intelligent response ───
        const fallback = this._nluFallback(nluResult, message, llmContext, routerResponse);
        if (fallback) {
            return { text: fallback, nlu: nluResult, source: 'nlu', latencyMs: Date.now() - started };
        }

        // ─── Final Fallback ───
        return {
            text: this._getHelpText(nluResult.language),
            nlu: nluResult,
            source: 'help',
            latencyMs: Date.now() - started
        };
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════════════
    // NLU PROCESSING
    // ════════════════════════════════════════════════════════════════════════════════════════════════════

    async _processNLU(message, jid) {
        const { processNLU, getContext, updateContext } = require('./nlu');
        const nluResult = await processNLU(message, jid);
        // Enhance with context
        const context = getContext(jid);
        nluResult.contextHistory = context.history?.slice(-3) || [];
        return nluResult;
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    // NLU FALLBACK — رد ذكي بدون LLM
    // ══════════════════════════════════════════════════════════════════════════════════════════════════════

    _nluFallback(nluResult, message, context) {
        const { intent, language, sentiment, entities } = nluResult;
        const isAr = language === 'ar';
        const isManager = context.isManager || false;

        // Sentiment-aware
        if (sentiment?.label === 'angry' || sentiment?.label === 'negative') {
            return isAr
                ? 'أعتذر جداً عن أي إزعاج 🙏 — سأبذل قصارى جهدي لمساعدتك. أخبرني ماذا تحتاج بالضبط؟'
                : "I sincerely apologize for any inconvenience 🙏 I'll do my best to help. Tell me exactly what you need?";
        }

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // INTENT-BASED PROFESSIONAL RESPONSES
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════

        const responses = {
            ar: {
                GREETING: `أهلاً بك في مطاعم الشرفة العالمي 🌟\nأنا مساعدك الذكي — أقدر أساعدك في أي معلومة عن النظام:\n• 📊 **التقارير**: مبيعات، مخزون، حضور، مصاريف، رواتب\n• 👥 **الموظفين**: حضور، إجازات، رواتب، تفاصيل\n• 📦 **المخزون**: أرصدة، نواقص، طلبات شراء، موردين\n• 💰 **المالية**: إيرادات، مصاريف، أرباح، تدفقات\n• 🏠 **الفروع/الكاشير**: كاشيرات، ورديات، تقفيل\n\nاكتب سؤالك طبيعياً — مثال: "حضور اليوم"، "إيرادات الشهر"، "مخزون الشاورما"`,
                THANKS: 'العفو يا فندم 🌟 — سعيد بمساعدتك. محتاج حاجة تانية؟',
                BYE: 'مع السلامة 🌟 — نتشرف بخدمتك دايماً. يوم سعيد!',
                HELP: 'أقدر أساعدك في أي حاجة تخص النظام:\n\n📊 **التقارير والإيرادات**\n• "تقرير" — موجز يومي شامل\n• "إيرادات اليوم/أمس/الشهر" — تفاصيل المبيعات\n• "كاشير 4 اليوم" — أداء كاشير محدد\n\n👥 **الموظفين والحضور**\n• "حضور اليوم" — مين حاضر/غائب\n• "حضور أحمد" — تفاصيل موظف\n• "رواتب" / "إجازات" / "وثائق"\n\n📦 **المخزون والمشتريات**\n• "مخزون" — صورة شاملة\n• "نواقص" — الأصناف اللي محتاجة طلب\n• "مشتريات" / "موردين" / "مديونية مورد"\n\n💰 **المالية والتقارير**\n• "تقرير" — موجز تنفيذي\n• "أرباح" / "مصاريف" / "تحليل تكاليف"\n\n⚙️ **النظام والفروع**\n• "حالة النظام" — صحة السيرفر/الواتساب/قاعدة البيانات\n• "كاشيرية" — أداء الكاشيرات\n• "المطبخ" — إنتاج اليوم\n\n✍️ **اكتب سؤالك طبيعياً** — أنا أفهم اللغة الطبيعية.',
                THANKS: 'العفو يا فندم 🌟 — سعيد بمساعدتك. محتاج حاجة تانية؟',
                BYE: 'مع السلامة 🌟 — نتشرف بخدمتك دايماً. يوم سعيد!',
                HELP: 'أقدر أساعدك في أي حاجة تخص النظام:\n\n📊 **التقارير والإيرادات**\n• "تقرير" — موجز يومي شامل\n• "إيرادات اليوم/أمس/الشهر" — تفاصيل المبيعات\n• "كاشير 4 اليوم" — أداء كاشير محدد\n\n👥 **الموظفين والحضور**\n• "حضور اليوم" — مين حاضر/غائب\n• "حضور أحمد" — تفاصيل موظف\n• "رواتب" / "إجازات" / "وثائق"\n\n📦 **المخزون والمشتريات**\n• "مخزون" — صورة شاملة\n• "نواقص" — الأصناف اللي محتاجة طلب\n• "مشتريات" / "موردين" / "مديونية مورد"\n\n💰 **المالية والتقارير**\n• "تقرير" — موجز تنفيذي\n• "أرباح" / "مصاريف" / "تحليل تكاليف"\n\n⚙️ **النظام والفروع**\n• "حالة النظام" — صحة السيرفر/الواتساب/قاعدة البيانات\n• "كاشيرية" — أداء الكاشيرات\n• "المطبخ" — إنتاج اليوم\n\n✍️ **اكتب سؤالك طبيعياً** — أنا أفهم اللغة الطبيعية.',
                THANKS: 'العفو يا فندم 🌟 — سعيد بمساعدتك. محتاج حاجة تانية؟',
                BYE: 'مع السلامة 🌟 — نتشرف بخدمتك دايماً. يوم سعيد!',
                HELP: 'أقدر أساعدك في أي حاجة تخص النظام:\n\n📊 **التقارير والإيرادات**\n• "تقرير" — موجز يومي شامل\n• "إيرادات اليوم/أمس/الشهر" — تفاصيل المبيعات\n• "كاشير 4 اليوم" — أداء كاشير محدد\n\n👥 **الموظفين والحضور**\n• "حضور اليوم" — مين حاضر/غائب\n• "حضور أحمد" — تفاصيل موظف\n• "رواتب" / "إجازات" / "وثائق"\n\n📦 **المخزون والمشتريات**\n• "مخزون" — صورة شاملة\n• "نواقص" — الأصناف اللي محتاجة طلب\n• "مشتريات" / "موردين" / "مديونية مورد"\n\n💰 **المالية والتقارير**\n• "تقرير" — موجز تنفيذي\n• "أرباح" / "مصاريف" / "تحليل تكاليف"\n\n⚙️ **النظام والفروع**\n• "حالة النظام" — صحة السيرفر/الواتساب/قاعدة البيانات\n• "كاشيرية" — أداء الكاشيرات\n• "المطبخ" — إنتاج اليوم\n\n✍️ **اكتب سؤالك طبيعياً** — أنا أفهم اللغة الطبيعية.',
                THANKS: 'العفو يا فندم 🌟 — سعيد بمساعدتك. محتاج حاجة تانية؟',
                BYE: 'مع السلامة 🌟 — نتشرف بخدمتك دايماً. يوم سعيد!',
                HELP: 'أقدر أساعدك في أي حاجة تخص النظام:\n\n📊 **التقارير والإيرادات**\n• "تقرير" — موجز يومي شامل\n• "إيرادات اليوم/أمس/الشهر" — تفاصيل المبيعات\n• "كاشير 4 اليوم" — أداء كاشير محدد\n\n👥 **الموظفين والحضور**\n• "حضور اليوم" — مين حاضر/غائب\n• "حضور أحمد" — تفاصيل موظف\n• "رواتب" / "إجازات" / "وثائق"\n\n📦 **المخزون والمشتريات**\n• "مخزون" — صورة شاملة\n• "نواقص" — الأصناف اللي محتاجة طلب\n• "مشتريات" / "موردين" / "مديونية مورد"\n\n💰 **المالية والتقارير**\n• "تقرير" — موجز تنفيذي\n• "أرباح" / "مصاريف" / "تحليل تكاليف"\n\n⚙️ **النظام والفروع**\n• "حالة النظام" — صحة السيرفر/الواتساب/قاعدة البيانات\n• "كاشيرية" — أداء الكاشيرات\n• "المطبخ" — إنتاج اليوم\n\n✍️ **اكتب سؤالك طبيعياً** — أنا أفهم اللغة الطبيعية.',
                UNKNOWN: 'مش متأكد من قصدك تماماً 🤔\nاكتب سؤالك بطريقتك — أنا أفهم اللغة الطبيعية.\n\nأمثلة:\n• "حضور اليوم" — مين حضر ومين غاب\n• "إيرادات هذا الشهر" — إجمالي المبيعات\n• "مخزون الفراخ" — رصيد صنف معين\n• "موظف أحمد" — بياناته وحضوره\n• "تقرير" — ملخص تنفيذي\n\nأو اكتب "مساعدة" للقائمة الكاملة.',
                // Specific domain responses (fallback when router doesn't catch)
                SALES_TODAY: '📊 **مبيعات اليوم** — سأجلب لك التفاصيل...',
                SALES_YESTERDAY: '📊 **مبيعات أمس** — جاري الجلب...',
                SALES_MONTH: '📊 **مبيعات هذا الشهر** — الإجمالي والتفاصيل...',
INVENTORY: '📦 **المخزون الحالي** — ملخص شامل...',
                STOCK_ITEM: '📦 **المخزون الحالي** — ملخص شامل...',
                STOCK_LOW: '⚠️ **النواقص الحرجة** — الأصناف اللي محتاجة طلب عاجل...',
                INVENTORY_LOW: '⚠️ **النواقص الحرجة** — الأصناف اللي محتاجة طلب عاجل...',
                DAILY_REPORT: '📋 **تقرير يومي** — ملخص تنفيذي شامل...',
                ATTENDANCE_TODAY: '👥 **حضور اليوم** — مين حضر ومين غاب...',
                ATTENDANCE_EMPLOYEE: '👤 **تفاصيل حضور الموظف** — جاري الجلب...',
                EMPLOYEES_LIST: '👥 **قائمة الموظفين** — العدد والتفاصيل...',
                EMPLOYEE_DETAIL: '👤 **تفاصيل الموظف** — البيانات والحضور...',
                SALARIES: '💰 **الرواتب والمسيرات** — المجموع والتفاصيل...',
                EXPENSES: '💸 **المصاريف** — اليوم/الشهر/أكبر البنود...',
                PROFIT_LOSS: '📈 **قائمة الأرباح والخسائر** — الإيرادات والتكاليف...',
                CASHIER_REPORT: '🧾 **تقفيل الكاشيرية** — الأداء والتحصيل...',
                INVENTORY_LOW: '⚠️ **النواقص الحرجة** — الأصناف اللي محتاجة طلب عاجل...',
                WAREHOUSES: '🏪 **المخازن** — ملخص كل مستودع...',
                SYSTEM_HEALTH: '🖥️ **حالة النظام** — السيرفر/قاعدة البيانات/الواتساب...',
                ZK_STATUS: '🖐 **أجهزة البصمة** — حالة المزامنة والأجهزة...',
            },
            en: {
                GREETING: 'Welcome to Al Shorfa International Restaurants! 🌟\nI\'m your smart assistant — ask me anything about the system:\n• 📊 Reports: Sales, Inventory, Attendance, Expenses, Payroll\n• 👥 Employees: Attendance, Leaves, Payroll, Details\n• 📦 Inventory: Stock, Shortages, Purchases, Suppliers\n• 💰 Finance: Revenue, Expenses, P&L, Cash Flow\n• 🏠 Branches/POS: Cashiers, Shifts, Closing\n\nAsk naturally — e.g., "today sales", "inventory", "attendance today", "employee Ahmed"',
                THANKS: "You're welcome! 🌟 Happy to help. Need anything else?",
                BYE: "Goodbye! 🌟 Looking forward to serving you again. Have a great day!",
                HELP: 'I can help with:\n• Prices & Menu\n• Order Status\n• Working Hours\n• Management Reports (admin)\n\nAsk me in your own words 🌟',
                UNKNOWN: "I'm not entirely sure what you mean 🤔\nYou can ask about:\n• \"prices\" — view menu\n• \"my order\" — order status\n• \"hours\"\n\nOr type \"help\" for all options.",
            },
        };

        // Sentiment-aware
        if (nluResult.sentiment?.label === 'angry' || nluResult.sentiment?.label === 'negative') {
            return isAr
                ? 'أعتذر جداً عن أي إزعاج 🙏 — سأبذل قصارى جهدي لمساعدتك. أخبرني ماذا تحتاج بالضبط؟'
                : "I sincerely apologize for any inconvenience 🙏 I'll do my best to help. Tell me exactly what you need?";
        }

        // Intent-based fallback
        const langResponses = responses[nluResult.language === 'ar' ? 'ar' : 'en'];
        const intentResponse = langResponses[nluResult.intent];

        if (intentResponse && typeof intentResponse === 'string' && !['GREETING', 'THANKS', 'BYE', 'HELP', 'UNKNOWN'].includes(nluResult.intent)) {
            return intentResponse;
        }

        // General fallback
        return langResponses.UNKNOWN;
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // LLM PROMPT BUILDING
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════

    _buildPrompt(message, nluResult, context, routerResponse) {
        const isAr = nluResult.language === 'ar';
        const history = context.history?.map(h => `${h.role === 'user' ? 'العميل' : 'المساعد'}: ${h.text}`).join('\n') || '(لا يوجد سجل سابق)';

        let routerInfo = '';
        if (routerResponse) {
            routerInfo = `\n[معلومة من قاعدة البيانات]:\n${String(routerResponse).slice(0, 1500)}`;
        }

        return [
            `System: ${BRAND_CONTEXT}`,
            `اللغة: ${isAr ? 'العربية' : 'English'}`,
            `النية: ${nluResult.intent} (ثقة: ${Math.round((nluResult.confidence || 0) * 100)}%)`,
            routerInfo,
            `المستخدم: ${message}`,
            `الرد الاحترافي المختصر (أقل من 300 كلمة، منسق، باللغة ${isAr ? 'العربية' : 'الإنجليزية'}):`,
        ].join('\n');
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════

    _cacheKey(message, context, nluResult) {
        const crypto = require('crypto');
        const h = crypto.createHash('md5');
        h.update(message + nluResult.intent + JSON.stringify(context.history || []));
        return h.digest('hex');
    }

    _getHelpText(isAr) {
        return isAr
            ? 'أهلاً بك! أنا مساعدك الذكي لنظام Horus ERP.\n\nاكتب سؤالك بطبيعتك — أفهم اللغة الطبيعية:\n\n📊 **تقارير**: "تقرير"، "إيرادات اليوم"، "إيرادات الشهر"\n👥 **موظفين**: "حضور اليوم"، "حضور أحمد"، "رواتب"، "إجازات"\n📦 **مخزون**: "مخزون"، "نواقص"، "مخزون الفراخ"، "مشتريات"\n💰 **مالية**: "مصاريف اليوم"، "أرباح"، "تقرير مالي"\n⚙️ **نظام**: "حالة النظام"، "الكاشيرية"، "المطبخ"، "البصمة"\n\n✍️ اكتب سؤالك طبيعياً — أنا أفهمك!'
            : 'Welcome! I\'m your smart assistant for Horus ERP.\n\nAsk me anything naturally:\n\n📊 Reports: "sales today", "revenue this month"\n👥 Employees: "attendance today", "employee Ahmed", "payroll"\n📦 Inventory: "stock", "low stock", "purchases"\n💰 Finance: "expenses today", "profit loss", "financial report"\n⚙️ System: "system status", "cashier", "kitchen", "fingerprint"\n\nJust ask naturally!';
    }
}

module.exports = { SmartAssistant };