'use strict';
/**
 * fix-mojibake.cjs — إصلاح النصوص العربية المشوّهة (UTF-8 قُرئت كـWindows-1256
 * ثم أُعيد كتابتها UTF-8 — نمط «ط§ظ„ط§ط³ظ…» بدل «الاسم»).
 *
 * كل حرف عربي UTF-8 = بايتان، وكل بايت يظهر كحرف CP1256 واحد — فالمقطع
 * المشوّه سلسلة أزواج ثنائية تنتهي إمّا بعلامة لاتينية شاذة (§ µ â € …) أو
 * بحرف CP1256 ممتد (پ چ ژ گ ھ ں). الخوارزمية تمسح يسارًا-يمينًا: عند حرف
 * قائد (ط ظ ق ك ل م ن ه و ي) يتبعه حرف شاذ، تُستهلك أزواج ثنائية وتُستعاد
 * تراكميًا — ويُقبل المقطع فقط إن كانت الاستعادة كلها نظيفة: بلا U+FFFD،
 * بلا لاتيني، وبلا علامات CP1256؛ والنص السليم لا يُلمس أبدًا.
 *
 * الاستعمال: node scripts/fix-mojibake.cjs <ملف1> [ملف2 …]
 */
const fs = require('fs');
const path = require('path');

const ICONV_PATH = path.join(__dirname, '..', 'v3', 'node_modules', '.pnpm', 'iconv-lite@0.6.3', 'node_modules', 'iconv-lite');
let iconv;
try {
    iconv = require(ICONV_PATH);
} catch (_) {
    console.error('[fix-mojibake] iconv-lite غير متاح من v3/node_modules — أوقفنا بلا تغيير.');
    process.exit(1);
}

/** حروف قائدة CP1256: بايتات 0xD8-0xE1 (ط ظ ق ك ل م ن ه و ي) + آ/أ/ا لبدايات
 *  متعددة البايتات (آ« = «، أ© = ©، ا— = — بقيادة C2/E2 تظهر آ/أ/ا) + â لسلاسل
 *  الأنظمة ثلاثية البايتات (â†’ = →، â€” = —، â€œ = «). */
const LEADS = new Set([...'\u0637\u0638\u0642\u0643\u0644\u0645\u0646\u0647\u0648\u064a\u0622\u0623\u0627\u00e2']);
/** حرف شاذ بعد القائد: علامات CP1256 كاملة + ؛/؟ (فقط وسط كلمة — راجع شرط
 *  الدخول في fixLine) + علامات CP1256 الممتدة (پ چ ژ گ ھ ں ٹ ک ˆ ‰ ‹ ›). */
const SUSPECT_NEXT = /[\u0080-\u00ff\u0152\u0153\u0178\u0192\u02c6\u02dc\u2000-\u206f\u20ac\u2122\u061b\u061f\u0679\u067e\u0686\u0698\u06a9\u06af\u06ba\u06be\u06cc\u06ad\u069f]/;
/** ما يُسمح به في النتيجة المستعادة: عربي أساسي، ASCII، ترقيم عربي مشروع،
 *  أسهم وخطوط فاصلة وعلامات ✓/✗ و− و• تنتج عن بايتات UTF-8 ثلاثية. */
const CLEAN_OK = /^[\u0020-\u007e\u0600-\u06ff\u200e\u200f\u200c\u200d\u00ab\u00bb\u2013\u2014\u2026\u2018\u2019\u201c\u201d\u2022\u2212\u2190-\u21ff\u2500-\u257f\u2605\u2606\u2700-\u27bf]+$/;
const HAS_ARABIC = /[\u0621-\u064a]/;

function recover(text) {
    const bytes = iconv.encode(text, 'windows-1256');
    const out = iconv.decode(bytes, 'utf8');
    if (out.includes('\ufffd') || !CLEAN_OK.test(out)) {
        return null;
    }
    // كل تشويه حقيقي يضغط الطول (بايتان/ثلاثة ⇒ حرف واحد) — أقوى من فحص «فيه عربي»
    // لأنه يسمح باستعادة علامات مثل «،» ويمنع الإشارات الخاطئة على نص سليم.
    if (out.length >= text.length) {
        return null;
    }
    return out;
}

function fixLine(line) {
    let result = '';
    let i = 0;
    let restored = 0;
    while (i < line.length) {
        if (LEADS.has(line[i]) && i + 1 < line.length && SUSPECT_NEXT.test(line[i + 1])) {
            // ؛/؟ حروف عربية سليمة بذاتها — نقبلها كتتمة تشويه فقط وسط كلمة:
            // الحرف بعدها يجب أن يكون قائدًا (لا مسافة ولا نهاية سطر).
            if ((line[i + 1] === '\u061b' || line[i + 1] === '\u061f') && !(i + 2 < line.length && LEADS.has(line[i + 2]))) {
                result += line[i];
                i += 1;
                continue;
            }
            // نبني المقطع أزواجًا (أو ثلاثيةً لـâ€” وأخواتها) ونستعيد تراكميًا.
            let units = [];
            let j = i;
            let accepted = null;
            while (j < line.length) {
                const step = line[j] === '\u00e2' ? 3 : 2;
                const unit = line.slice(j, j + step);
                if (unit.length < step) {
                    break;
                }
                // ؛/؟ داخل الامتداد: نفس شرط «وسط كلمة».
                if (unit.length === 2 && (unit[1] === '\u061b' || unit[1] === '\u061f') && !(j + 2 < line.length && LEADS.has(line[j + 2]))) {
                    break;
                }
                const candidate = units.join('') + unit;
                const recovered = recover(candidate);
                if (recovered !== null) {
                    units.push(unit);
                    accepted = recovered;
                    j += step;
                    continue;
                }
                break;
            }
            if (accepted !== null && units.length >= 1) {
                result += accepted;
                restored += 1;
                i = j;
                continue;
            }
        }
        result += line[i];
        i += 1;
    }
    return { line: result, restored };
}

function fixFile(file) {
    const original = fs.readFileSync(file, 'utf8');
    let total = 0;
    const lines = original.split('\n').map((line) => {
        if (!/[\u0080-\u00ff\u0152\u0153\u0178\u0192\u02c6\u02dc\u2000-\u206f\u20ac\u2122\u0679\u067e\u0686\u0698\u06a9\u06af\u06ba\u06be\u06cc]/.test(line)) {
            return line;
        }
        const fixed = fixLine(line);
        total += fixed.restored;
        return fixed.line;
    });
    const output = lines.join('\n');
    if (total > 0) {
        fs.writeFileSync(file, output, 'utf8');
    }
    console.log(`[fix-mojibake] ${path.relative(process.cwd(), file)}: استُعيدت ${total} سلسلة.`);
}

for (const file of process.argv.slice(2)) {
    fixFile(file);
}
