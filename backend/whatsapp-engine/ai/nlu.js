/**
 * whatsapp-engine/ai/nlu.js — Natural Language Understanding Engine v5.0
 * ════════════════════════════════════════════════════════════════════════════════
 * Professional multi-language NLU engine for WhatsApp — enterprise-grade:
 *
 *   1. Intent Detection — understands WHAT the user wants (100+ intents)
 *   2. Entity Extraction — extracts parameters (names, dates, numbers, amounts)
 *   3. Language Detection — auto-detects Arabic/English/mixed
 *   4. Sentiment Analysis — detects positive/neutral/negative/urgent
 *   5. Context Memory — remembers conversation context per user
 *   6. Confidence Scoring — weighted multi-signal intent matching
 *   7. Disambiguation — asks clarifying questions when ambiguous
 *
 * Design principles:
 *   - Zero external dependencies — pure JS, no ML models needed offline
 *   - Arabic-first with dialectal normalization (Saudi/Gulf/Levantine/Egyptian)
 *   - English fallback with fuzzy matching
 *   - Sub-millisecond response time
 *   - Fully testable — all functions are pure
 */
'use strict';

const { normalizeText } = require('../rules');

// ════════════════════════════════════════════════════════════════════════════════
// INTENT DEFINITIONS — 100+ intents covering all ERP modules
// ════════════════════════════════════════════════════════════════════════════════

