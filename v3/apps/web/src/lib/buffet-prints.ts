/**
 * buffet-prints.ts — كروت البوفيه «العالمية» + ورقة السبورة (غداء/عشاء).
 * تُطبع عبر printSmart (نفس جسر الطباعة العالمي). كل رقم يظهر موسومًا «تقديري».
 * المصادر تُكتب في النسخة «الاحترافية» حصرًا (USDA FDC + EU FIC 1169/2011).
 */

import { printSmart } from './print-viewer';
import type { BuffetDish, BuffetNutrition } from './buffet';
import { CARD_FONT_CSS } from './card-fonts';
import { COMPANY_LOGO as LOGO } from './company-logo';


export interface PrintOptions {
    /** طبعة احترافية — تظهر المصادر أسفل الورقة */
    pro?: boolean;
}

const esc = (v: unknown): string =>
    String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (n: number | null | undefined, digits = 1): string =>
    n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const numInt = (n: number | null | undefined): string =>
    n == null || Number.isNaN(Number(n)) ? '—' : String(Math.round(Number(n)));

function nutritionPerServing(dish: BuffetDish): { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; fiber: number | null; sodium: number | null; allergens: string[]; unmatched: number } | null {
    const n = dish.nutrition as BuffetNutrition | null | undefined;
    if (!n) {return null;}
    const low = n.perServing?.low;
    const src = low ?? n.totals; // عند غياب عائد محدد — تُعرض قيم الوعاء كاملًا (موسومة) لا تقدير مفترض
    return {
        kcal: src?.kcal ?? null,
        protein: src?.protein ?? null,
        carbs: src?.carbs ?? null,
        fat: src?.fat ?? null,
        fiber: src?.fiber ?? null,
        sodium: src?.sodium ?? null,
        allergens: n.allergenLabels ?? [],
        unmatched: (n.unmatched ?? []).length,
    };
}



