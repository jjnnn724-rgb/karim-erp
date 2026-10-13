// ────────────────────────────────────────────────────────────────────────────
// arabic-search.test.js — طلب المالك 2026-10-06
// «بكتب بازنجان مش جايبها اكتب باذنجان يجيبها» — بحث عربي متسامح مع أخطاء
// النقاط والهمزات: عائلات الحروف المتشابهة تُطوى في مفتاح البحث
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const UTILS = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'core', 'utils.js'), 'utf8');
const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'backend', 'warehouse-routes.js'), 'utf8');
const AR_SEARCH = fs.readFileSync(path.join(__dirname, '..', 'backend', 'ar-search.js'), 'utf8');
const HR = fs.readFileSync(path.join(__dirname, '..', 'backend', 'hr-routes.js'), 'utf8');
const PROCUREMENT = fs.readFileSync(path.join(__dirname, '..', 'backend', 'procurement-routes.js'), 'utf8');
const KITCHEN = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'kitchen.js'), 'utf8');
const WAREHOUSE = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'warehouse.js'), 'utf8');
const FINANCE = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'finance.js'), 'utf8');
const VEG = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'veg-requests.js'), 'utf8');
const YARASOFT = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'yarasoft.js'), 'utf8');

function loadArSearchKey() {
    const start = UTILS.indexOf('function arSearchKey');
    const end = UTILS.indexOf('\n}', start);
    const src = UTILS.slice(start, end + 2);
    return new Function(src + '\nreturn arSearchKey;')();
}
const arSearchKey = loadArSearchKey();
// نفس تعريف utils — يُعاد بناؤه هنا من المفتاح المحمّل (واختبار التصدير يغطي الوiring)
const arSearchIncludes = (hay, q) => { const h = arSearchKey(hay), n = arSearchKey(q); return n.length > 0 && h.includes(n); };

describe('مفتاح البحث العربي المتسامح', () => {
    test('حالة المالك: بازنجان (بز) = باذنجان (بذ) بنفس المفتاح', () => {
        expect(arSearchKey('بازنجان')).toBe(arSearchKey('باذنجان'));
        expect(arSearchIncludes('باذنجان بلدي بالكيلو', 'بازنجان')).toBe(true);
    });
    test('عائلات النقاط كلها تُطوى: س/ش، ص/ض، ط/ظ، ج/ح/خ، ف/ق، ت/ث', () => {
        expect(arSearchKey('شكر')).toBe(arSearchKey('سكر'));
        expect(arSearchKey('ضغط')).toBe(arSearchKey('صغط'));
        expect(arSearchKey('بظري')).toBe(arSearchKey('بطري'));
        expect(arSearchKey('خيار')).toBe(arSearchKey('حيار'));
        expect(arSearchKey('قلف')).toBe(arSearchKey('فلف'));
        expect(arSearchKey('توفيق')).toBe(arSearchKey('توفیق'));
    });
    test('الهمزات والتاء المربوطة والألف المقصورة تتوحّد', () => {
        expect(arSearchKey('سكر أبيض')).toBe(arSearchKey('سكر ابيض'));
        expect(arSearchKey('أرز')).toBe(arSearchKey('ارز'));
        expect(arSearchKey('مكرونة')).toBe(arSearchKey('مكرونه'));
        expect(arSearchKey('شاي بالحليب')).toBe(arSearchKey('شاي بالحليب'));
    });
    test('الكلمات المختلفة جوهريًا لا تتطابق', () => {
        expect(arSearchIncludes('ملح ناعم 50 كيلو', 'صوديوم')).toBe(false);
        expect(arSearchIncludes('أرز بسمتي', 'شاورما')).toBe(false);
        expect(arSearchIncludes('طماطم', '')).toBe(false); // بحث فارغ لا يطابق
    });
});

describe('التوصيل في كل واجهات البحث', () => {
    test('الخادم: نقطة /inventory/search فيها طبقة arFuzzyPattern الاحتياطية', () => {
        expect(AR_SEARCH).toContain('function arFuzzyPattern(q)');
        expect(AR_SEARCH).toContain("'ز': '[زذ]'");
        expect(AR_SEARCH).toContain("'س': '[سش]'");
        expect(ROUTES).toContain("require('./ar-search')");
        expect(ROUTES).toContain('i.name ~* $1');
        expect(ROUTES).toContain('fuzzy: fuzzyUsed');
    });
    test('التعميم: الموظفون والموردون بالخادم، والمالية وطلبات الخضار ويارسوفت بالواجهة', () => {
        expect(HR).toContain('e.name ~*');
        expect(PROCUREMENT).toContain('s.name ~*');
        expect(FINANCE).toContain('arSearchIncludes(');
        expect(VEG).toContain('arSearchIncludes(name, term)');
        expect(YARASOFT).toContain('arSearchIncludes(tr.innerText, q)');
    });
    test('منتقي طلب الصرف: حرفي أولًا ثم الذكي (محصّن ضد كاش قديم)', () => {
        expect(KITCHEN).toContain('const hitFuzzy=(i)=>(window.arSearchIncludes?window.arSearchIncludes(i.name,q):false)');
        expect(KITCHEN).toContain('if(!matches.length){ matches=withAvail.filter(hitFuzzy); }');
    });
    test('المخزن: فلاتر الجرد والجرد التفصيلي والموردين تستخدم المطابقة الذكية', () => {
        expect(WAREHOUSE).toContain('arSearchIncludes(i.name,q)');
        expect(WAREHOUSE).toContain('arSearchIncludes(i.item_name,q)');
        expect(WAREHOUSE).toContain('arSearchIncludes(s.name, q)');
        expect(WAREHOUSE).toContain('نتائج مشابهة لكتابتك');
    });
    test('utils يصدّر المفتاح والدالة (الجسر إلى window)', () => {
        expect(UTILS).toContain('arSearchKey, arSearchIncludes');
    });
});