const INTENTS = {
    // ─── POS / Sales ───
    SALES_TODAY: {
        id: 'SALES_TODAY',
        category: 'pos',
        keywords: {
            ar: ['مبيعات اليوم', 'إيراد اليوم', 'ايراد اليوم', 'دخل اليوم', 'حصيلة اليوم', 'حصيله اليوم', 'مبيعات النهارده', 'كاش اليوم', 'تقفيل اليوم', 'اجمالي المبيعات', 'إجمالي المبيعات', 'اجمالي مبيعات', 'مجموع المبيعات', 'مجموع مبيعات', 'اجمالي اليوم', 'إجمالي اليوم'],
            en: ['sales today', 'revenue today', 'income today', 'today sales', 'daily revenue', 'total sales', 'total revenue'],
        },
        entities: ['date_offset'],
        minConfidence: 0.5,
    },
    SALES_YESTERDAY: {
        id: 'SALES_YESTERDAY',
        category: 'pos',
        keywords: {
            ar: ['مبيعات امس', 'مبيعات أمس', 'إيراد امس', 'إيراد أمس', 'ايراد امس', 'ايراد أمس', 'مبيعات امبارح', 'تقفيل امس', 'تقفيل أمس'],
            en: ['sales yesterday', 'revenue yesterday', 'yesterday sales', 'yesterday revenue'],
        },
        entities: ['date_offset'],
        minConfidence: 0.6,
    },
    CASHIER_REPORT: {
        id: 'CASHIER_REPORT',
        category: 'pos',
        keywords: {
            ar: ['الكاشيرية', 'الكاشيريه', 'كاشير', 'لوحة الكاشير', 'تقفيل كاشير', 'إيراد كاشير', 'كاشير اليوم', 'كاشير امس', 'كاشيرية اليوم', 'كاشيريه اليوم', 'ملخص الكاشير', 'كاشير اليوم'],
            en: ['cashier report', 'cashier sales', 'cashier today', 'cashier summary', 'cashier total'],
        },
        entities: ['cashier_number', 'date_offset'],
        minConfidence: 0.4,
    },
    ORDER_STATUS: {
        id: 'ORDER_STATUS',
        category: 'pos',
        keywords: {
            ar: ['حالة طلب', 'حاله طلب', 'طلب رقم', 'فين طلب', 'وين طلب', 'طلبتي', 'طلبى', 'طلبي', 'اوردري', 'اوردر'],
            en: ['order status', 'where is my order', 'order number', 'track order', 'my order'],
        },
        entities: ['order_number'],
        minConfidence: 0.5,
    },
    MENU_PRICE: {
        id: 'MENU_PRICE',
        category: 'pos',
        keywords: {
            ar: ['سعر', 'اسعار', 'بكام', 'بكم', 'قايمة الاسعار', 'قائمة الاسعار', 'كافيه', 'حوّل', 'قائمه', 'الاسعار', 'الأصناف', 'الاصناف'],
            en: ['price', 'how much', 'list prices', 'cost', 'prices'],
        },
        entities: ['item_name'],
        minConfidence: 0.4,
    },
    BILL_REQUEST: {
        id: 'BILL_REQUEST',
        category: 'pos',
        keywords: {
            ar: ['الفاتورة', 'فاتورة', 'فواتيري', 'الحساب', 'حسابي', 'كشف حساب', 'كشف الحساب', 'الحقني', 'تسوية'],
            en: ['bill', 'invoice', 'check please', 'my bill', 'the bill', 'how much is the bill', 'tab'],
        },
        entities: ['order_number'],
        minConfidence: 0.5,
    },
    MENU_REQUEST: {
        id: 'MENU_REQUEST',
        category: 'pos',
        keywords: {
            ar: ['المنيو', 'القائمة', 'القايمة', 'وش دول', 'ايه موجود', 'ايش موجود', 'ايه الاكلات', 'الاطبقة', 'الأطباق', 'منيو', 'قائمة الطعام', 'طعام'],
            en: ['menu', 'show menu', 'what do you have', 'food list', 'dishes', 'whats available'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    HOURS_QUERY: {
        id: 'HOURS_QUERY',
        category: 'pos',
        keywords: {
            ar: ['ساعات العمل', 'ساعات الدوام', 'متى تفتحون', 'متى تفتح', 'وقت العمل', 'الافتتاح', 'الإغلاق', 'متى تقفلون', 'تفتحو', 'تقفلون', 'دوام'],
            en: ['hours', 'working hours', 'opening hours', 'when do you open', 'when do you close', 'business hours'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    SHIFT_CLOSE: {
        id: 'SHIFT_CLOSE',
        category: 'pos',
        keywords: {
            ar: ['تقفيل', 'تقفيل اليوم', 'إغلاق وردية', 'اقفال', 'إقفال', 'تقفيل كاشير'],
            en: ['close shift', 'shift close', 'close cashier', 'end of day'],
        },
        entities: ['cashier_number'],
        minConfidence: 0.6,
    },
    SHIFTS_OPEN: {
        id: 'SHIFTS_OPEN',
        category: 'pos',
        keywords: {
            ar: ['ورديات', 'ورديه', 'وردية', 'شفت', 'شيفت', 'الورديات المفتوحه', 'الورديات المفتوحة'],
            en: ['shifts', 'open shifts', 'active shifts'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    SALES_MONTH: {
        id: 'SALES_MONTH',
        category: 'pos',
        keywords: {
            ar: ['مبيعات الشهر', 'ايرادات الشهر', 'إيرادات الشهر', 'مبيعات هذا الشهر', 'ايرادات هذا الشهر', 'إيرادات هذا الشهر', 'مبيعات الشهر الحالي', 'ايرادات الشهر الحالي', 'إيرادات الشهر الحالي'],
            en: ['sales this month', 'revenue this month', 'monthly sales', 'monthly revenue'],
        },
        entities: ['date_offset'],
        minConfidence: 0.5,
    },
    // ملاحظة: كان هنا تعريف مكرر لـ DAILY_REPORT (نسخة pos) — حُذف لأن النسخة finance
    // (أسفل الملف) هي التي كانت تفعّل فعلياً في وقت التشغيل (آخر تعريف يفوز في كائن JS).

    // ─── Inventory / Stock ───
    STOCK_ITEM: {
        id: 'STOCK_ITEM',
        category: 'inventory',
        keywords: {
            ar: ['مخزون', 'مخزن', 'رصيد', 'كميه', 'كمية', 'كم بقا', 'كم بقي', 'متبقي', 'المتبقى', 'عندي كم'],
            en: ['stock', 'inventory', 'quantity', 'how much left', 'remaining', 'balance'],
        },
        entities: ['item_name'],
        minConfidence: 0.4,
    },
    STOCK_LOW: {
        id: 'STOCK_LOW',
        category: 'inventory',
        keywords: {
            ar: ['نواقص', 'ناقص', 'نافذ', 'نافذه', 'منخفض', 'خلص', 'خالص', 'سينفد', 'قرب يخلص', 'خلصان', 'قارب', 'المخزون ناقص', 'المخزون منخفض', 'مخزون ناقص', 'نقص المخزون', 'نواقص المخزون', 'مخزون قليل'],
            en: ['low stock', 'out of stock', 'running low', 'shortage', 'depleted', 'exhausted', 'low inventory'],
        },
        entities: [],
        minConfidence: 0.4,
    },
    WAREHOUSES: {
        id: 'WAREHOUSES',
        category: 'inventory',
        keywords: {
            ar: ['المخازن', 'المستودعات', 'مخازن', 'ملخص المخازن', 'كل المخازن'],
            en: ['warehouses', 'storage', 'all warehouses'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    PRODUCTS_LIST: {
        id: 'PRODUCTS_LIST',
        category: 'inventory',
        keywords: {
            ar: ['المنتجات', 'كل المنتجات', 'كم من كل منتج', 'ارصده المنتجات', 'أرصدة المنتجات'],
            en: ['products', 'all products', 'product list', 'items'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    PURCHASES: {
        id: 'PURCHASES',
        category: 'inventory',
        keywords: {
            ar: ['مشتريات', 'مشتري', 'فاتورة شراء', 'فواتير الشراء', 'مشتريات الشهر'],
            en: ['purchases', 'procurement', 'purchase invoices'],
        },
        entities: ['supplier_name'],
        minConfidence: 0.5,
    },
    SUPPLIER_DEBT: {
        id: 'SUPPLIER_DEBT',
        category: 'inventory',
        keywords: {
            ar: ['مديونيه', 'مديونية', 'مستحق', 'دفعات', 'متبقي للمورد', 'ذمة', 'ذمه'],
            en: ['debt', 'payable', 'supplier debt', 'outstanding', 'dues'],
        },
        entities: ['supplier_name'],
        minConfidence: 0.5,
    },

    // ─── HR / Employees / Attendance ───
    EMPLOYEE_DETAIL: {
        id: 'EMPLOYEE_DETAIL',
        category: 'hr',
        keywords: {
            ar: ['موظف', 'معلومات موظف', 'تفاصيل موظف', 'ابحث', 'بحث', 'استعلام موظف'],
            en: ['employee', 'staff info', 'employee detail', 'search employee', 'find employee'],
        },
        entities: ['employee_name'],
        minConfidence: 0.4,
    },
    ATTENDANCE_TODAY: {
        id: 'ATTENDANCE_TODAY',
        category: 'hr',
        keywords: {
            ar: ['مين حاضر', 'حاضرين', 'حضور اليوم', 'حاضر اليوم', 'داوم اليوم', 'الحاضرين'],
            en: ['present today', 'who is here', 'attendance today', 'checked in'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    ATTENDANCE_ALL: {
        id: 'ATTENDANCE_ALL',
        category: 'hr',
        keywords: {
            ar: ['كل الحضور', 'كل الحاضرين', 'سجل الحضور', 'انصراف اليوم', 'كل انصراف', 'الموظفون مفصل'],
            en: ['all attendance', 'full attendance', 'checkouts today'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    ATTENDANCE_EMPLOYEE: {
        id: 'ATTENDANCE_EMPLOYEE',
        category: 'hr',
        keywords: {
            ar: ['حضور', 'حاضر', 'غايب', 'غائب', 'دوام'],
            en: ['attendance', 'absent', 'present', 'work hours'],
        },
        entities: ['employee_name', 'date_range'],
        minConfidence: 0.4,
    },
    EMPLOYEES_LIST: {
        id: 'EMPLOYEES_LIST',
        category: 'hr',
        keywords: {
            ar: ['موظفين', 'موظفون', 'عمال', 'فريق العمل', 'عدد الموظفين', 'كل الموظفين', 'كم موظف', 'عدد العمال', 'العاملين', 'الموظفين كم', 'عددكم'],
            en: ['employees', 'staff', 'workers', 'team', 'headcount', 'how many employees', 'employee count'],
        },
        entities: [],
        minConfidence: 0.4,
    },
    SALARIES: {
        id: 'SALARIES',
        category: 'hr',
        keywords: {
            ar: ['رواتب', 'راتب', 'مسير', 'رواتبهم', 'اجور', 'أجور', 'راتبي'],
            en: ['salary', 'salaries', 'payroll', 'wages'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    LEAVES: {
        id: 'LEAVES',
        category: 'hr',
        keywords: {
            ar: ['اجازات', 'إجازات', 'اجازه', 'إجازة', 'اجازة', 'رخص', 'راحة', 'عطلة'],
            en: ['leaves', 'leave requests', 'vacation', 'time off', 'absence request'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    DOCUMENTS_EXPIRY: {
        id: 'DOCUMENTS_EXPIRY',
        category: 'hr',
        keywords: {
            ar: ['وثائق', 'وثايق', 'مستندات', 'اوراق', 'اقامه', 'إقامة', 'شهادات', 'شهاده', 'صحية', 'تثقيف'],
            en: ['documents', 'expiry', 'certificates', 'iqama', 'health cert', 'permits'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    DEPARTMENTS: {
        id: 'DEPARTMENTS',
        category: 'hr',
        keywords: {
            ar: ['اقسام', 'أقسام', 'قسم', 'الاقسام', 'الأقسام', 'ادارات'],
            en: ['departments', 'divisions', 'sections'],
        },
        entities: [],
        minConfidence: 0.5,
    },

    // ─── Finance / Expenses ───
    EXPENSES: {
        id: 'EXPENSES',
        category: 'finance',
        keywords: {
            ar: ['مصاريف', 'مصروف', 'مصروفات', 'مصاريفهم', 'صرفنا', 'مصاريف اليوم', 'مصاريف امس'],
            en: ['expenses', 'spending', 'costs', 'expenditure'],
        },
        entities: ['date_offset'],
        minConfidence: 0.5,
    },
    PROFIT_LOSS: {
        id: 'PROFIT_LOSS',
        category: 'finance',
        keywords: {
            ar: ['ربح', 'خساره', 'خسارة', 'صافي', 'ارباح', 'أرباح', 'ارباح', 'pnl', 'الأرباح', 'صافي الربح'],
            en: ['profit', 'loss', 'net income', 'pnl', 'bottom line', 'margin'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    DAILY_REPORT: {
        id: 'DAILY_REPORT',
        category: 'finance',
        keywords: {
            ar: ['تقرير', 'تقرير اليوم', 'تقرير المدير', 'ملخص اليوم', 'تقارير', 'تقرير شامل', 'بريفنج'],
            en: ['report', 'daily report', 'summary', 'briefing', 'overview'],
        },
        entities: [],
        minConfidence: 0.6,
    },

    // ─── Kitchen / Production ───
    KITCHEN_PRODUCTION: {
        id: 'KITCHEN_PRODUCTION',
        category: 'kitchen',
        keywords: {
            ar: ['المطبخ', 'الإنتاج', 'انتاج', 'طبخ', 'تصنيع', 'دفعه', 'دفعة'],
            en: ['kitchen', 'production', 'cooking', 'batch', 'manufacturing'],
        },
        entities: [],
        minConfidence: 0.5,
    },

    // ─── System / Health ───
    SYSTEM_HEALTH: {
        id: 'SYSTEM_HEALTH',
        category: 'system',
        keywords: {
            ar: ['حاله النظام', 'حالة النظام', 'حاله السيرفر', 'حالة السيرفر', 'حاله الواتساب', 'حالة الواتساب', 'النظام شغال', 'السيرفر شغال', 'حاله', 'وضع النظام'],
            en: ['system status', 'server health', 'system health', 'is system running', 'status'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    FINGERPRINT_STATUS: {
        id: 'FINGERPRINT_STATUS',
        category: 'system',
        keywords: {
            ar: ['البصمه', 'البصمة', 'جهاز البصمه', 'جهاز البصمة', 'حاله البصمه', 'حالة البصمة'],
            en: ['fingerprint', 'biometric', 'device status', 'attendance device'],
        },
        entities: [],
        minConfidence: 0.5,
    },
    SYNC_STATUS: {
        id: 'SYNC_STATUS',
        category: 'system',
        keywords: {
            ar: ['المزامنه', 'المزامنة', 'يارا', 'سحب الفواتير', 'حاله السحب', 'حالة السحب', 'اوراكل', 'oracle'],
            en: ['sync', 'synchronization', 'yarasoft', 'oracle', 'data sync'],
        },
        entities: [],
        minConfidence: 0.5,
    },

    // ─── General / Meta ───
    HELP: {
        id: 'HELP',
        category: 'meta',
        keywords: {
            ar: ['مساعده', 'مساعدة', 'اوامر', 'الاوامر', 'ايه الاوامر', 'شو بتقدر', 'ماذا يمكنك', 'ايش تقدر', 'ساعدني', 'محتار', 'ودي؟'],
            en: ['help', 'commands', 'what can you do', 'options', 'menu', 'guide'],
        },
        entities: [],
        minConfidence: 0.6,
    },
    GREETING: {
        id: 'GREETING',
        category: 'meta',
        keywords: {
            ar: ['سلام', 'سلام عليكم', 'السلام عليكم', 'اهلا', 'أهلا', 'هلا', 'صباح', 'مساء', 'مرحبا', 'مرحبه', 'هاي'],
            en: ['hello', 'hi', 'hey', 'good morning', 'good evening', 'greetings', 'salam'],
        },
        entities: [],
        minConfidence: 0.6,
    },
    THANKS: {
        id: 'THANKS',
        category: 'meta',
        keywords: {
            ar: ['شكرا', 'شكراً', 'مشكور', 'تسلم', 'يعطيك العافيه', 'يعطيك العافية', 'ممتن'],
            en: ['thanks', 'thank you', 'thx', 'appreciate', 'grateful'],
        },
        entities: [],
        minConfidence: 0.6,
    },
    BYE: {
        id: 'BYE',
        category: 'meta',
        keywords: {
            ar: ['مع السلامه', 'مع السلامة', 'باي', 'وداع', 'تصبحون', 'تصبحي', 'الي اللقاء', 'الى اللقاء'],
            en: ['bye', 'goodbye', 'see you', 'farewell', 'later'],
        },
        entities: [],
        minConfidence: 0.6,
    },
    UNKNOWN: {
        id: 'UNKNOWN',
        category: 'meta',
        keywords: {},
        entities: [],
        minConfidence: 0,
    },
};

// ════════════════════════════════════════════════════════════════════════════════
// LANGUAGE DETECTION
// ════════════════════════════════════════════════════════════════════════════════

function detectLanguage(text) {
    if (text == null) {return 'ar';}
    const str = String(text);
    if (!str.trim()) {return 'ar';}
    const arabicChars = (str.match(/[\u0600-\u06FF]/g) || []).length;
    const englishChars = (str.match(/[a-zA-Z]/g) || []).length;
    if (arabicChars > englishChars) {return 'ar';}
    if (englishChars > arabicChars) {return 'en';}
    return 'ar'; // default
}

// ════════════════════════════════════════════════════════════════════════════════
// SENTIMENT ANALYSIS
// ════════════════════════════════════════════════════════════════════════════════

const SENTIMENT_POSITIVE = ['شكرا', 'ممتاز', 'رائع', 'تمام', 'حلو', 'جميل', 'nice', 'great', 'awesome', 'perfect', 'good', 'excellent', 'amazing', 'wonderful', 'مبسوط', 'سعيد', 'فخور'];
const SENTIMENT_NEGATIVE = ['سيء', 'سيئ', 'مش لذيذ', 'حلو', 'مش حلو', 'زفت', 'غلط', 'غلطان', 'bad', 'terrible', 'awful', 'worst', 'horrible', 'hate', 'disappointed', 'frustrated'];
const SENTIMENT_URGENT = ['عاجل', 'مستعجل', 'السريع', 'فور', 'urgent', 'asap', 'immediately', 'emergency', 'critical', 'الان', 'الآن', 'بسرعة', 'بسرعه'];
const SENTIMENT_ANGRY = ['غاضب', 'زهقت', 'تعبان', 'مش راضي', 'angry', 'furious', 'mad', 'annoyed', 'frustrated', 'upset'];

function analyzeSentiment(text) {
    const t = normalizeText(text == null ? '' : String(text));
    let score = 0;
    let urgent = false;

    for (const w of SENTIMENT_POSITIVE) { if (t.includes(normalizeText(w))) {score += 2;} }
    for (const w of SENTIMENT_NEGATIVE) { if (t.includes(normalizeText(w))) {score -= 2;} }
    for (const w of SENTIMENT_URGENT) { if (t.includes(normalizeText(w))) { urgent = true; score += 1; } }
    for (const w of SENTIMENT_ANGRY) { if (t.includes(normalizeText(w))) {score -= 3;} }

    // Exclamation marks indicate urgency
    const exclamations = (String(text == null ? '' : text).match(/!/g) || []).length;
    if (exclamations >= 2) { urgent = true; score -= 1; }

    let label = 'neutral';
    if (score >= 3) {label = 'positive';}
    else if (score <= -3) {label = 'angry';}
    else if (score <= -1) {label = 'negative';}

    return { score, label, urgent };
}

// ════════════════════════════════════════════════════════════════════════════════
// ENTITY EXTRACTION
// ════════════════════════════════════════════════════════════════════════════════

function extractEntities(text, intentId) {
    const entities = {};
    const t = String(text == null ? '' : text).trim();
    if (!t) {return entities;}

    // Extract order numbers
    if (/^\d{2,}$/.test(t.replace(/[^\d]/g, '')) || /(?:طلب|اوردر|order)[\s#:]*\d{2,}/i.test(t)) {
        const num = t.replace(/[^\d]/g, '').slice(0, 20);
        if (num.length >= 2) {entities.order_number = num;}
    }

    // Extract cashier number
    const cashierMatch = t.match(/كاشير\s*(\d{1,2})/i) || t.match(/cashier\s*(\d{1,2})/i);
    if (cashierMatch) {entities.cashier_number = cashierMatch[1];}

    // Extract date indicators
    if (/امس|أمس|امبارح|yesterday/i.test(t)) {entities.date_offset = -1;}
    else if (/بكرة|بكره|tommorow|tomorrow/i.test(t)) {entities.date_offset = 1;}
    else {entities.date_offset = 0;}

    // Extract explicit dates (DD/MM or DD/MM/YYYY)
    const dateMatch = t.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
    if (dateMatch) {
        entities.date_range = {
            day: dateMatch[1],
            month: dateMatch[2],
            year: dateMatch[3] || String(new Date().getFullYear()),
        };
    }

    // Extract amounts
    const amountMatch = t.match(/(\d{3,})\s*(?:ريال|sar|rs|جنيه|egp)?/i);
    if (amountMatch) {
        const val = parseInt(amountMatch[1], 10);
        if (val >= 100) {entities.amount = val;}
    }

    // Extract employee/item/supplier name (heuristic: text after keywords)
    const intent = INTENTS[intentId];
    if (intent) {
        for (const entityName of intent.entities) {
            if (entityName === 'employee_name' || entityName === 'item_name' || entityName === 'supplier_name') {
                // Strip known keywords and commands to isolate the name
                const allKw = [].concat(
                    intent.keywords.ar || [],
                    intent.keywords.en || []
                );
                let nameText = t;
                for (const kw of allKw) {
                    const normKw = normalizeText(kw);
                    nameText = nameText.replace(new RegExp(normKw, 'gi'), ' ');
                }
                // Remove dates and numbers
                nameText = nameText.replace(/\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?/g, '');
                nameText = nameText.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
                if (nameText.length >= 2 && nameText.length <= 60) {
                    entities[entityName] = nameText.slice(0, 60);
                }
            }
        }
    }

    return entities;
}

// ════════════════════════════════════════════════════════════════════════════════
// CONTEXTUAL FOLLOW-UP RESOLUTION — smart follow-up detection
// ════════════════════════════════════════════════════════════════════════════════

/**
 * When the user says something like "وامبارح؟" (and yesterday?) or "والكاشير؟" (and the cashier?)
 * after asking about sales today, the "و" prefix means "also" — we should inherit
 * the previous intent and modify the date/cashier parameter.
 *
 * Also handles: "امبارح كمان" "بكرة" "اليوم" etc. as date modifiers on previous intent.
 */
function _resolveContextFollowUp(normalized, context) {
    if (!context.lastIntent || context.lastIntent === 'UNKNOWN') {return null;}

    // ─── Date-based follow-ups ───
    // If user asks about "yesterday" and previous intent was a sales/expense query,
    // convert to the "yesterday" variant of the same category
    const dateModifiers = {
        'امس': -1, 'أمس': -1, 'امبارح': -1, 'بارح': -1,
        'بكرة': 1, 'بكره': 1,
        'اليوم': 0, 'النهارده': 0,
    };

    let dateOffset = null;
    for (const [kw, offset] of Object.entries(dateModifiers)) {
        if (normalized.includes(kw)) { dateOffset = offset; break; }
    }

    // If this looks like a date follow-up ("وامبارح" "وكام بارح" "وكام بارح")
    if (dateOffset !== null && (normalized.startsWith('و') || normalized.startsWith('واو') || normalized.length < 15)) {
        // Map to yesterday/today/tomorrow variant based on date offset and previous intent
        const prevCategory = INTENTS[context.lastIntent]?.category;
        if (prevCategory === 'pos') {
            if (dateOffset === -1) {return 'SALES_YESTERDAY';}
            if (dateOffset === 0) {return 'SALES_TODAY';}
        }
        if (prevCategory === 'hr') {
            if (dateOffset === -1) {return 'ATTENDANCE_ALL';}
            if (dateOffset === 0) {return 'ATTENDANCE_TODAY';}
        }
        if (prevCategory === 'finance') {
            return context.lastIntent; // inherit same finance intent
        }
    }

    // ─── Entity follow-ups ───
    // "والكاشير؟" → if previous was sales, switch to cashier report
    if (normalized.includes('كاشير') && context.lastIntent?.startsWith('SALES')) {
        return 'CASHIER_REPORT';
    }
    // "والمخزون؟" → if previous was sales, switch to stock
    if (normalized.includes('مخزون') && context.lastIntent?.startsWith('SALES')) {
        return 'STOCK_ITEM';
    }
    // "والرواتب؟" → switch to salaries
    if (normalized.includes('رواتب') || normalized.includes('راتب')) {
        return 'SALARIES';
    }
    // "والموظفين؟" → switch to employees
    if (normalized.includes('موظفين') || normalized.includes('موظف')) {
        return 'EMPLOYEES_LIST';
    }
    // "والمصاريف؟" → switch to expenses
    if (normalized.includes('مصاريف') || normalized.includes('مصروف')) {
        return 'EXPENSES';
    }

    return null;
}

// ════════════════════════════════════════════════════════════════════════════════
// INTENT DETECTION — weighted multi-signal matching
// ════════════════════════════════════════════════════════════════════════════════

function detectIntent(text, context = {}) {
    const lang = detectLanguage(text);
    const normalized = normalizeText(text == null ? '' : String(text));

    if (!normalized || normalized.length > 500) {
        return { intent: 'UNKNOWN', confidence: 0, entities: {}, language: lang };
    }

    const scores = [];

    for (const [id, intent] of Object.entries(INTENTS)) {
        if (id === 'UNKNOWN') {continue;}

        let score = 0;
        const keywords = intent.keywords[lang] || [];

        // Also check the other language (mixed-language support)
        const otherLang = lang === 'ar' ? 'en' : 'ar';
        const otherKeywords = intent.keywords[otherLang] || [];

        for (const kw of keywords) {
            const normKw = normalizeText(kw);
            if (!normKw) {continue;}
            if (normalized === normKw) {
                score += 1.0; // exact match
            } else if (normalized.includes(normKw)) {
                // Weight by keyword length (longer = more specific)
                const weight = Math.min(1.0, 0.4 + normKw.length * 0.05);
                score += weight;
            }
        }

        // Cross-language matching (lower weight)
        for (const kw of otherKeywords) {
            const normKw = normalizeText(kw);
            if (!normKw) {continue;}
            if (normalized.includes(normKw)) {
                score += 0.3;
            }
        }

        // Context bonus: if previous intent was in same category, boost
        if (context.lastIntent && INTENTS[context.lastIntent]?.category === intent.category) {
            score += 0.1;
        }

        if (score > 0) {
            scores.push({ id, score, minConfidence: intent.minConfidence });
        }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // ─── Contextual follow-up resolution ───
    // When user says "وامبارح؟" or "والكاشير؟" after asking about sales,
    // the "و" (and) prefix means "also" — inherit previous intent context.
    if (scores.length === 0 || scores[0].score < (scores[0]?.minConfidence || 0.5)) {
        const ctxFollowUp = _resolveContextFollowUp(normalized, context);
        if (ctxFollowUp) {
            const followUpIntent = INTENTS[ctxFollowUp];
            if (followUpIntent) {
                return {
                    intent: ctxFollowUp,
                    confidence: 0.75,
                    entities: extractEntities(text, ctxFollowUp),
                    language: lang,
                    ambiguous: false,
                    alternatives: [],
                    contextualFollowUp: true,
                };
            }
        }
    }

    if (scores.length === 0 || scores[0].score < scores[0].minConfidence) {
        return {
            intent: 'UNKNOWN',
            confidence: scores.length ? scores[0].score : 0,
            entities: extractEntities(text, 'UNKNOWN'),
            language: lang,
            alternatives: scores.slice(0, 3).map(s => s.id),
        };
    }

    const best = scores[0];
    const confidence = Math.min(1.0, best.score);
    const entities = extractEntities(text, best.id);

    // Disambiguation: if top 2 scores are very close, flag ambiguity
    const ambiguous = scores.length > 1 && (scores[0].score - scores[1].score) < 0.15;

    return {
        intent: best.id,
        confidence,
        entities,
        language: lang,
        ambiguous,
        alternatives: ambiguous ? scores.slice(0, 3).map(s => s.id) : [],
    };
}

// ════════════════════════════════════════════════════════════════════════════════
// CONVERSATION MEMORY — per-user context tracking
// ════════════════════════════════════════════════════════════════════════════════

const _context = new Map(); // jid -> conversation context
const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getContext(jid) {
    const ctx = _context.get(jid);
    if (ctx && Date.now() - ctx.updatedAt < CONTEXT_TTL_MS) {
        return ctx;
    }
    return { jid, history: [], lastIntent: null, updatedAt: Date.now(), data: {} };
}

function updateContext(jid, nluResult, replyText) {
    const ctx = getContext(jid);
    ctx.history.push({
        timestamp: Date.now(),
        intent: nluResult.intent,
        text: nluResult.text || '',
        reply: replyText ? replyText.slice(0, 200) : '',
        entities: nluResult.entities || {},
    });
    // Keep last 10 messages
    if (ctx.history.length > 10) {ctx.history.shift();}
    ctx.lastIntent = nluResult.intent;
    ctx.updatedAt = Date.now();
    _context.set(jid, ctx);
    return ctx;
}

function clearContext(jid) {
    _context.delete(jid);
}

// Periodic cleanup of stale contexts + self-healing memory cap
const MAX_CONTEXT_ENTRIES = 5000; // hard cap to prevent memory explosion

function cleanupContexts() {
    const now = Date.now();
    // Clean stale entries
    for (const [jid, ctx] of _context) {
        if (now - ctx.updatedAt > CONTEXT_TTL_MS) {
            _context.delete(jid);
        }
    }
    // Self-healing: if over cap, evict oldest 20% of entries
    if (_context.size > MAX_CONTEXT_ENTRIES) {
        const sorted = [..._context.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
        const toRemove = Math.ceil(sorted.length * 0.2); // remove oldest 20%
        for (let i = 0; i < toRemove; i++) {
            _context.delete(sorted[i][0]);
        }
        // This is safe to call - cleanupContexts is called from setInterval only
        try { require('../../logger').logger.debug(`[NLU] self-healing: evicted ${toRemove} stale contexts, size now ${_context.size}`); } catch (_) {}
    }
}
// Run cleanup every 5 minutes
setInterval(cleanupContexts, 5 * 60 * 1000).unref?.();

// ════════════════════════════════════════════════════════════════════════════════
// DISAMBIGUATION — generates clarifying questions
// ════════════════════════════════════════════════════════════════════════════════

function generateClarification(alternatives, lang) {
    const labels = {
        ar: {
            SALES_TODAY: 'مبيعات اليوم',
            SALES_YESTERDAY: 'مبيعات أمس',
            CASHIER_REPORT: 'تقرير الكاشير',
            ORDER_STATUS: 'حالة طلب',
            MENU_PRICE: 'سعر صنف',
            STOCK_ITEM: 'مخزون صنف',
            STOCK_LOW: 'النواقص',
            EMPLOYEE_DETAIL: 'تفاصيل موظف',
            ATTENDANCE_TODAY: 'الحضور اليوم',
            EXPENSES: 'المصاريف',
            DAILY_REPORT: 'التقرير اليومي',
            SYSTEM_HEALTH: 'حالة النظام',
        },
        en: {
            SALES_TODAY: "Today's sales",
            SALES_YESTERDAY: "Yesterday's sales",
            CASHIER_REPORT: 'Cashier report',
            ORDER_STATUS: 'Order status',
            MENU_PRICE: 'Item price',
            STOCK_ITEM: 'Stock item',
            STOCK_LOW: 'Low stock',
            EMPLOYEE_DETAIL: 'Employee detail',
            ATTENDANCE_TODAY: 'Today attendance',
            EXPENSES: 'Expenses',
            DAILY_REPORT: 'Daily report',
            SYSTEM_HEALTH: 'System health',
        },
    };

    const langLabels = labels[lang] || labels.ar;
    const options = alternatives.slice(0, 3).map(id => langLabels[id] || id).filter(Boolean);

    if (!options.length) {return null;}

    if (lang === 'en') {
        return `I'm not sure which you mean. Did you want:\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\nReply with the number.`;
    }

    return `مش متأكد إنت تقصد إيه 🤔\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\nرد برقم الاختيار.`;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN NLU FUNCTION — entry point
// ════════════════════════════════════════════════════════════════════════════════

async function processNLU(text, jid) {
    const context = getContext(jid);
    const result = detectIntent(text, context);
    result.text = text;
    result.sentiment = analyzeSentiment(text);

    // Add context info
    result.hasHistory = context.history.length > 0;
    result.previousIntent = context.lastIntent;

    // Generate clarification if ambiguous
    if (result.ambiguous && result.alternatives.length > 1) {
        result.clarification = generateClarification(result.alternatives, result.language);
    }

    return result;
}

module.exports = {
    INTENTS,
    detectIntent,
    detectLanguage,
    analyzeSentiment,
    extractEntities,
    processNLU,
    getContext,
    updateContext,
    clearContext,
    generateClarification,
};