const CARD_CSS = `
${CARD_FONT_CSS}
@page { size: A4; margin: 9mm; }
* { box-sizing: border-box; }
body { margin: 0; direction: rtl; font-family: 'Tajawal', 'Segoe UI', Tahoma, sans-serif; background: #EDEAE0; color: #141a14; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; align-content: start; }
.grid--single { grid-template-columns: 1fr; max-width: 96mm; margin: 0 auto; }
.card {
    background: linear-gradient(180deg, #FFFDF8 0%, #FBF8EC 100%);
    border: 1.2px solid #141a14;
    border-radius: 12px;
    box-shadow: inset 0 0 0 2.5px #c8a24a, inset 0 0 0 5px #FFFDF8;
    padding: 6mm 7mm 5.5mm;
    break-inside: avoid;
    page-break-inside: avoid;
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: relative;
}
.card__ribbon {
    display: flex; align-items: center; gap: 11px; direction: ltr;
    background: linear-gradient(135deg, #0d0f0b 0%, #141b12 55%, #1c241c 100%);
    border: 1px solid #05070a;
    border-radius: 9px;
    padding: 8px 12px;
    box-shadow: inset 0 0 0 1px rgba(200,162,74,.35);
}
.card__ribbon img { width: 42px; height: 42px; object-fit: contain; border-radius: 8px; background: #fff; border: 1.5px solid #c8a24a; }
.card__brand { letter-spacing: 3.4px; font-size: 9px; font-weight: 500; color: #d8c98a; text-align: left; line-height: 1.7; flex: 1; }
.card__brand b { color: #f4ecc9; font-weight: 800; }
.card__brand small { display: block; font-size: 6px; letter-spacing: 5.2px; color: #a89a68; font-weight: 700; margin-top: 2px; }
.card__eyebrow { font-size: 6.8px; letter-spacing: 4px; color: #8a6d2f; font-weight: 800; direction: ltr; display: flex; align-items: center; gap: 8px; }
.card__eyebrow::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, #c8a24a, transparent); }
.card__title { font-family: 'Tajawal', 'Segoe UI', Tahoma, sans-serif; font-size: 24px; line-height: 1.35; color: #0d0f0b; font-weight: 800; margin: 0; letter-spacing: 0; }
.card__desc { font-size: 8.4px; color: #4e5a53; line-height: 1.95; margin: 0; }
.card__desc--empty { color: #b9b3a0; font-style: italic; }
.card__rule { display: flex; align-items: center; gap: 10px; margin: 1px 0; }
.card__rule i { font-style: normal; color: #c8a24a; font-size: 10px; line-height: 1; }
.card__rule span { flex: 1; height: 1px; background: linear-gradient(90deg, transparent, #c8a24a 18%, #c8a24a 82%, transparent); }
.card__h { font-family: 'Tajawal', 'Segoe UI', Tahoma, sans-serif; font-size: 7.8px; letter-spacing: 2.4px; color: #8a6d2f; font-weight: 700; display: flex; align-items: center; gap: 6px; }
.card__h span[dir="ltr"] { color: #141a14; font-size: 6.2px; letter-spacing: 1.5px; }
.card__ings { list-style: none; padding: 0; margin: 0; columns: 2; column-gap: 12px; }
.card__ings li { font-size: 8px; font-weight: 500; line-height: 1.8; break-inside: avoid; display: flex; gap: 4px; align-items: baseline; }
.card__ings li b { font-variant-numeric: tabular-nums; direction: ltr; color: #141a14; font-weight: 800; }
.card__nutri { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; background: #0d0f0b; border-radius: 8px; padding: 6px 5px; box-shadow: inset 0 0 0 1px rgba(200,162,74,.4); }
.card__nutri-cell { text-align: center; }
.card__nutri-num { display: block; font-size: 11px; font-weight: 800; color: #f4ecc9; direction: ltr; font-variant-numeric: tabular-nums; line-height: 1.15; }
.card__nutri-label { display: block; font-size: 5.2px; letter-spacing: 0.6px; color: #a89a68; font-weight: 700; margin-top: 1px; }
.card__allerg { font-size: 7.2px; color: #5a4623; background: #f7f3e6; border: 1px solid #e5d9b8; border-radius: 6px; padding: 5px 8px; line-height: 1.9; }
.card__allerg b { color: #8a6d2f; font-weight: 800; }
.card__foot { display: flex; justify-content: space-between; align-items: baseline; margin-top: auto; border-top: 2px solid #c8a24a; padding-top: 5px; font-size: 5.8px; color: #87928b; letter-spacing: 1.2px; }
.card__foot b { color: #8a6d2f; font-weight: 800; }
.card__foot code { direction: ltr; font-size: 5.8px; color: #a89a68; letter-spacing: 1px; }
.card__sources { font-size: 5.2px; color: #8a867a; line-height: 1.9; border-top: 1px dashed #d8d2bd; padding-top: 4px; margin: 4px 0 0; }
.card__unmatched { font-size: 5px; color: #b45309; line-height: 1.7; }
@media print { body { background: #fff; } }
`;

