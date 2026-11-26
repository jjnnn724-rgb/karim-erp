/**
 * هوية الطباعة الموحّدة — تُحقن في كل ورقة تخرج من النظام.
 *
 * الشعار الأصلي (AL SHURFA AL ALAMI) مضمّن كـ data URI داخل HTML، فالورقة
 * تطبع حتى لو فُتحت من تبويب مستقل أو WebView بلا مسارات أو اتصال شبكة.
 */

import { BRAND_IMAGE_DATA_URI } from './brand-image';

export const BRAND_MARK_HTML = `<img src="${BRAND_IMAGE_DATA_URI}" alt="مطاعم الشرفة العالمي — AL SHURFA AL ALAMI RESTAURANTS" width="150" height="60" style="display:block;max-inline-size:180px;block-size:auto;object-fit:contain">`;

export const PRINT_BRAND_HTML = `<div class="karim-print-brand" data-print-brand>${BRAND_MARK_HTML}<span class="karim-print-brand__rule"></span></div>`;

export const PRINT_BRAND_CSS = `
.karim-print-brand{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-block:0 14px;padding-block-end:10px;border-block-end:2px solid #B08D57;direction:rtl}
.karim-print-brand__rule{flex:1;block-size:1px;background:linear-gradient(90deg,#B08D57,transparent);opacity:.65}
@media print{.karim-print-brand{break-inside:avoid;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;

/**
 * يضيف الشعار أعلى جسم الورقة إن لم يكن موجودًا، ويضيف تنسيقه داخل <head>.
 * آمن للتكرار: وجود `data-print-brand` يمنع الحقن مرتين.
 */
export function withPrintBrand(html: string): string {
    if (!html || html.includes('data-print-brand')) {
        return html;
    }
    let out = html;
    if (/<head[^>]*>/i.test(out)) {
        out = out.replace(/<head[^>]*>/i, (m) => `${m}<style>${PRINT_BRAND_CSS}</style>`);
    } else {
        out = `<head><meta charset="utf-8"><style>${PRINT_BRAND_CSS}</style></head>${out}`;
    }
    if (/<body[^>]*>/i.test(out)) {
        out = out.replace(/<body[^>]*>/i, (m) => `${m}${PRINT_BRAND_HTML}`);
    } else {
        out = out.replace(/<(main|html)[^>]*>/i, (m) => `${m}${PRINT_BRAND_HTML}`);
    }
    return out;
}
