/**
 * whatsapp-engine/templates/index.js — Professional message templates
 * ═══════════════════════════════════════════════════════════════════
 *
 * Pre-approved WhatsApp Business message templates for:
 *   - Order confirmations
 *   - Delivery updates
 *   - Payment receipts
 *   - Promotional messages
 *   - Appointment reminders
 *
 * All templates follow WhatsApp Business API format:
 *   - Variables: {{1}}, {{2}}, etc.
 *   - Maximum 1024 characters
 *   - Language: Arabic (primary) + English fallback
 *   - Category: UTILITY, AUTHENTICATION, MARKETING, SERVICE
 *
 * Templates are stored in PostgreSQL (wa_templates table)
 * for easy management via the API.
 */
'use strict';

const { logger } = require('../../logger');
const store = require('../store');

// Built-in templates — used when no custom template in DB
const BUILTIN = Object.freeze({
    order_confirm: {
        category: 'UTILITY',
        ar: '✅ تأكيد الطلب\nالطلب #{{1}}\nالمجموع: {{2}} ر.س\nالحالة: تم الاستلام\nشكراً لتواصلكم مع مطاعم الشرفة 🍽️',
        en: '✅ Order Confirmation\nOrder #{{1}}\nTotal: {{2}} SAR\nStatus: Confirmed\nThank you for choosing Al-Shorfa 🍽️',
    },
    delivery_update: {
        category: 'UTILITY',
        ar: '🚚 تحديث التوصيل\nالطلب #{{1}}\nالحالة: {{2}}\nالموظف: {{3}}\nللمتابعة: اتصل بخدمة العملاء',
        en: '🚚 Delivery Update\nOrder #{{1}}\nStatus: {{2}}\nDriver: {{3}}\nFor inquiries: call support',
    },
    payment_receipt: {
        category: 'UTILITY',
        ar: '🧾 إيصال الدفع\nالمبلغ: {{2}} ر.س\nطريقة الدفع: {{3}}\nرقم المعاملة: {{1}}\nتم الدفع بنجاح ✅',
        en: '🧾 Payment Receipt\nAmount: {{2}} SAR\nMethod: {{3}}\nTransaction: {{1}}\nPayment successful ✅',
    },
    appointment_reminder: {
        category: 'SERVICE',
        ar: '⏰ تذكير بالموعد\nالتاريخ: {{1}}\nالوقت: {{2}}\nالفرع: {{3}}\nلإلغاء أو تعديل: رد "إلغاء"',
        en: '⏰ Appointment Reminder\nDate: {{1}}\nTime: {{2}}\nBranch: {{3}}\nTo cancel: reply "Cancel"',
    },
    welcome: {
        category: 'AUTHENTICATION',
        ar: '🎉 أهلاً بكم في مطاعم الشرفة العالمي!\nاختر من القائمة:\n1. 📋 طلب جديد\n2. 📊 متابعة طلب\n3. 📞 تواصل معنا\n4. 📞 خدمة العملاء',
        en: '🎉 Welcome to Al-Shorfa Restaurants!\nChoose from menu:\n1. 📋 New Order\n2. 📊 Track Order\n3. 📞 Contact Us\n4. 💬 Customer Support',
    },
    order_status: {
        category: 'UTILITY',
        ar: '📊 حالة الطلب #{{1}}\nالحالة: {{2}}\nالتاريخ: {{3}}\nالتقدير: {{4}}\nللاستفسار: {{5}}',
        en: '📊 Order #{{1}} Status\nStatus: {{2}}\nDate: {{3}}\nETA: {{4}}\nInquiries: {{5}}',
    },
});

class TemplateManager {
    constructor() {
        this._cache = new Map();
        this._cacheTtlMs = 60 * 1000; // 1 minute
    }

    /** Get a template by name (builtin or from DB) */
    async get(name, lang = 'ar') {
        // Check cache first
        const cacheKey = `${name}:${lang}`;
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.ts < this._cacheTtlMs) {
            return cached.template;
        }

        // Try database first
        try {
            const row = await store.getTemplate(name);
            if (row && row[lang === 'en' ? 'en' : 'ar']) {
                const template = row[lang === 'en' ? 'en' : 'ar'];
                this._cache.set(cacheKey, { template, ts: Date.now() });
                return template;
            }
        } catch (_) {}

        // Fallback to builtin
        const builtin = BUILTIN[name];
        if (builtin) {
            const template = lang === 'en' ? builtin.en : builtin.ar;
            this._cache.set(cacheKey, { template, ts: Date.now() });
            return template;
        }

        return null;
    }

    /** Replace {{1}}, {{2}}... with actual values */
    fill(template, ...values) {
        if (!template) {return '';}
        return template.replace(/\{\{(\d+)\}\}/g, (_, i) => values[parseInt(i) - 1] || '');
    }

    /** Highest placeholder index in a template (= required vars count) */
    countVars(template) {
        if (!template) {return 0;}
        let max = 0;
        const re = /\{\{(\d+)\}\}/g;
        let m;
        while ((m = re.exec(template)) !== null) {max = Math.max(max, parseInt(m[1], 10));}
        return max;
    }

    /** Send a templated message to a customer */
    async send(engine, jid, templateName, values, lang = 'ar') {
        const template = await this.get(templateName, lang);
        if (!template) {
            logger.warn(`[Template] Unknown: ${templateName}`);
            return null;
        }
        const text = this.fill(template, ...values);
        const sender = engine?.sender || new (require('../sender').WhatsappSender)(engine, engine.getConfig);
        await sender.enqueue(jid, text);
        return text;
    }

    /** Invalidate cache (called on admin template update) */
    clearCache() { this._cache.clear(); }
}

module.exports = { TemplateManager, BUILTIN };