function cardHtml(dish: BuffetDish, opts: PrintOptions): string {
    const pp = nutritionPerServing(dish);
    const ings = dish.lines
        .map((l) => `<li><span>${esc(l.name)}</span></li>`)
        .join('');
    const description = (dish.description ?? '').trim();
    const allergens = pp?.allergens ?? [];
    const allergyHtml = allergens.length
        ? allergens.map((a) => `<span>${esc(a)}</span>`).join(' · ')
        : '<span>لا توجد مسببات حساسية معروفة (حسب المكوّنات المسجّلة)</span>';
    const ref = `BUFFET-CARD-${String(dish.id).padStart(3, '0')}`;
    const unmatchedNote = pp && pp.unmatched > 0
        ? `<p class="card__unmatched">مكوّنات خارج جدول USDA: ${pp.unmatched} — تُراجع لاحقًا، ولا تُقدَّر بأرقام وهمية.</p>`
        : '';
    const sources = opts.pro ? `
        <p class="card__sources">المصادر: USDA FoodData Central — SR Legacy · EU FIC 1169/2011 (القائمة الـ14 لمسببات الحساسية) · HACCP / ISO 22000 · القيم للحصة تقديرية من الوصفة وقد تختلف حسب مصدر الخامات.</p>` : '';
    return `<article class="card">
        <div class="card__ribbon">
            <img src="${LOGO}" alt="شعار مطاعم الشرفة العالمي" width="42" height="42">
            <div class="card__brand">AL SHURFA<br><b>AL ALAMI</b><small>RESTAURANTS</small></div>
        </div>
        <span class="card__eyebrow">BUFFET SELECTION</span>
        <h2 class="card__title">${esc(dish.name)}</h2>
        <p class="card__desc${description ? '' : ' card__desc--empty'}">${description ? esc(description) : 'نبذة الصنف قيد الإعداد — يراجعها الشيف'}</p>
        <div class="card__rule" aria-hidden="true"><span></span><i>✦</i><span></span></div>
        <div class="card__h">المكونات · <span dir="ltr">INGREDIENTS</span></div>
        <ul class="card__ings">${ings || '<li><span>سجلّ المكوّنات قيد الإعداد</span></li>'}</ul>
        <div class="card__h">القيم الغذائية للحصة · <span dir="ltr">PER SERVING</span></div>
        <div class="card__nutri">
            <div class="card__nutri-cell"><span class="card__nutri-num">${numInt(pp?.kcal)}</span><span class="card__nutri-label">سعرات KCAL</span></div>
            <div class="card__nutri-cell"><span class="card__nutri-num">${num(pp?.protein)}</span><span class="card__nutri-label">بروتين G</span></div>
            <div class="card__nutri-cell"><span class="card__nutri-num">${num(pp?.carbs)}</span><span class="card__nutri-label">كارب G</span></div>
            <div class="card__nutri-cell"><span class="card__nutri-num">${num(pp?.fat)}</span><span class="card__nutri-label">دهون G</span></div>
            <div class="card__nutri-cell"><span class="card__nutri-num">${num(pp?.fiber)}</span><span class="card__nutri-label">ألياف G</span></div>
            <div class="card__nutri-cell"><span class="card__nutri-num">${numInt(pp?.sodium)}</span><span class="card__nutri-label">صوديوم MG</span></div>
        </div>
        <div class="card__allerg"><b>⚠ مسببات الحساسية:</b> ${allergyHtml}</div>
        ${unmatchedNote}
        <div class="card__foot"><span>بوفيه الشرفة العالمي · <b>AL SHURFA AL ALAMI</b></span><code>${ref} · 35–40 PER TRAY</code></div>
        ${sources}
    </article>`;
}

export function buildDishCardHtml(dish: BuffetDish, opts: PrintOptions = {}): string {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>${esc(dish.name)} — كرت البوفيه · AL SHURFA AL ALAMI</title>
<style>${CARD_CSS}</style>
</head>
<body>
<div class="grid grid--single">${cardHtml(dish, opts)}</div>
</body>
</html>`;
}

/** كل الكروت — كل ٤ كروت في صفحة A4 (٢×٢) */
export function buildAllCardsHtml(dishes: BuffetDish[], opts: PrintOptions = {}): string {
    const cards = dishes.map((d) => cardHtml(d, opts));
    const pages: string[] = [];
    for (let i = 0; i < cards.length; i += 4) {
        pages.push(`<div class="grid">${cards.slice(i, i + 4).join('')}</div>`);
    }
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>كروت بوفيه الشرفة العالمي · BUFFET CARDS</title>
<style>${CARD_CSS}
.grid { page-break-after: always; }
.grid:last-child { page-break-after: auto; }
</style>
</head>
<body>
${pages.join('')}
</body>
</html>`;
}

