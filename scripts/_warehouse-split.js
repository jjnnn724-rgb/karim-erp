#!/usr/bin/env node
/**
 * scripts/_warehouse-split.js — تفكيك backend/warehouse-routes.js (3792 سطرًا) إلى 6 وحدات
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * لماذا هذا الشكل تحديدًا (قرار مبني على قياس لا على ذوق):
 *
 *  · 21 ملف اختبار يقرأ warehouse-routes.js **نصًا** ويُطابقه بـregex وبـ`slice(indexOf(a), indexOf(b))`.
 *    لذا النطاقات تُختار **متصلة** بحيث لا يُقسَّم أي زوج علامات تقطعه الاختبارات:
 *      approve(623)→chef-approve(837)  كلاهما في النطاق B
 *      merge(2606)→void(2745)→opening-balance(2878) و AUTO_PAYMENT→void  كلها في النطاق E
 *  · اختبارات العقد تُقرأ من **دمج** الوحدات بترتيبها الأصلي (tests/helpers/warehouse-source.js)
 *    فالنص يبقى بالترتيب نفسه وبالبايت نفسه — بما فيه CRLF والسطور الاثني عشر LF الخام.
 *  · التسجيل على Express يبقى بالترتيب الأصلي B←C←D←E←F (Express يطابق بالترتيب).
 *  · الدوال المطلوبة في النطاق A تُصدَّر عبر `__scope`، والاتصال الدائري آمن لأن
 *    `module.exports` يُسجَّل قبل تحميل الوحدات الفرعية.
 *
 * الفحص ما قبل التشغيل يمنع كتابة ملف مكسور: أي انتهاك يوقف السكربت قبل الكتابة.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'backend', 'warehouse-routes.js');
const OUT_DIR = path.join(ROOT, 'backend', 'warehouse');
const src = fs.readFileSync(SRC_PATH, 'utf8');

// حارس إعادة التشغيل: السكربت يقرأ warehouse-routes.js كأنه الأصل. تشغيله مرة
// أخرى على الملف المُفكَّك يدمّر المحتوى — لذا يُرفض ما دام الهدف مُفكَّكًا.
if (fs.existsSync(OUT_DIR)) {
    console.error('backend/warehouse/ موجود أصلًا — استعيد الأصل أولًا:');
    console.error('  git checkout -- backend/warehouse-routes.js && rm -rf backend/warehouse');
    process.exit(1);
}

// ── حواف الأسطر كإزاحات خام (لا إعادة تجميع — الحفاظ على CRLF/LF كما هي) ──
const lineStart = [0];
for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) {lineStart.push(i + 1);}
}
function sliceLines(from, to) { // من بداية السطر `from` إلى بداية السطر `to` (1-based, to غير مضمّنة)
    return src.slice(lineStart[from - 1], lineStart[to - 1]);
}
const lineCount = lineStart.length;

// النطاقات: A مساعدات+رأس | B..F مسارات | G التصدير
const REGIONS = { A: [1, 551], B: [551, 1329], C: [1329, 1839], D: [1839, 2603], E: [2603, 3138], F: [3138, 3750], G: [3750, lineCount + 1] };
for (const [k, [s, e]] of Object.entries(REGIONS)) {
    if (s >= e || s < 1 || e > lineCount + 1) {throw new Error(`حدود نطاق ${k} غير صالحة: ${s}-${e} (السطور ${lineCount})`);}
}
const part = (k) => sliceLines(...REGIONS[k]);

// ── تعريفات مستوى-أعلى ──
function topLevelNames(text) {
    const names = new Set();
    for (const m of text.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) {names.add(m[1]);}
    for (const m of text.matchAll(/^(?:const|let|var)\s*\{([^}]*)\}\s*=/gm)) {
        for (const p of m[1].split(',')) {
            const id = (p.includes(':') ? p.split(':')[1] : p.split(':')[0]).trim();
            if (/^[A-Za-z_$][\w$]*$/.test(id)) {names.add(id);}
        }
    }
    for (const m of text.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {names.add(m[1]);}
    return names;
}

// نص الشيفرة وحده: أسطر التعليقات تُسقط — كانت تورّط `requireSignature` في نطاق E
// لأن سطر تعليق يذكر الاسم، فتُستورد ولا تُستخدم ويُسقطها بوابة lint بحصة صفر.
function codeOnly(text) {
    return text.split('\n').map((line) => {
        const t = line.trimStart();
        if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) {return '';}
        return line;
    }).join('\n');
}

const aNames = topLevelNames(part('A'));
const regionDefs = {};
for (const k of ['B', 'C', 'D', 'E', 'F']) {regionDefs[k] = topLevelNames(part(k));}

const PRE = [];
const fail = (msg) => PRE.push(msg);

// 1) لا اسم يُعرَّف في A ثم يُعاد تعريفه في وحدة فرعية (SyntaxError)
for (const k of ['B', 'C', 'D', 'E', 'F']) {
    for (const n of regionDefs[k]) {
        if (aNames.has(n)) {fail(`${k}: الاسم «${n}» معرَّف في A وفي ${k} — تكرار تعريف`);}
    }
}
// 2) النطاق A لا يُشير إلى اسم يُعرَّف لاحقًا (بعد الفصل يصبح غير متاح)
const later = new Set(['B', 'C', 'D', 'E', 'F'].flatMap((k) => [...regionDefs[k]]));
for (const n of later) {
    if (new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(part('A'))) {
        fail(`A: يستخدم «${n}» المعرَّف في نطاق لاحق — سيتحوّل إلى ReferenceError`);
    }
}
// 3) كل زوج علامات مُقطوع بالاختبارات يجب أن يبقى داخل نطاق واحد
const MARKER_PAIRS = [
    ['B', "'/dispatches/:id/approve'", "'/dispatches/:id/chef-approve'"],
    ['E', "'/inventory/merge'", "'/purchase-invoices/:id/void'"],
    ['E', 'const AUTO_PAYMENT_NOTE_RE', "router.post('/purchase-invoices/:id/void'"],
    ['E', "'/purchase-invoices/:id/void'", "'/opening-balance/report'"],
];
for (const [k, a, b] of MARKER_PAIRS) {
    const t = part(k);
    const ia = t.indexOf(a);
    const ib = t.indexOf(b);
    if (ia < 0 || ib < 0 || ib <= ia) {fail(`${k}: زوج العلامات غير متصل (${a} → ${b})`);}
}
// 4) المتطلبات النسبية داخل النطاقات تُصحَّح إلى ../
const RELATIVE_FIX = [
    [/\brequire\('\.\/accounting-routes'\)/g, "require('../accounting-routes')"],
    [/\brequire\('\.\/ar-search'\)/g, "require('../ar-search')"],
];

if (PRE.length) {
    console.error('فشل الفحص ما قبل التشغيل — لم تُكتب أي ملف:');
    PRE.forEach((m) => console.error('  · ' + m));
    process.exit(1);
}

// ── أسماء كل وحدة من A ──
function needsFromA(k) {
    const t = codeOnly(part(k));
    return [...aNames].filter((n) => usesName(t, n));
}

/**
 * هل يستخدم النص الاسم كرمز لا كعضو؟
 * · `res.json(` ليس استعمالًا للدالة المساعدة `json` (وصول عضوي بنقطة واحدة).
 * · لكن `requireRole(...APPROVAL_ROLES)` **صيغة انتشار** تسبق الاسم بنقطتين/ثلاثًا،
 *   ورفضها كان يحذف ١٥ اسمًا من الاستيراد فتنهار البوابات بـ`Cannot find name`.
 * النمط: يقبل الاسم عند بداية النص، أو بعد ما ليس نقطة/حرفًا، أو بعد `..` (الانتشار).
 */
