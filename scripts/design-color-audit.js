#!/usr/bin/env node
'use strict';
/**
 * design-color-audit.js — بوابة «لا ألوان مرسومة حرفيًا» لملفات V2
 * ══════════════════════════════════════════════════════════════════════
 * القاعدة التي يفرضها هذا السكربت:
 *   ملفات css/v2/ تقرأ اللون من رموز --erp-* فقط. أي hex/rgb()/hsl()/لون
 *   مسمّى مكتوب يدويًا داخل قاعدة رسم = انجراف عن نظام التصميم، والبوابة
 *   تفشل (exit 1) كي لا يدخل الـdrift إلى المستودع.
 *
 * لماذا وُجد:
 *   القياس الحي (2026-10-23) وجد 8 ملفات فيها ألوان حرفية — منها أزرار
 *   معتمدة بخلفية #16a34a (خضراء خارج الهوية)، وصناديق drop-zone بيضاء
 *   تبقى بيضاء في الوضع الداكن (خلل حقيقي)، وشريط المعاينة بلون برونزي
 *   من العهد القديم. كلها أُصلحت، وهذه البوابة تمنع عودتها.
 *
 * الاستثناءات الموثّقة (أربعة ملفات فقط، كل واحد بسبب مُعلَن):
 *   · erp-tokens.css   طبقة الأسماء الدلالية فوق --karim-*؛ قيمها
 *                      الاحتياطية مرآةٌ لملف الإرث لا تُرسم في الواقع
 *                      (الهوية تحلّ محلها، وتحميلها آخرًا).
 *   · erp-themes.css   قلب الداكن + طبقات a11y/طباعة — tokens تحمل
 *                      قيمها الخاصة (scrim/ظلال) بطبيعتها.
 *   · erp-identity.css المصدرُ الوحيد المسموح للوحة «بورسلين ونحاس» —
 *                      هذا هو مكان الألوان الشرعي، وتثبّته
 *                      tests/v2-identity.test.js (15/15).
 *   · erp-board.css    لوحة قائمة الطعام المستقلة (--kb-*) بسطوحها
 *                      الورقية الخاصة؛ منتجٌ منفصل داخل V2 لا يقرأ
 *                      --erp-* أصلًا، وليس جزءًا من قشرة النظام.
 *
 * أي ملف جديد يجب أن يمرّ نظيفًا — لا يضاف ملفٌ إلى الاستثناءات إلا
 * بتعديلٍ هنا ومع سطر سببٍ موثّق.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'frontend', 'app', 'css', 'v2');

/* الاستثناءات الموثّقة — انظر الرأس أعلاه. */
const EXEMPT = new Set([
    'erp-tokens.css',
    'erp-themes.css',
    'erp-identity.css',
    'erp-board.css',
]);

/* إزالة التعليقات (تبقى أسطرها فارغة لحفظ أرقام الأسطر). */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/* أسطر @supports كشفُ ميزاتٍ لا لونٌ مرسوم — تُفرَّغ من أي أحرف. */
const stripSupports = (src) => src.replace(/^.*@supports.*$/gm, (m) => m.replace(/[^\n]/g, ' '));

/* كتلة إعفاءٍ موضعية داخل ملف: design-color-audit:allow-begin … allow-end.
   للّوحات الفرعية المشروعة فقط (مثل ألوان علامة white-label البديلة) —
   السبب يُكتب داخل تعليق begin ويُطبع في التقرير، فلا يكون الإعفاء صامتًا. */
const ALLOW_BLOCK = /\/\*\s*design-color-audit:allow-begin[\s\S]*?\*\/[\s\S]*?\/\*\s*design-color-audit:allow-end\s*\*\//g;

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\brgba?\(\s*[\d.]/g;
const HSL = /\bhsla?\(\s*[\d.]/g;
/* ألوان مسمّاة فقط حيث تنتهي الكلمة بحدّ صياغةٍ لونية فعلية. */
const NAMED = /\b(white|black|red|green|blue|gray|grey|orange|yellow|maroon|navy|olive|purple|teal|aqua|fuchsia|lime|cyan|magenta)\b(?=[\s;,!)])/g;

function scanFile(file) {
    let src = fs.readFileSync(file, 'utf8');
    const allows = [];
    /* تُفرَّغ كتل الإعفاء قبل كل الفحوص (وقبل نزع التعليقات، وإلا فُقدت
       حدودُها) — أسطرها تبقى فارغة لحفظ أرقام الأسطر. */
    src = src.replace(ALLOW_BLOCK, (m) => {
        const reason = (m.match(/design-color-audit:allow-begin([\s\S]*?)\*\//) || [])[1] || '';
        allows.push(reason.replace(/\s+/g, ' ').trim());
        return m.replace(/[^\n]/g, ' ');
    });
    src = stripSupports(stripComments(src));
    const hits = [];
    const collect = (re, kind) => {
        let m; re.lastIndex = 0;
        while ((m = re.exec(src))) {
            const line = src.slice(0, m.index).split('\n').length;
            hits.push(`${kind} ${m[0].trim()} @L${line}`);
        }
    };
    collect(HEX, 'hex'); collect(RGB, 'rgb'); collect(HSL, 'hsl'); collect(NAMED, 'named');
    return { hits, allows };
}

function main() {
    if (!fs.existsSync(DIR)) {
        console.error(`المجلد غير موجود: ${DIR}`);
        process.exit(2);
    }
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.css')).sort();
    if (!files.length) {
        console.error(`لا ملفات CSS في: ${DIR}`);
        process.exit(2);
    }
    let pass = 0;
    const failing = [];
    for (const f of files) {
        if (EXEMPT.has(f)) {
            console.log(`EXEMPT  ${f}`);
            continue;
        }
        const { hits, allows } = scanFile(path.join(DIR, f));
        for (const a of allows) { console.log(`      ALLOW-BLOCK: ${a}`); }
        if (!hits.length) {
            pass++;
            console.log(`PASS  ${f}`);
        } else {
            failing.push(f);
            console.log(`FAIL  ${f}`);
            for (const h of hits.slice(0, 10)) { console.log(`      ${h}`); }
            if (hits.length > 10) { console.log(`      … +${hits.length - 10}`); }
        }
    }
    const total = files.length - EXEMPT.size;
    console.log(`\nالنتيجة: ${pass}/${total} ملف نظيف، ${failing.length} ملف فيه ألوان مرسومة حرفية`);
    if (failing.length) {
        console.log('المطلوب: حوّل كل لون حرفي إلى رمز --erp-* من erp-identity.css.');
        process.exit(1);
    }
    console.log('البوابة خضراء: لا انجراف لوني في css/v2.');
    process.exit(0);
}

main();
