'use strict';
/**
 * strip-print-actions.cjs — إزالة أزرار الطباعة من رؤوس الشاشات (2026-11-21).
 * القرار: «الطباعة والمشاركة والتحميل في الصفحات بشكل احترافي مش في عنوان
 * كل صفحة» — زر موحد في الشريط العلوي (Shell) يحل محل <PrintActions/>.
 *
 * المنهجية: لكل ملف .tsx — حذف سطر الاستيراد، وحذف أسطر <PrintActions …/>
 * الذاتية الإغلاق (سطر واحد)، وحذف أي كتلة متعددة الأسطر ذاتية الإغلاق،
 * وحذف موكات vi.mock للمكون في الاختبارات. لا يلمس data-erp-print-hide
 * ولا المستندات الحقيقية (printSmart) إطلاقًا.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
if (!ROOT) {
    console.error('[strip] مسار src مطلوب');
    process.exit(1);
}

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full, out); } else if (entry.name.endsWith('.tsx')) { out.push(full); }
    }
    return out;
}

let changedFiles = 0;
let removedJsx = 0;
let removedImports = 0;
let removedMocks = 0;

for (const file of walk(ROOT)) {
    const original = fs.readFileSync(file, 'utf8');
    if (!original.includes('PrintActions')) { continue; }
    let src = original;

    // 1) سطر الاستيراد
    src = src.replace(/^\s*import \{ PrintActions \} from '\.\.\/components\/PrintActions';\r?\n/m, () => {
        removedImports += 1;
        return '';
    });
    src = src.replace(/^\s*import \{ PrintActions \} from '\.\/components\/PrintActions';\r?\n/m, () => {
        removedImports += 1;
        return '';
    });

    // 2) موك vi.mock للمكوّن (سطر واحد كامل بأي صيغة إغلاق)
    src = src.replace(/^\s*vi\.mock\(['"][^'"]*PrintActions['"]\s*,[^;]*\);\r?\n/m, () => {
        removedMocks += 1;
        return '';
    });

    // 3) استخدام ذاتي الإغلاق في سطر واحد
    src = src.replace(/^[ \t]*<PrintActions\b[^>]*\/>[ \t]*\r?\n/gm, () => {
        removedJsx += 1;
        return '';
    });

    // 4) استخدام متعدد الأسطر ذاتي الإغلاق: <PrintActions … /> عبر أسطر
    src = src.replace(/[ \t]*<PrintActions\b[^>]*?\/>[ \t]*\r?\n?/gs, (match) => {
        if (!match.includes('\n')) { return match; }
        removedJsx += 1;
        return '';
    });

    if (src !== original) {
        fs.writeFileSync(file, src, 'utf8');
        changedFiles += 1;
    }
}

console.log(`[strip] ملفات متغيرة: ${changedFiles} · استيرادات محذوفة: ${removedImports} · عناصر محذوفة: ${removedJsx} · موكات محذوفة: ${removedMocks}`);