/** ورقة السبورة — غداء أو عشاء */
export function buildBoardHtml(day: string, meal: string, dishes: BuffetDish[], opts: PrintOptions = {}): string {
    const rows = dishes.map((d, i) => {
        const pp = nutritionPerServing(d);
        const allergens = pp?.allergens.length ? pp.allergens.join(' · ') : '—';
        return `<tr>
            <td class="b-num">${i + 1}</td>
            <td class="b-name">${esc(d.name)}</td>
            <td class="b-desc">${esc((d.description ?? '').trim() || '—')}</td>
            <td class="b-meta"><b>${numInt(pp?.kcal)}</b><span>سعرات</span></td>
            <td class="b-flag">${esc(allergens)}</td>
        </tr>`;
    }).join('');
    const sources = opts.pro ? `<p class="board__sources"><b>المصادر:</b> USDA FoodData Central — SR Legacy · EU FIC 1169/2011 · HACCP / ISO 22000 · القيم تقريبية</p>` : '';
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>ورقة السبورة — ${esc(meal)} ${esc(day)}</title>
<style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; direction: rtl; font-family: 'Segoe UI', Tahoma, 'Noto Kufi Arabic', sans-serif; background: #fff; color: #141a14; }
.board { padding: 2mm 2mm; }
.board__top { display: flex; align-items: center; gap: 12px; border-bottom: 3px double #c8a24a; padding-bottom: 8px; }
.board__top img { width: 46px; height: 46px; object-fit: contain; border-radius: 8px; background: #fffdf8; border: 1px solid #e5d9b8; }
.board__kicker { letter-spacing: 3px; font-size: 8px; color: #8a6d2f; font-weight: 800; direction: ltr; text-align: right; }
.board__top h1 { font-family: Georgia, 'Times New Roman', Tahoma, serif; font-size: 24px; margin: 2px 0 0; font-weight: 900; color: #141a14; }
.board__top h1 small { display: block; font-size: 9.5px; letter-spacing: 2px; color: #8a6d2f; font-family: 'Segoe UI', sans-serif; }
.board__meta { display: flex; gap: 14px; font-size: 8.5px; color: #4e5a53; border-bottom: 1px solid #e5d9b8; padding: 6px 0; margin-bottom: 8px; }
.board__haccp { background: #0d0f0b; color: #cbbd8d; border-radius: 6px; padding: 4px 10px; font-size: 7px; font-weight: 700; margin-bottom: 10px; letter-spacing: .5px; }
table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
th { background: #141a14; color: #cbbd8d; text-align: right; padding: 6px 8px; font-size: 8px; letter-spacing: 1px; }
td { border-bottom: 1px solid #eeeadd; padding: 6px 8px; vertical-align: middle; }
tr:nth-child(even) td { background: #faf8ee; }
.b-num { color: #a89a68; width: 26px; }
.b-name { font-weight: 800; width: 26%; }
.b-desc { color: #4e5a53; font-size: 8px; line-height: 1.7; }
.b-meta { width: 70px; text-align: center; }
.b-meta b { display: block; font-size: 13px; color: #141a14; direction: ltr; font-variant-numeric: tabular-nums; }
.b-meta span { font-size: 6px; color: #a89a68; letter-spacing: 1px; }
.b-flag { font-size: 7px; color: #5a4623; }
.board__foot { display: flex; justify-content: space-between; gap: 16px; margin-top: 12px; padding-top: 8px; border-top: 2px solid #141a14; font-size: 8px; color: #4e5a53; }
.board__foot b { display: inline-block; min-width: 100px; border-bottom: 1.5px solid #a89a68; }
.board__sources { font-size: 6.6px; color: #87928b; margin-top: 8px; border-top: 1px dashed #d8d2bd; padding-top: 6px; line-height: 1.9; }
</style>
</head>
<body>
<section class="board">
    <div class="board__top">
        <img src="${LOGO}" alt="شعار مطاعم الشرفة العالمي" width="46" height="46">
        <div>
            <div class="board__kicker">AL SHURFA AL ALAMI · KITCHEN BOARD</div>
            <h1>${esc(meal)} ${esc(day)}<small>ورقة السبورة · سفنديش 5 سم · تكفي 35–40 شخصًا</small></h1>
        </div>
    </div>
    <div class="board__meta"><span>فريق / Team: ____________________</span><span>عدد الأطباق / Pans: ________</span><span>التاريخ / Date: ________</span></div>
    <div class="board__haccp">HACCP · Hot ≥ 60°C · Cold ≤ 5°C · Reheat ≥ 75°C · FIFO · لا تخلط الدفعات</div>
    <table>
        <thead><tr><th>#</th><th>الصنف</th><th>نبذة</th><th>السعرات</th><th>مسببات الحساسية</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>
    <div class="board__foot"><span>إعداد الشيف / Chef: <b></b></span><span>مراجعة المساعد / Steward: <b></b></span><span>اعتماد المدير / Manager: <b></b></span></div>
    ${sources}
</section>
</body>
</html>`;
}

/** طباعة مستند واحد عبر جسر printSmart (Capacitor وWindows متّسقان تمامًا) */
export function printBuffetDoc(html: string): boolean {
    return printSmart(html, { autoPrint: true, printDelayMs: 350 });
}

/**
 * منيو/وصفة الصنف الرسمية — للشيف والفريق (داخلي).
 *  • كل المكونات **بكمياتها ووحداتها** كما في الوصفة المعتمدة
 *  • «طريقة التحضير» من حقل الوصفة (notes) — القيم حقيقية لأصناف البوفيه
 *  • القيم الغذائية + المسببات موسومة «تقديري USDA SR Legacy / EU FIC 1169/2011»
 *  • توقيعات: إعداد الشيف · مراجعة المساعد · اعتماد المدير + المصادر في «الاحترافية» فقط
 */
const RECIPE_CSS = `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; direction: rtl; font-family: 'Segoe UI', Tahoma, 'Noto Kufi Arabic', sans-serif; color: #141a14; background: #fff; }
.recipe { max-width: 180mm; margin: 0 auto; padding: 2mm 2mm; }
.recipe__top { display: flex; align-items: center; gap: 12px; border-bottom: 3px double #c8a24a; padding-bottom: 10px; }
.recipe__top img { width: 46px; height: 46px; object-fit: contain; border-radius: 8px; background: #fffdf8; border: 1px solid #e5d9b8; }
.recipe__kicker { letter-spacing: 3px; font-size: 8px; color: #8a6d2f; font-weight: 800; direction: ltr; }
.recipe__top h1 { font-family: Georgia, 'Times New Roman', Tahoma, serif; font-size: 23px; margin: 2px 0 0; font-weight: 900; color: #141a14; }
.recipe__top h1 small { display: block; font-size: 9px; letter-spacing: 1.5px; color: #8a6d2f; font-family: 'Segoe UI', sans-serif; }
.recipe__ref { margin-inline-start: auto; text-align: end; font-size: 8px; color: #8a6d2f; line-height: 1.8; font-weight: 700; direction: ltr; }
.recipe__ref b { font-size: 10px; letter-spacing: 1.5px; color: #141a14; direction: ltr; display: block; }
.recipe__desc { background: #f7f3e6; border: 1px solid #e5d9b8; border-radius: 8px; padding: 8px 12px; font-size: 9.5px; line-height: 2; color: #3d4a40; margin: 10px 0; }
.recipe__desc b { color: #8a6d2f; }
.recipe__h { font-size: 8px; letter-spacing: 2.5px; font-weight: 800; color: #8a6d2f; margin: 12px 0 6px; display: flex; align-items: center; gap: 8px; }
.recipe__h span[dir="ltr"] { color: #141a14; letter-spacing: 0; font-size: 7px; }
table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
thead th { background: #141a14; color: #cbbd8d; text-align: right; padding: 7px 10px; font-size: 8px; letter-spacing: 1px; }
tbody td { border-bottom: 1px solid #eeeadd; padding: 7px 10px; }
tbody tr:nth-child(even) td { background: #faf8ee; }
.r-num { color: #a89a68; width: 30px; }
.r-name { font-weight: 700; }
.r-qty { direction: ltr; text-align: start; width: 90px; font-variant-numeric: tabular-nums; }
.r-unit { width: 90px; color: #4e5a53; }
.recipe__method { background: #f7f6ef; border: 1px solid #e3dec9; border-inline-start: 4px solid #c8a24a; border-radius: 8px; padding: 10px 14px; font-size: 9px; line-height: 2.1; color: #24312a; white-space: pre-line; }
.recipe__nutri { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; background: #0d0f0b; border-radius: 8px; padding: 8px; }
.recipe__nutri-cell { text-align: center; }
.recipe__nutri-num { display: block; font-size: 12px; font-weight: 800; color: #f4ecc9; direction: ltr; font-variant-numeric: tabular-nums; }
.recipe__nutri-label { display: block; font-size: 5.8px; letter-spacing: 0.5px; color: #a89a68; font-weight: 700; }
.recipe__allerg { font-size: 8px; color: #5a4623; background: #f7f3e6; border: 1px solid #e5d9b8; border-radius: 6px; padding: 6px 10px; line-height: 1.9; margin-top: 8px; }
.recipe__allerg b { color: #8a6d2f; }
.recipe__cost { display: flex; gap: 12px; margin-top: 8px; font-size: 8.5px; color: #4e5a53; }
.recipe__cost b { direction: ltr; color: #141a14; font-variant-numeric: tabular-nums; }
.recipe__foot { display: flex; justify-content: space-between; gap: 12px; margin-top: 14px; padding-top: 8px; border-top: 2px solid #141a14; font-size: 8px; color: #4e5a53; }
.recipe__foot b { display: inline-block; min-width: 100px; border-bottom: 1.5px solid #a89a68; }
.recipe__sources { font-size: 6.6px; color: #87928b; margin-top: 8px; border-top: 1px dashed #d8d2bd; padding-top: 6px; line-height: 1.9; }
.recipe__miss { font-size: 6.6px; color: #b45309; margin-top: 6px; }
`;

function recipeBody(dish: BuffetDish, opts: PrintOptions = {}): string {
    const pp = nutritionPerServing(dish);
    const ref = `BUFFET-RECIPE-${String(dish.id).padStart(3, '0')}`;
    const description = (dish.description ?? '').trim();
    const method = (dish.notes ?? '').trim();
    const nutritionNote = pp?.unmatched && pp.unmatched > 0
        ? `مكوّنات خارج جدول USDA: ${pp.unmatched} — تُراجع لاحقًا.`
        : '';
    const ingredientsRows = dish.lines.map((line, i) => `
        <tr>
            <td class="r-num">${i + 1}</td>
            <td class="r-name">${esc(line.name)}</td>
            <td class="r-qty">${esc(line.qty)}</td>
            <td class="r-unit">${esc(line.unit)}</td>
        </tr>`).join('');
    const sources = opts.pro ? `<p class="recipe__sources"><b>المصادر:</b> USDA FoodData Central — SR Legacy · EU FIC 1169/2011 (القائمة الـ14 لمسببات الحساسية) · HACCP / ISO 22000 · القيم تقديرية وقد تختلف حسب مصدر الخامات.</p>` : '';
    return `<section class="recipe">
    <div class="recipe__top">
        <img src="${LOGO}" alt="شعار مطاعم الشرفة العالمي" width="46" height="46">
        <div>
            <div class="recipe__kicker">AL SHURFA AL ALAMI · BUFFET RECIPE</div>
            <h1>${esc(dish.name)}<small>${esc(dish.category)} · ${esc(dish.yields)} · يتكرر ×${esc(String(dish.freq))}</small></h1>
        </div>
        <div class="recipe__ref"><b>${ref}</b>INTERNAL · ${esc(new Date().toLocaleDateString('ar-SA'))}</div>
    </div>

    ${description ? `<p class="recipe__desc"><b>نبذة:</b> ${esc(description)}</p>` : ''}

    <h2 class="recipe__h">المكوّنات والمقادير · <span dir="ltr">INGREDIENTS</span></h2>
    <table>
        <thead><tr><th>#</th><th>المكوّن</th><th>الكمية</th><th>الوحدة</th></tr></thead>
        <tbody>${ingredientsRows || '<tr><td colspan="4" style="text-align:center;color:#a89a68;padding:16px">سجلّ المكوّنات قيد الإعداد</td></tr>'}</tbody>
    </table>

    <h2 class="recipe__h">طريقة التحضير · <span dir="ltr">METHOD</span></h2>
    <div class="recipe__method">${method ? esc(method) : 'طريقة التحضير: تُراجع مع الشيف التنفيذي (لم تُرفق بعد مع الوصفة المعتمدة).'}</div>

    <h2 class="recipe__h">القيم الغذائية للحصة · <span dir="ltr">NUTRITION / SERVING</span></h2>
    <div class="recipe__nutri">
        <div class="recipe__nutri-cell"><span class="recipe__nutri-num">${numInt(pp?.kcal)}</span><span class="recipe__nutri-label">سعرات KCAL</span></div>
        <div class="recipe__nutri-cell"><span class="recipe__nutri-num">${num(pp?.protein)}</span><span class="recipe__nutri-label">بروتين G</span></div>
        <div class="recipe__nutri-cell"><span class="recipe__nutri-num">${num(pp?.carbs)}</span><span class="recipe__nutri-label">كارب G</span></div>
        <div class="recipe__nutri-cell"><span class="recipe__nutri-num">${num(pp?.fat)}</span><span class="recipe__nutri-label">دهون G</span></div>
        <div class="recipe__nutri-cell"><span class="recipe__nutri-num">${num(pp?.fiber)}</span><span class="recipe__nutri-label">ألياف G</span></div>
        <div class="recipe__nutri-cell"><span class="recipe__nutri-num">${numInt(pp?.sodium)}</span><span class="recipe__nutri-label">صوديوم MG</span></div>
    </div>
    ${nutritionNote ? `<p class="recipe__miss">${esc(nutritionNote)}</p>` : ''}
    <div class="recipe__allerg"><b>⚠ مسببات الحساسية (EU FIC 1169/2011):</b> ${pp?.allergens?.length ? esc(pp.allergens.join(' · ')) : 'لا توجد مسببات معروفة (حسب المكونات المسجّلة)'}</div>

    <div class="recipe__cost"><span>تكلفة السفنديش (داخلي): <b>${num(dish.batchCost)} ر.س</b></span><span>العائد: <b>35–40 شخص</b></span><span>سطور مسعرة: <b>${dish.pricedLines}/${dish.totalLines}</b></span></div>

    <div class="recipe__foot"><span>إعداد الشيف / Chef: <b></b></span><span>مراجعة المساعد / Steward: <b></b></span><span>اعتماد المدير / Manager: <b></b></span></div>
    ${sources}
</section>`;
}

export function buildDishRecipeHtml(dish: BuffetDish, opts: PrintOptions = {}): string {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>منيو الصنف — ${esc(dish.name)} · AL SHURFA AL ALAMI</title>
<style>${RECIPE_CSS}</style>
</head>
<body>
${recipeBody(dish, opts)}
</body>
</html>`;
}

/** كل الوصفات — ورقة A4 لكل صنف */
export function buildAllRecipesHtml(dishes: BuffetDish[], opts: PrintOptions = {}): string {
    const pages = dishes.map((d) => `<div class="recipe-page">${recipeBody(d, opts)}</div>`);
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>منيو البوفيه الكامل — Buffet Recipe Packet</title>
<style>${RECIPE_CSS}
.recipe-page { page-break-after: always; }
.recipe-page:last-child { page-break-after: auto; }
</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`;
}

export function printDishCard(dish: BuffetDish, opts: PrintOptions = {}): boolean {
    return printBuffetDoc(buildDishCardHtml(dish, opts));
}

export function printAllCards(dishes: BuffetDish[], opts: PrintOptions = {}): boolean {
    return printBuffetDoc(buildAllCardsHtml(dishes, opts));
}

export function printBoard(day: string, meal: string, dishes: BuffetDish[], opts: PrintOptions = {}): boolean {
    return printBuffetDoc(buildBoardHtml(day, meal, dishes, opts));
}
