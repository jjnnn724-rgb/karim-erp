'use strict';
/**
 * business-time.js — الساعة المعتمدة للنظام كلها: Asia/Riyadh (توقيت مكة)
 * ═══════════════════════════════════════════════════════════════════════
 * قرار المالك 2026-11-02: «عايز توقيت مكة ومش عايز أي استثناء في الدوام».
 * لا ساعةً للموظفين وساعةً للمالية، ولا +2 مصريًا يوازي +3 في مكانٍ آخر:
 * منطقةٌ زمنيةٌ واحدة لكل شيء، بلا تغييرٍ موسمي، فالرقم الذي تراه شاشة
 * البطاقة هو نفسه الذي يراه كشف البصمات هو نفسه القيد المالي.
 *
 * التحويل عبر `Intl` بالمنطقة الزمنية (لا بإزاحةٍ ثابتةٍ مضروبة في 3600000)
 * حتى لا ينزلق يومٌ حول منتصف الليل حين يختلف فرق UTC من شهرٍ لشهر.
 */

/** المنطقة المعتمدة — قابلة للضبط من .env، وافتراضيها توقيت مكة. */
const BUSINESS_TZ = String(process.env.BUSINESS_DISPLAY_TZ || 'Asia/Riyadh').trim() || 'Asia/Riyadh';

const FULL_FMT = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

function norm(value) {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
}

function parts(value) {
    return Object.fromEntries(FULL_FMT.formatToParts(value).map(x => [x.type, x.value]));
}

/** 'YYYY-MM-DD' للتاريخ المدني في ساعة النظام. */
function wallDate(value) {
    const d = norm(value);
    if (!d) {return null;}
    const p = parts(d);
    return `${p.year}-${p.month}-${p.day}`;
}

/** 'HH:MM' كما تُقرأ على الشاشة. */
function wallTime(value) {
    const d = norm(value);
    if (!d) {return null;}
    const p = parts(d);
    return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** 'YYYY-MM-DD HH:MM:SS' كامل — للتحقق والمراجعة، ليس للعرض. */
function wallStamp(value) {
    const d = norm(value);
    if (!d) {return null;}
    return FULL_FMT.format(d).replace(',', ' ');
}

/** اليوم المدني + الساعة والدقيقة من تهيئةٍ واحدة. */
function wallParts(value) {
    const d = norm(value);
    if (!d) {return null;}
    const p = parts(d);
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour === '24' ? '0' : p.hour), minute: Number(p.minute) };
}

/** الإزاحة الفعلية بالدقائق لحظةََ ما — تثبت أن +3 قرارٌ لا تخمين. */
function offsetMinutes(value) {
    const d = norm(value) || new Date();
    const p = parts(d);
    const wallAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    const trueUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
    return Math.round((wallAsUtc - trueUtc) / 60000);
}

module.exports = { BUSINESS_TZ, wallDate, wallTime, wallStamp, wallParts, offsetMinutes };
