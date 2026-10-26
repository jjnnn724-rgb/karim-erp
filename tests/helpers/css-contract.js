/**
 * css-contract.js — أدوات مشتركة لعقود CSS في V2.
 * ═══════════════════════════════════════════════════════════════════════
 * لماذا: طبقة V2 تُعاد صياغتها باستمرار (سطر واحد ↔ أسطر متعدّدة، CSS
 * ينتقل بين erp-ops.css وerp-hr.css)، والعقد التي تثبّت النصّ الحرفي
 * تنكسر مع كل إعادة صياغة. الأدوات هنا تثبّت النية لا الصياغة:
 *   • ruleBody  → جسم قاعدة CSS مهما كان تنسيقها
 *   • hidesLabel → هل التسمية مخفية (display:none أو النمط البصري sr-only)
 *   • withoutSrOnly → يستثني قياس الإخفاء البصري (1px/-1px) من فحص الرموز
 *   • mediaBlocks → كل كتل @media بشرط معيّن (لا أول كتلة فقط)
 */
const flat = (s) => s.replace(/\r\n/g, '\n');

const ruleBody = (cssText, selector) => {
    const i = cssText.indexOf(selector);
    if (i < 0) { return ''; }
    const open = cssText.indexOf('{', i);
    const close = cssText.indexOf('}', open);
    return open < 0 || close < 0 ? '' : cssText.slice(open + 1, close);
};

/* الإخفاء: display:none أو النمط البصري (sr-only) — كلاهما يُبقي الرمز
   ظاهرًا ويبقى aria-label يسمّي الزرّ لقارئ الشاشة. */
const hidesLabel = (body) => /display:\s*none/.test(body)
    || (/position:\s*absolute/.test(body)
        && /inline-size:\s*1px/.test(body)
        && /clip-path:\s*inset\(50%\)/.test(body));

/* استثناء واحد: قياس الإخفاء البصري (1px و -1px) لا يقابله رمز --erp-*. */
const withoutSrOnly = (cssText) => cssText
    .replace(/inline-size:\s*1px\s*;/g, '')
    .replace(/block-size:\s*1px\s*;/g, '')
    .replace(/margin:\s*-1px\s*;/g, '');

const mediaBlocks = (cssText, condition) => [...cssText.matchAll(
    new RegExp('@media ' + condition + '\\s*\\{[\\s\\S]*?\\n\\}', 'g'))].map((m) => m[0]);

module.exports = { flat, ruleBody, hidesLabel, withoutSrOnly, mediaBlocks };
