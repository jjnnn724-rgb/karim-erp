'use strict';

/**
 * buffet-match.js — محرك ربط مكوّنات البوفيه بأصناف المخزن (صرف، بلا I/O).
 *
 *  المبدأ:
 *   • كل اقتراح ربط يُعرض مع **سببه ودرجته** — لا سحر، لا صندوق أسود.
 *   • نربط تلقائيًا فقط ما تتجاوز درجته عتبة (default 0.80) — والباقي يُطرح
 *     للمراجعة في الواجهة (اعتماد/رفض لكل سطر + «اعتمد الكل»).
 *   • أي ربط يمر عبر نفس قواعد buffet-logic (تحويل الوحدات/pack_kg) لحظة الحساب.
 *
 *  الخوارزمية:
 *   1) تطبيع الاسمين (تجاهل التشكيل والهمزات والترقيم) + مرادفات على مستوى التوكن.
 *   2) IDF على توكنز المخزن — التوكن النادر يزن أكثر من الشائع («زعفران» >> «منتج»).
 *   3) احتساب تغطية التوكنز المشتركة + مكافأة «التوكن المميز المشترك» + مكافآت
 *      احتواء (كل توكنز المكوّن/المخزن داخل الطرف الآخر).
 *   4) يفكّ التعبئة من اسم الصنف «… N كيلو …» لحساب سعر الكيلو (pack_kg) — عبوة
 *      معلومة وزنها تُربط بثقة كاملة حتى لو اختلفت الوحدة الجذرية.
 *   5) التوكنز العامة (كرتون/كيس/علبة…) لا ودنها في التقييم — لا «بوابة توقيع» زائفة.
 */

const { normalizeName, parsePackKg, FACTORY_MARKERS } = require('./buffet-logic');

/* مرادفات على مستوى التوكن — تُطبق بعد التطبيع */
const TOKEN_SYNONYMS = {
    'رز': 'ارز', 'ارز': 'ارز', 'هت': 'ارز',
    'سكر': 'سكر', 'فروكت': 'سكر',
    'طحين': 'طحين', 'دقيق': 'طحين', 'سميد': 'سميد',
    'شعيرية': 'شعيريه', 'شعرية': 'شعيريه', 'شعيريه': 'شعيريه',
    'مكرونه': 'مكرونه', 'باستا': 'مكرونه',
    'هال': 'هيل', 'حبهان': 'هيل', 'هيل': 'هيل',
    'سمن': 'سمن', 'سمنه': 'سمن', 'زبده': 'زبده', 'ذبده': 'زبده', 'زيت': 'زيت',
    'لبن': 'حليب', 'حليب': 'حليب', 'زبادي': 'زبادي', 'رايب': 'زبادي',
    'كزبره': 'كزبره',
    'بقدونس': 'بقدونس',
    'لومي': 'لومي', 'بهار': 'بهارات', 'بهارات': 'بهارات', 'توابل': 'بهارات',
    'ملح': 'ملح', 'فلفل': 'فلفل', 'كمون': 'كمون', 'كركم': 'كركم', 'زعفران': 'زعفران',
    'بصل': 'بصل', 'ثوم': 'ثوم', 'طماطم': 'طماطم', 'بندوره': 'طماطم',
    'عدس': 'عدس', 'حمص': 'حمص', 'فول': 'فول', 'بازلاء': 'بازلاء', 'بسله': 'بازلاء',
    'قرنبيط': 'قرنبيط', 'زهره': 'قرنبيط', 'كوسه': 'كوسه', 'كوسا': 'كوسه', 'باذنجان': 'باذنجان',
    'لوز': 'لوز', 'جوز': 'جوز', 'كاجو': 'كاجو', 'فستق': 'فستق', 'صنوبر': 'صنوبر', 'سمسم': 'سمسم',
    'ورق غار': 'ورق غار', 'غار': 'ورق غار', 'لورا': 'ورق غار',
    'زنجبيل': 'زنجبيل', 'ليمون': 'ليمون', 'برتقال': 'برتقال', 'جزر': 'جزر', 'بطاطس': 'بطاطس',
    'دجاج': 'دجاج', 'فراخ': 'دجاج', 'لحم': 'لحم', 'ضاني': 'لحم', 'بقري': 'لحم',
    'سمك': 'سمك', 'سلمون': 'سمك', 'جمبري': 'روبيان', 'روبيان': 'روبيان',
    'مرق': 'مرق', 'صوص': 'مرق', 'شوربه': 'مرق',
    'زيتون': 'زيتون',
};

function norm(s) {
    return normalizeName(s)
        .split(' ')
        .map((t) => TOKEN_SYNONYMS[t] || t)
        .join(' ');
}

const STOP = new Set(['من', 'في', 'على', 'مع', 'او', 'و', 'علا', 'طازج', 'طازجة', 'طبيعي', 'الخام', 'للاستخدام', 'عند الحاجة', 'حسب الرغبة', 'الأصل', 'للوصفة']);

