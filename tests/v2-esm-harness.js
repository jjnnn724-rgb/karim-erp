/**
 * v2-esm-harness.js — تشغيل وحدات V2 الحقيقية داخل jest (بلا حزمة ولا DOM)
 * ═══════════════════════════════════════════════════════════════════════════
 * اختبارات المصادر تُحمّل ملفات ESM في `vm` بعد تجريد كلمات `import`، فتحتاج
 * الرموز المستوردة محقونة. بدل تكرار المرآة اليدوية في كل اختبار — وهو drift
 * بانتظار الحدوث — يُقيَّم الملف الحقيقي هنا ويُعاد تصديره.
 *
 * يصلح للوحدات النقية (بلا استيرادات): data/expiry-policy.js مثلًا.
 * للوحدات ذات الأبواب استعمل loadEsm الخاص بالاختبار وحُقن ما يرجعه هذا الملف.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2');

function exportNames(src) {
    const names = new Set();
    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        names.add(m[1]);
    }
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const part of m[1].split(',')) {
            const t = part.trim();
            if (t) {names.add((t.split(/\s+as\s+/)[1] || t.split(/\s+as\s+/)[0]).trim());}
        }
    }
    return [...names];
}

/** @returns {Object} تصدير الوحدة الحقيقي باسمه */
function evalV2Module(relPath) {
    const file = path.isAbsolute(relPath) ? relPath : path.join(V2, relPath);
    const src = fs.readFileSync(file, 'utf8');
    const names = exportNames(src);
    const body = src.replace(/^\s*import\b[^\n]*\n/gm, '').replace(/^export\s+/gm, '');
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl, isNaN, parseFloat, parseInt,
    };
    vm.createContext(context);
    vm.runInContext(`${body}\n;Object.assign(globalThis, {${names.join(', ')}});`, context, { filename: file });
    return Object.fromEntries(names.map((n) => [n, context[n]]));
}

module.exports = { evalV2Module, exportNames, V2 };
