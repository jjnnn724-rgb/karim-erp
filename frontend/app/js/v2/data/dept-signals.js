/**
 * V2 — Dept signals: معلومات الأعمال لكل قسم (نموذج خالص)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS (طلب المالك 2026-10-19): «معلومات مفيدة في كل بطاقة قسم».
 * الشاشة كانت تعرض إيراد/مصروف/صافي فقط؛ فنسأل القاعدة عن الصورة الكاملة:
 *   · عدد الأصناف   — recipes.deptId      = كود القسم (finance-repo.js:20)
 *   · عدد الموظفين  — employees.department = كود القسم (employees.js:813)
 *   · أذون صرف      — dispatches.deptCode  = كود القسم (dispatch-repo.js:90)
 *
 * صفر خادم · صفر سكيمًا: دالّةٌ خالصةٌ بلا DOM ولا شبكة، تُختبر في node كما
 * تُشغَّل في المتصفح، وتُرسم البطاقة من ناتجها مباشرة. كل المقارنات نصّية على
 * كود القسم (لا أرقام هوية) لأن `deptId` في الإيراد/المصروف كودٌ لا id.
 */

/**
 * معلومات قسم واحد من ثلاث مصفوفات محمَّلة.
 * @param {string} code كود القسم (نصّيًا، بلا تطبيع حالة — الكود يُكتب موحّدًا)
 * @param {any[]} recipes صفوف /recipes: [{ deptId }]
 * @param {any[]} staff صفوف /employees: [{ department, status? }]
 * @param {any[]} dispatches صفوف /dispatches: [{ deptCode, status, date }]
 * @returns {{itemCount:number, staffCount:number, pending:number, last:string}}
 */
export function deptSignalsOf(code, recipes = [], staff = [], dispatches = []) {
    const key = String(code);
    let itemCount = 0;
    for (const r of recipes) { if (String((r && r.deptId) || '') === key) {itemCount += 1;} }
    let staffCount = 0;
    for (const e of staff) { if (String((e && e.department) || '') === key) {staffCount += 1;} }
    let pending = 0;
    let last = '';
    for (const d of dispatches) {
        if (String((d && d.deptCode) || '') !== key) {continue;}
        if (String(d.status) === 'pending') {pending += 1;}
        const t = String((d && d.date) || '').slice(0, 10);
        if (t > last) {last = t;}
    }
    return { itemCount, staffCount, pending, last };
}

/**
 * مجموع الأصناف/الموظفين عبر كل الأقسام (للمؤشرات العلوية).
 * @param {any[]} rows صفوف /departments
 */
export function deptSignalTotals(rows = [], recipes = [], staff = []) {
    const codes = new Set((rows || []).map((d) => String((d && d.code) || '')));
    const items = (recipes || []).filter((r) => codes.has(String((r && r.deptId) || ''))).length;
    const people = (staff || []).filter((e) => codes.has(String((e && e.department) || ''))).length;
    return { items, people };
}