function tokens(name) {
    // استخراج التوكنز بالحدود بين الحروف والأرقام ليتكسر «بسمتي20» إلى [«بسمتي»،«20»]
    const out = norm(name).match(/[\u0621-\u064aa-zA-Z]+|[0-9]+/g) || [];
    return out.filter((t) => t.length >= 2 || /^[0-9]+$/.test(t))
        .filter((t) => !STOP.has(t));
}

/** بناء جدول IDF من أسماء أصناف المخزن */
function buildIdf(inventory) {
    const df = new Map();
    const docs = inventory.map((item) => tokens(item.name));
    for (const toks of docs) {
        const seen = new Set(toks);
        for (const t of seen) {df.set(t, (df.get(t) || 0) + 1);}
    }
    const n = docs.length;
    const idf = new Map();
    for (const [t, count] of df) {idf.set(t, Math.log((n + 1) / (count + 1)) + 1);}
    return { idf, docs };
}

const GENERIC_TOKENS = new Set(['كرتون', 'علبة', 'علبه', 'علب', 'كيس', 'شدة', 'جالون', 'تنك', 'باكت', 'بلوك', 'سطل', 'قطعه', 'قطعة', 'عدد', 'صالة', 'صاله', 'جملة', 'وحده']);

/**
 * علامات النوع الفرعي المميِّزة — إن وُجدت في أحد الطرفين وغابت عن الآخر،
 * فالاقتراح ليس مطابقة «قريبة» — نضع سقفه 0.5 (مراجعة بشرية إلزامية).
 * يغطي: ألوان (عدس أصفر/أحمر/أسود…)، «جوز هند»/«نارجيل» مقابل «جوز»،
 * ومشتقات صناعية (بودر/مطحون/مركز) مقابل الخام (يغطيها FACTORY_MARKERS أيضًا).
 */
const SUBTYPE_MARKERS = ['اسود', 'احمر', 'اصفر', 'ابيض', 'هند', 'نارجيل', 'بودر', 'مطحون', 'مركز'];

function subtypeConflict(ingNorm, invNorm) {
    const ingHas = SUBTYPE_MARKERS.some((m) => ingNorm.includes(m));
    const invHas = SUBTYPE_MARKERS.some((m) => invNorm.includes(m));
    if (ingHas === invHas) {return false;}
    // وجود العلامة في أحدهما فقط — تمييز نوع فرعي غير قابل للحدس
    return SUBTYPE_MARKERS.some((m) => ingNorm.includes(m) !== invNorm.includes(m));
}

/**
 * يحرز اقتراح ربط بين مكوّن ومصنف مخزن.
 * @returns {{score:number, reasons:string[], packKg:number|null}}
 */
