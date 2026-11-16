/**
 * buffet-prints.ts — كروت البوفيه «العالمية» + ورقة السبورة (غداء/عشاء).
 * تُطبع عبر printSmart (نفس جسر الطباعة العالمي). كل رقم يظهر موسومًا «تقديري».
 * المصادر تُكتب في النسخة «الاحترافية» حصرًا (USDA FDC + EU FIC 1169/2011).
 */

import { printSmart } from './print-viewer';
import type { BuffetDish, BuffetNutrition } from './buffet';

const LOGO = 'data:image/jpeg;base64,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';

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
@page { size: A4; margin: 10mm; }
* { box-sizing: border-box; }
body { margin: 0; direction: rtl; font-family: 'Segoe UI', Tahoma, 'Noto Kufi Arabic', 'Noto Sans Arabic', sans-serif; background: #EDEAE0; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; align-content: start; }
.grid--single { grid-template-columns: 1fr; max-width: 92mm; margin: 0 auto; }
.card {
    background: #FFFDF8;
    border: 1px solid #141a14;
    border-radius: 10px;
    box-shadow: inset 0 0 0 3px #c8a24a, inset 0 0 0 6px #FFFDF8;
    padding: 7mm 7mm 6mm;
    break-inside: avoid;
    page-break-inside: avoid;
    display: flex;
    flex-direction: column;
    gap: 5px;
    position: relative;
}
.card__ribbon { display: flex; align-items: center; gap: 9px; border-bottom: 2.5px solid #c8a24a; padding-bottom: 6px; }
.card__ribbon img { width: 32px; height: 32px; object-fit: contain; border-radius: 6px; background: #fff; border: 1px solid #e5d9b8; }
.card__brand { letter-spacing: 2.8px; font-size: 8.5px; font-weight: 800; color: #8a6d2f; direction: ltr; text-align: right; line-height: 1.5; flex: 1; }
.card__brand small { display: block; font-size: 6px; letter-spacing: 4.6px; color: #a89a68; font-weight: 700; }
.card__eyebrow { font-size: 6.6px; letter-spacing: 3.2px; color: #b45309; font-weight: 800; direction: ltr; text-align: right; }
.card__title { font-family: Georgia, 'Times New Roman', Tahoma, serif; font-size: 21px; line-height: 1.25; color: #141a14; font-weight: 900; margin: 0; }
.card__desc { font-size: 8px; color: #4e5a53; line-height: 1.8; margin: 0; }
.card__desc--empty { color: #b9b3a0; font-style: italic; }
.rule { height: 1px; background: linear-gradient(90deg, transparent, #c8a24a, transparent); margin: 2px 0; }
.card__h { font-size: 7.6px; letter-spacing: 2.2px; color: #8a6d2f; font-weight: 800; display: flex; align-items: center; gap: 6px; }
.card__h span[dir="ltr"] { color: #141a14; font-size: 6.4px; }
.card__ings { list-style: none; padding: 0; margin: 0; columns: 2; column-gap: 12px; }
.card__ings li { font-size: 7.6px; line-height: 1.75; break-inside: avoid; display: flex; gap: 4px; align-items: baseline; }
.card__ings li b { font-variant-numeric: tabular-nums; direction: ltr; color: #141a14; font-weight: 700; }
.card__nutri { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; background: #0d0f0b; border-radius: 8px; padding: 5px 5px; }
.card__nutri-cell { text-align: center; }
.card__nutri-num { display: block; font-size: 10.5px; font-weight: 800; color: #f4ecc9; direction: ltr; font-variant-numeric: tabular-nums; line-height: 1.15; }
.card__nutri-label { display: block; font-size: 5.4px; letter-spacing: 0.5px; color: #a89a68; font-weight: 700; }
.card__allerg { font-size: 7px; color: #5a4623; background: #f7f3e6; border: 1px solid #e5d9b8; border-radius: 6px; padding: 4px 7px; line-height: 1.9; }
.card__allerg b { color: #8a6d2f; }
.card__foot { display: flex; justify-content: space-between; align-items: baseline; margin-top: auto; border-top: 1px solid #eeeadd; padding-top: 5px; font-size: 5.6px; color: #87928b; letter-spacing: 1.1px; }
.card__foot code { direction: ltr; font-size: 5.6px; color: #a89a68; }
.card__sources { font-size: 5.4px; color: #8a867a; line-height: 1.9; border-top: 1px dashed #d8d2bd; padding-top: 4px; margin: 4px 0 0; }
.card__unmatched { font-size: 5.2px; color: #b45309; line-height: 1.7; }
@media print { body { background: #fff; } }
`;

function cardHtml(dish: BuffetDish, opts: PrintOptions): string {
    const pp = nutritionPerServing(dish);
    const ings = dish.lines.map((l) =>
        `<li><b>${esc(l.qty)} ${esc(l.unit)}</b><span>${esc(l.name)}</span></li>`
    ).join('');
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
            <img src="${LOGO}" alt="شعار مطاعم الشرفة العالمي" width="32" height="32">
            <div class="card__brand">AL SHURFA<br>AL ALAMI<small>RESTAURANTS</small></div>
        </div>
        <span class="card__eyebrow">BUFFET SELECTION</span>
        <h2 class="card__title">${esc(dish.name)}</h2>
        <p class="card__desc${description ? '' : ' card__desc--empty'}">${description ? esc(description) : 'نبذة الصنف قيد الإعداد — يراجعها الشيف'}</p>
        <div class="rule"></div>
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
        <div class="card__foot"><span>بوفيه الشرفة العالمي · AL SHURFA AL ALAMI</span><code>${ref} · 35–40 PER TRAY</code></div>
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

export function printDishCard(dish: BuffetDish, opts: PrintOptions = {}): boolean {
    return printBuffetDoc(buildDishCardHtml(dish, opts));
}

export function printAllCards(dishes: BuffetDish[], opts: PrintOptions = {}): boolean {
    return printBuffetDoc(buildAllCardsHtml(dishes, opts));
}

export function printBoard(day: string, meal: string, dishes: BuffetDish[], opts: PrintOptions = {}): boolean {
    return printBuffetDoc(buildBoardHtml(day, meal, dishes, opts));
}