function usesName(text, name) {
    const esc = name.replace(/[$]/g, '\\$');
    return new RegExp(`(?:^|[^.\\w]|\\.\\.)${esc}\\b`).test(text);
}
function crossRequires(k) {
    // الاعتماديات التقاطعية **مُتحقَّق منها يدويًا لا بالاستنتاج**: تحليل النص
    // أرجع totalValue كاعتماد في C/D/E/F، ثم أُثبت أنه كاذب — السطر 667
    // `let totalValue = 0;` متغيّر **محلي** داخل معالج بأزاحة معدومة، وبقية
    // occurrences في D/E/F أسماء أعمدة SQL ("totalValue") لا متغيّرات.
    // الوظيفة الوحيدة المُعرَّفة فعليًا في نطاق وتُستدعى من نطاق آخر:
    // directReturn (مُعرَّف 1215 في B، مستدعى 1338 في C).
    if (k === 'C') {
        if (!/\bdirectReturn\b/.test(part('C'))) {throw new Error('C لم يعد يستخدم directReturn — راجع الحدود');}
        return ["const { directReturn } = require('./dispatch-routes');"];
    }
    if (k === 'F') {
        const t = codeOnly(part('F'));
        const eNames = [...regionDefs.E].filter((n) => usesName(t, n));
        if (eNames.length) {return [`const { ${eNames.join(', ')} } = require('./purchase-void-routes');`];}
    }
    return [];
}
function fixRelative(text) {
    let out = text;
    for (const [re, rep] of RELATIVE_FIX) {out = out.replace(re, rep);}
    return out;
}
function moduleFor(k, file, title) {
    const body = fixRelative(part(k));
    const aNeeds = needsFromA(k).filter((n) => !n.includes(','));
    const header = [
        `// ─── ${title}`,
        `// مُستخرج حرفًا من backend/warehouse-routes.js (السطور ${REGIONS[k][0]}-${REGIONS[k][1] - 1}).`,
        '// الترتيب نفسه ونهايات الأسطر نفسها (CRLF/LF كما وردت) — انظر scripts/_warehouse-split.js',
        '// للحدود المختارة: كل زوج علامات تقطعه اختبارات العقد يبقى داخل نطاق واحد.',
        `const { __scope } = require('../warehouse-routes');`,
        `const { ${aNeeds.join(', ')} } = __scope;`,
        ...crossRequires(k),
        '',
        '',
    ].join('\r\n');
    return header + body;
}

