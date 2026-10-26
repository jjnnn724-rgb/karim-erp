/**
 * V2 — محرك البحث الذكي لأصناف فاتورة الشراء
 * ═══════════════════════════════════════════════════════════════════════
 *
 * النقل الأمين لـ`features/smart-item-search.js`: التطبيع يتجاهل التشكيل
 * والهمزات والتاء المربوطة والياء، وكل كلمة في الاستعلام يجب أن تطابق،
 * والترتيب: اسم تام 120 ثم بداية الاسم 100 ثم بداية كلمة 80 ثم احتواء 60.
 * الواجهة تتولى العرض و↑↓/Enter/Esc؛ هذا الملف نقي كي يُختبر في Node.
 *
 * مفتاح التفضيل هو مفتاح القديم نفسه (`karim_smart_search_v1`) حتى ينتقل
 * اختيار المستخدم من صفحة القديم إلى V2 بلا إعادة ضبط؛ والافتراضي مغلق.
 */

export const SMART_SEARCH_STORAGE_KEY = 'karim_smart_search_v1';
export const SMART_SEARCH_MAX = 30;

/** تطبيع عربي للمطابقة المتسامحة — normalizeAr حرفيًا. */
export function normalizeItemText(value) {
    return String(value || '').toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/\s+/g, ' ')
        .trim();
}

/** تقييم صنف ضد توكنات مطبَّعة — كل توكن يجب أن يطابق (scoreItem حرفيًا). */
export function scoreItemMatch(item, tokens) {
    const name = normalizeItemText(item && item.name);
    let score = 0;
    for (const token of tokens) {
        let part = 0;
        if (name === token) {part = 120;}
        else if (name.startsWith(token)) {part = 100;}
        else if (name.indexOf(` ${token}`) !== -1) {part = 80;}
        else if (name.indexOf(token) !== -1) {part = 60;}
        if (!part) {return 0;}
        score += part;
    }
    return score;
}

/** ترتيب الأصناف المطابقة — أعلى أولًا، والحد الأقصى 30 كما التجربة. */
export function rankItemMatches(items, query, max = SMART_SEARCH_MAX) {
    const tokens = normalizeItemText(query).split(' ').filter(Boolean);
    if (!tokens.length) {return [];}
    const cap = Number.isSafeInteger(Number(max)) && Number(max) > 0 ? Number(max) : SMART_SEARCH_MAX;
    return (Array.isArray(items) ? items : [])
        .map((item, index) => ({ item, index, score: scoreItemMatch(item, tokens) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, cap)
        .map((row) => row.item);
}

function resolveStorage(storage) {
    if (storage !== undefined) {return storage;}
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

export function smartSearchEnabled(storage) {
    try {
        const store = resolveStorage(storage);
        return !!store && store.getItem(SMART_SEARCH_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function setSmartSearchEnabled(on, storage) {
    try {
        const store = resolveStorage(storage);
        if (store) {store.setItem(SMART_SEARCH_STORAGE_KEY, on ? '1' : '0');}
    } catch {
        // التفضيل راحة عرض — تعذّر التخزين لا يعطّل الكتابة.
    }
}