function scoreMatch(ingredientName, inventoryItem, idf) {
    const ingNorm = norm(ingredientName);
    const invNorm = norm(inventoryItem.name);
    const ingTokens = tokens(ingredientName);
    const invTokens = tokens(inventoryItem.name);
    const reasons = [];

    // 1) تطابق خام كامل (مع التطبيع) — نادراً وواضح
    if (ingNorm === invNorm) {
        reasons.push('تطابق كامل للاسم');
        return { score: 1.0, reasons, packKg: parsePackKg(inventoryItem.name) };
    }

    // 2) علامات المصنع: إن كانت موجودة عند أحد الطرفين وغائبة عن الآخر — مرفوض (خام ≠ جاهز)
    const ingHasFactory = FACTORY_MARKERS.some((m) => ingNorm.includes(m));
    const invHasFactory = FACTORY_MARKERS.some((m) => invNorm.includes(m));
    if (ingHasFactory !== invHasFactory) {
        return { score: 0.0, reasons: ['خام مقابل مصنّع — مرفوض'], packKg: null };
    }

    const pack = parsePackKg(inventoryItem.name);

    // 3) الوزن بالتوكنز المشتركة (IDF) — التوكنز العامة (كرتون/كيس…) لا وزن لها
    const ingDistinct = [...new Set(ingTokens.filter((t) => !GENERIC_TOKENS.has(t)))];
    const invDistinct = [...new Set(invTokens.filter((t) => !GENERIC_TOKENS.has(t)))];
    const ingSet = new Set(ingTokens);

    let overlap = 0;
    let maxSharedIdf = 0;
    for (const t of invDistinct) {
        if (ingSet.has(t)) {
            const w = idf.get(t) || 1;
            overlap += w;
            maxSharedIdf = Math.max(maxSharedIdf, w);
        }
    }
    const unionWeight = [...new Set([...ingDistinct, ...invDistinct])].reduce((sum, t) => sum + (idf.get(t) || 1), 0);
    const coverage = unionWeight > 0 ? overlap / unionWeight : 0;

    // 4) احتواء التوكنز بين الطرفين
    const allIngInInv = ingDistinct.length > 0 && ingDistinct.every((t) => invTokens.includes(t));
    const allInvInIng = invDistinct.length > 0 && invDistinct.every((t) => ingTokens.includes(t));

    // 5) التوكن المميز المشترك (أعلى IDF مشترك)
    const rareBoost = maxSharedIdf > 0 ? Math.min(maxSharedIdf / 6, 1) * 0.25 : 0;

    // 6) مكافأة التوكن المميز الوحيد: مكوّن بتوكن تمييزي واحد مطابق تماما
    const singleTokenBoost = ingDistinct.length === 1 && invTokens.includes(ingDistinct[0]) ? 0.1 : 0;

    let score = 0;
    if (coverage > 0) {score += coverage * 0.55;}
    score += rareBoost;
    score += singleTokenBoost;
    if (allIngInInv) {score += 0.15; reasons.push('كل توكنز المكوّن موجودة في صنف المخزن');}
    if (allInvInIng) {score += 0.10; reasons.push('كل توكنز المخزن موجودة في المكوّن');}
    if (pack && pack > 0 && coverage > 0) {score += 0.4; reasons.push(`عبوة معلومة الوزن (${pack} كجم) — سعر الكيلو = العبوة ÷ ${pack}`);}

    // 6ب) توكن واحد مميز + احتواء كامل + مرشح يفضله بفارق ≤ كلمة واحدة → +0.25
    //    (يحتاج إحكام هنا: المستخدم يثق بالمحرك للاعتماد التلقائي فقط عندما يكون الرد واضحًا)
    if (ingDistinct.length === 1 && invTokens.includes(ingDistinct[0]) && invTokens.length - ingDistinct.length <= 1) {
        const singleName = ingDistinct[0];
        if (!reasons.includes('كل توكنز المخزن موجودة في المكوّن')) {
            // تجنب الإفراط في الكرتون/علبة فقط مع «زبادي -جالون»
            reasons.push(`المطابقة حتمية: «${singleName}» موجود حرفيًا في صنف المخزن`);
        }
        score = Math.min(1, score + 0.25);
    }

    // 6) الرأس: أول توكن مميز في المكوّن يجب أن يتكرر في اسم المخزن — «حليب جوز الهند» ≠ «جوز الهند»
    if (ingDistinct.length >= 1) {
        const head = ingDistinct[0];
        if (!invTokens.includes(head)) {
            score = Math.min(score, 0.5);
            reasons.push(`الرأس المميز «${head}» غائب عن صنف المخزن — مراجعة إلزامية`);
        }
    }

    score = Math.min(1, score);
    if (subtypeConflict(ingNorm, invNorm)) {
        score = Math.min(score, 0.5);
        reasons.push('تمييز نوع فرعي غير متطابق — مراجعة إلزامية');
    }
    if (score === 0 && reasons.length === 0) {reasons.push('لا تشابه');}
    return { score: Math.round(score * 100) / 100, reasons, packKg: pack };
}

/**
 * يجد أفضل اقتراح لكل مكوّن غير مربوط — مع خيارات بديلة مرتبة.
 * @param {Array<{id,name,unit,qty}>} ingredientLines — السطور المراد ربطها
 * @param {Array} inventory — أصناف المخزن (id,name,unit,avgCost)
 * @param {{threshold?:number, limitPerLine?:number}} [opts]
 */
function proposeLinks(ingredientLines, inventory, opts = {}) {
    const threshold = opts.threshold ?? 0.8;
    const { idf } = buildIdf(inventory);
    const proposals = [];
    for (const line of ingredientLines) {
        const scored = inventory
            .map((item) => {
                const { score, reasons, packKg } = scoreMatch(line.name, item, idf);
                return { item, score, reasons, packKg };
            })
            .filter((p) => p.score > 0)
            .sort((a, b) => b.score - a.score);
        const best = scored[0] ?? null;
        const top = scored.slice(0, 6).map((p) => ({
            inventoryId: String(p.item.id),
            name: p.item.name,
            unit: p.item.unit,
            avgCost: p.item.avgCost == null ? null : Number(p.item.avgCost),
            score: p.score,
            reasons: p.reasons,
            packKg: p.packKg,
        }));
        proposals.push({
            lineId: line.id,
            name: line.name,
            qty: line.qty,
            unit: line.unit,
            best: best ? top[0] : null,
            alternatives: top.slice(1),
            all: top,
        });
    }
    return { threshold, proposals };
}

/**
 * يجمّع الاقتراحات حسب اسم المكوّن (norm) — عرض الـN سطورا المتطابقة كقرار واحد.
 * @param proposals من proposeLinks
 */
function groupProposals(proposals) {
    const byKey = new Map();
    for (const p of proposals) {
        const key = norm(p.name);
        if (!byKey.has(key)) {
            byKey.set(key, { key, name: p.name, unit: p.unit, lines: [], best: p.best, alternatives: p.alternatives });
        }
        byKey.get(key).lines.push({ id: p.lineId, qty: p.qty, unit: p.unit });
    }
    return [...byKey.values()].sort((a, b) => (b.best?.score ?? 0) - (a.best?.score ?? 0));
}

module.exports = { scoreMatch, proposeLinks, groupProposals, norm, buildIdf };