const MODULES = [
    ['B', 'dispatch-routes.js', 'مسارات الصرف والاعتماد والاستلام'],
    ['C', 'returns-routes.js', 'مسارات المرتجعات ووارد المخزن والبحث الذكي'],
    ['D', 'inventory-routes.js', 'مسارات فواتير الشراء وحركات المخزون'],
    ['E', 'purchase-void-routes.js', 'مسارات الدمج والإلغاء والتقارير ولوحة النظام'],
    ['F', 'pr-routes.js', 'مسارات طلبات الشراء (النواقص)'],
];

// ── جسم main الجديد: النطاق A + التصدير (بدون أسماء E) + تحميل الوحدات بالترتيب ──
const gText = part('G');
const E_NAMES = ['AUTO_PAYMENT_NOTE_RE', 'classifyInvoicePaymentsForVoid', 'normalizePRItems',
    'prShortageSuggestion', 'canPRChefDecide', 'canPRGMDecide', 'PR_CREATE_ROLES', 'PR_CANCEL_ROLES',
    'PR_CHEF_ROLES', 'PR_GM_ROLES', 'PR_WH_ROLES', 'PR_READ_ROLES'];
// أسماء **داخلية** تُصدَّر من الوحدة لاستخدام الوحدات الشقيقة ولا تدخل في السطح العام:
// PR_CHEF_CREATE_ROLES تستخدمها pr-routes داخل معالج — غيابها كان يعطي
// `undefined` وينفجر وقت التشغيل بـ`TypeError` لا عند التحميل (التقطته بوابة الأنواع).
const E_INTERNAL = ['PR_CHEF_CREATE_ROLES'];
const publicBlockLines = gText.split('\r\n').filter((l) => !E_NAMES.some((n) => l.trim() === `${n},`));
if (publicBlockLines[publicBlockLines.length - 1] === '') {publicBlockLines.pop();}

const main = [
    part('A'),
    '',
    '// ─── API العام — كما كان، عدا الأسماء المُستخرجة إلى purchase-void-routes ───',
    '// تُسجَّل هنا **قبل** تحميل وحدات المسارات: كل وحدة تستورد من هذا الملف،',
    '// وبذلك يكون الاتصال الدائري آمنًا (module.exports مكتمل قبل دوران الوحدة).',
    publicBlockLines.join('\r\n'),
    '',
    '// scope داخلي للوحدات المُستخرجة — كل أسماء النطاق A (pool/jwtAuth/logger/…).',
    '// ليس جزءًا من API العام الموثّق، بل جسر تحميل بين الوحدات.',
    'module.exports.__scope = Object.freeze({',
    '    ' + [...aNames].join(', '),
    '});',
    '',
    '// تحميل المسارات **بالترتيب الأصلي** — Express يطابق بالترتيب، وتغييره يغيّر معنى المسارات.',
    "require('./warehouse/dispatch-routes');",
    "require('./warehouse/returns-routes');",
    "require('./warehouse/inventory-routes');",
    // الترتيب صريح: purchase-void قبل pr-routes لأن الأخيرة تستورد منه.
    // (Object.assign بلا فهرسة مفتاح نصي: حلقي المكافئ أضاف خطأي TS7053.)
    "Object.assign(module.exports, require('./warehouse/purchase-void-routes'));",
    "require('./warehouse/pr-routes');",
    '',
].join('\r\n');

// ── الكتابة ──
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [k, file, title] of MODULES) {
    const exportsOf = k === 'B'
        // directReturn فقط: totalValue **ليس** في مستوى الوحدة (متغيّر محلي في معالج)
        ? "\r\n\r\nmodule.exports = { directReturn };\r\n"
        : k === 'E'
            ? `\r\n\r\nmodule.exports = {\r\n    ${[...E_NAMES, ...E_INTERNAL].join(',\r\n    ')},\r\n};\r\n`
            : '\r\n\r\nmodule.exports = {};\r\n';
    fs.writeFileSync(path.join(OUT_DIR, file), moduleFor(k, file, title) + exportsOf, 'utf8');
}
fs.writeFileSync(SRC_PATH, main, 'utf8');

console.log('✓ كُتبت الوحدات:');
for (const [, file] of MODULES) {console.log('  backend/warehouse/' + file + '  (' + part(file === 'dispatch-routes.js' ? 'B' : file === 'returns-routes.js' ? 'C' : file === 'inventory-routes.js' ? 'D' : file === 'purchase-void-routes.js' ? 'E' : 'F').split(/\r?\n/).length + ' سطرًا)');}
console.log('  backend/warehouse-routes.js  (' + main.split(/\r?\n/).length + ' سطرًا، كان 3792)');