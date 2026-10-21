/**
 * ai-assistant/assistant.js — عقل المساعد داخل Karim ERP (V2)
 * ══════════════════════════════════════════════════════════════════════
 * لماذا هذا الملف: المالك يعمل على V2 بدوام كامل، فالسؤال اليوم
 * («أين باب هذا؟ · ماذا يضمن هذا العقد؟ · لماذا فشل هذا الاختبار؟»)
 * يحتاج grepً لا يقلّ عن نصف ساعة. المساعد يجيب بدقّة وبلا اختراع.
 *
 * ثلاثة أوضاع — كلها مجانية (Gemini free tier، بلا أي خدمة مدفوعة):
 *   • معرفة  : خريطة المشروع + سجل الترحيل + ما يضمنه عقد الشاشة الحالية
 *   • تشخيص : قراءات حيّة من النظام (قاعدة/نسخ/قرص) بلا اختلاق
 *   • كود    : مقاطع من ملفات المشروع (قراءة فقط، قوائم بيضاء)
 *
 * قواعد القواعة (لا تُكسر):
 *   1. لا يغادر المستودع إلا: سؤال المستخدم + سياق مقصوص من المشروع.
 *      ولا يُرسل ‎.env‎ ولا كلمة مرور ولا سطر قاعدة ولا بيانات موظف.
 *   2. بلا مفتاح Gemini (أو نفدت حصة اليوم) يعمل المساعد «قواعديًا»:
 *      يعرض الحقائق مباشرة بلا نموذج — فيبقى مجانيًا ومفيدًا دائمًا.
 *   3. الأرقام في الرد آتية من «بيانات النظام» المرفقة فقط؛ ما ليس منها
 *      يُقال صراحةً: «غير متوفر في البيانات الحالية».
 */
'use strict';

const fs = require('fs');
const path = require('path');
const gemini = require('../whatsapp-engine/ai/gemini');

const ROOT = path.resolve(__dirname, '..', '..');
const V2_DIR = path.join(ROOT, 'frontend', 'app', 'js', 'v2');
const SCREENS_DIR = path.join(V2_DIR, 'screens');
const MIGRATION = path.join(V2_DIR, 'MIGRATION.md');
const BACKUPS = path.join(ROOT, 'database', 'backups');

/* سقوفٌ صارمة: المساعد لا يلتهم ذاكرة الخادم ولا يغرق النموذج. */
const MAX_QUESTION = 800;
const MAX_CONTEXT_CHARS = 12000;
const MAX_FILE_CHARS = 6000;
const MAX_FILES = 3;
const MAX_LINES = 60;

const MODES = ['knowledge', 'diagnose', 'code'];

/* ما يُقرأ من القرص: كود المشروع فقط. لا إعدادات ولا أسرار ولا نماذج. */
const READABLE_ROOTS = [
    path.join(ROOT, 'frontend', 'app', 'js', 'v2'),
    path.join(ROOT, 'frontend', 'app', 'css', 'v2'),
    path.join(ROOT, 'backend'),
    path.join(ROOT, 'tests'),
    path.join(ROOT, 'database', 'migrations'),
];
const DENY_PATTERNS = [
    /\.env(\.|$)/i, /secret/i, /passphrase/i, /\.pem$/i, /\.key$/i,
    /\.onnx$/i, /node_modules/i, /backups?/i, /karim_erp_test/i,
];

/* ─────────────────────────── أدوات صغيرة ─────────────────────────── */

function clip(text, max) {
    const s = String(text ?? '');
    return s.length > max ? s.slice(0, max) + '\n… (مقتطع)' : s;
}

function readFileSafe(file, maxChars) {
    try {
        if (!fs.existsSync(file)) {return null;}
        const stat = fs.statSync(file);
        if (!stat.isFile()) {return null;}
        return clip(fs.readFileSync(file, 'utf8'), maxChars);
    } catch (_e) {
        return null;
    }
}

/** مسار داخل المستودع؟ لا يُمس إلا ما تحت الجذور المسموحة وبلا أنماط ممنوعة. */
function isReadable(rel) {
    const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.includes('..')) {return false;}
    if (DENY_PATTERNS.some((re) => re.test(clean))) {return false;}
    const abs = path.resolve(ROOT, clean);
    return READABLE_ROOTS.some((root) => abs === root || abs.startsWith(root + path.sep));
}

function relative(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

/* ─────────────────────────── سياق المشروع ─────────────────────────── */

let mapCache = null;

/** خريطة المشروع: القواعد الثابتة + سجل الشاشات (بلا تكرار في الطلبات). */
function projectMap() {
    if (mapCache) {return mapCache;}
    const md = readFileSafe(MIGRATION, 40000) || '';
    const lines = md.split(/\r?\n/);
    const rules = [];
    const registry = [];
    let section = '';
    for (const line of lines) {
        const h = line.match(/^##\s+(.*)$/);
        if (h) {section = h[1].trim(); continue;}
        if (!section) {continue;}
        if (section.includes('القواعد الثابتة') && line.trim()) {rules.push(line.trim());}
        if (section.includes('سجل الشاشات') && line.trim()) {registry.push(line.trim());}
    }
    mapCache = {
        rules: rules.slice(0, 24),
        registry: registry.slice(0, 70),
    };
    return mapCache;
}

/** ما يضمنه عقد الشاشة: عنوان الملف + ما تعلّمه التعليقات + أسماء اختبارات العقد. */
function screenContext(screenKey) {
    const key = String(screenKey || '').trim();
    if (!key) {return '';}
    const out = [];
    const screenFile = path.join(SCREENS_DIR, `${key}.js`);
    const head = readFileSafe(screenFile, 4000);
    if (head) {
        const banner = head.split(/\r?\n/).slice(0, 40)
            .filter((l) => /^\s*(\*|\/\*|\/\/)/.test(l)).map((l) => l.replace(/^\s*\*?\s?/, '').trim())
            .filter(Boolean).slice(0, 18);
        out.push(`ملف الشاشة: ${relative(screenFile)}`, 'ما يوثّقه رأس الملف:', ...banner);
    }
    const testFile = path.join(ROOT, 'tests', `v2-${key}.test.js`);
    const testSrc = readFileSafe(testFile, 60000);
    if (testSrc) {
        const titles = [...testSrc.matchAll(/\b(?:it|test)\(\s*'([^']+)'/g)].map((m) => m[1]).slice(0, 30);
        if (titles.length) {
            out.push(`عقد الشاشة: ${relative(testFile)} — Guarantees:`);
            for (const t of titles) {out.push(`  • ${t}`);}
        }
    }
    const md = readFileSafe(MIGRATION, 40000) || '';
    const hits = md.split(/\r?\n/).filter((l) => l.toLowerCase().includes(key.toLowerCase())).slice(0, 12);
    if (hits.length) {out.push('من سجل الترحيل:', ...hits.map((h) => '  ' + h.trim()));}
    return out.join('\n');
}

/** مقاطع قراءة فقط من ملفات يطلبها الأدمن صراحةً. */
function codeSnippets(paths) {
    const list = Array.isArray(paths) ? paths.slice(0, MAX_FILES) : [];
    const out = [];
    for (const rel of list) {
        if (!isReadable(rel)) {out.push(`مرفوض (خارج المسموح): ${String(rel).slice(0, 80)}`); continue;}
        const abs = path.resolve(ROOT, String(rel).replace(/\\/g, '/'));
        const src = readFileSafe(abs, MAX_FILE_CHARS);
        if (src == null) {out.push(`غير موجود: ${rel}`); continue;}
        const head = src.split(/\r?\n/).slice(0, MAX_LINES).join('\n');
        out.push(`ملف: ${relative(abs)}\n${head}`);
    }
    return out.join('\n\n');
}

/* ─────────────────────────── قراءات حيّة ─────────────────────────── */

/** قراءات النظام الحية: القاعدة والنسخ والقرص — بلا كتابة ولا تعديل. */
async function diagnostics(pool) {
    const facts = [];
    const now = new Date();
    try {
        const r = await pool.query('SELECT 1 AS ok');
        facts.push(`قاعدة البيانات: متاحة (SELECT 1 = ${r.rows[0].ok})`);
    } catch (_e) {
        facts.push(`قاعدة البيانات: غير متاحة — ${String(_e.message).slice(0, 120)}`);
    }
    try {
        const r = await pool.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()');
        facts.push(`الاتصالات المفتوحة على القاعدة: ${r.rows[0].n}`);
    } catch (_e) {
        facts.push('الاتصالات المفتوحة: غير معروف');
    }
    try {
        const status = JSON.parse(fs.readFileSync(path.join(BACKUPS, 'nightly-backup-status.json'), 'utf8'));
        const at = status.at || status.time || status.finishedAt || '';
        facts.push(`النسخ الليلي: ${status.ok === false ? 'فشل آخر تشغيل' : 'آخر تشغيل سليم'}${at ? ` (${at})` : ''}`);
    } catch (_e) {
        facts.push('النسخ الليلي: لا يوجد ملف حالة (لم يُسجَّل تشغيل بعد)');
    }
    try {
        const dumps = fs.readdirSync(BACKUPS).filter((f) => f.endsWith('.dump'));
        const latest = dumps.sort().pop();
        facts.push(latest
            ? `آخر نسخة على القرص: ${latest} (${Math.round(fs.statSync(path.join(BACKUPS, latest)).size / 1048576)} م.ب)`
            : 'آخر نسخة على القرص: لا يوجد ملف نسخة');
    } catch (_e) {
        facts.push('آخر نسخة على القرص: غير معروف');
    }
    try {
        const st = fs.statfsSync(ROOT);
        const freeMb = Math.round((st.bavail * st.bsize) / 1048576);
        facts.push(`مساحة القرص الحرّة: ${freeMb} م.ب`);
    } catch (_e) {
        facts.push('مساحة القرص: غير معروفة');
    }
    facts.push(`وقت الفحص: ${now.toISOString()}`);
    return facts.join('\n');
}

/* ─────────────────────────── الرد ─────────────────────────── */

/** هوية المساعد: عربية مهنية، مقتصدة، بلا اختراع. */
function systemGuard(mode) {
    return [
        'أنت «مساعد V2» داخل نظام Karim ERP — مرجع المالك في مشروع النسخة الثانية.',
        'قواعد صارمة:',
        '1) الأرقام والحقائق آتية حصريًا من «بيانات النظام» المرفقة — يُمنع اختراع أي رقم أو اسم ملف أو حالة.',
        '2) إن لم تجد ما يسأل عنه في البيانات المرفقة: قل «غير متوفر في البيانات الحالية» واذكر ما يلزم لافتحابه.',
        '3) الرد بالعربية المهنية المختصرة (أقل من 220 كلمة)، بعناوين قصيرة و«•» للقوائم.',
        '4) عند اقتراح كود: اذكر مسار الملف ودوره، ولا تكتب كودًا كاملًا — فسّر الخطوة.',
        '5) لا تكشف أسرار النظام ولا بيانات شخصية ولا كلمات مرور.',
        '6) في وضع «تشخيص»: رتّب النتائج — الأخطر أولًا، ولكل بند: العَرَض، والسبب الأرجح، والخطوة التالية.',
        mode === 'code'
            ? 'أنت الآن في وضع «كود»: المقاطع المرفقة هي المصدر الوحيد، واقترح مواضع التغيير بدقة (الملف والدالة).'
            : mode === 'diagnose'
                ? 'أنت الآن في وضع «تشخيص»: القياسات الحيّة هي المصدر الوحيد، وفسّرها لا تكرّرها.'
                : 'أنت الآن في وضع «معرفة»: سجل الترحيل وعقد الشاشة هما المصدر الوحيد.',
    ].join('\n');
}

/* رد قواعدي: الحقائق مباشرة، بلا نموذج — يعمل دائمًا ومجانيًا. */
function ruleBasedAnswer(mode, context) {
    if (mode === 'diagnose') {
        return ['قراءات النظام الحيّة (بلا نموذج — الوضع القواعدي):', context].join('\n\n');
    }
    if (mode === 'code') {
        return ['المقاطع المطلوبة (بلا تحليل — الوضع القواعدي):', context].join('\n\n');
    }
    return [
        'ملخّص ما في المتاح (بلا نموذج — الوضع القواعدي):',
        context,
        'لأجل تحليل أعمق: فعّل مفتاح Gemini (المتغيّر GEMINI_API_KEY) مجانًا في .env.',
    ].join('\n\n');
}

/**
 * سؤال واحد ⇒ رد واحد.
 * @param {{question:string, mode?:string, screen?:string, paths?:string[], pool?:any}} input
 * @returns {Promise<{text:string, mode:string, model:string|null, fallback:boolean, grounded:boolean}>}
 */
async function ask(input = {}) {
    const question = clip(String(input.question || '').trim(), MAX_QUESTION);
    const mode = MODES.includes(input.mode) ? input.mode : 'knowledge';
    if (!question) {throw new Error('EMPTY_QUESTION');}

    const parts = [];
    let grounded = false;

    if (mode === 'diagnose') {
        parts.push(await diagnostics(input.pool));
        grounded = true;
    } else if (mode === 'code') {
        const snippets = codeSnippets(input.paths);
        parts.push(snippets || 'لا توجد ملفات مطلوبة.');
        grounded = snippets.length > 0;
    } else {
        const map = projectMap();
        parts.push('خريطة المشروع (سجل الترحيل):', map.registry.join('\n'));
        parts.push('القواعد الثابتة:', map.rules.join('\n'));
        const ctx = screenContext(input.screen);
        if (ctx) {parts.push('الشاشة الحالية:', ctx); grounded = true;}
    }

    const dataText = clip(parts.filter(Boolean).join('\n\n'), MAX_CONTEXT_CHARS);

    if (!gemini.enabled()) {
        return { text: ruleBasedAnswer(mode, dataText), mode, model: null, fallback: true, grounded };
    }

    try {
        const res = await gemini.generateWithRetry({
            system: systemGuard(mode),
            prompt: question,
            dataText,
            maxWords: 260,
        });
        return { text: res.text, mode, model: res.model || gemini.model(), fallback: false, grounded };
    } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (/GEMINI_DISABLED/.test(msg)) {
            return { text: ruleBasedAnswer(mode, dataText), mode, model: null, fallback: true, grounded };
        }
        // حصة مجانية منتهية أو خطأ شبكة: نخبره بالحقائق بدل أن نُفشل الطلب.
        return {
            text: `تعذّر الوصول للنموذج الآن (${msg.slice(0, 80)}). هذه الحقائق من النظام:\n\n${dataText}`,
            mode, model: null, fallback: true, grounded,
        };
    }
}

module.exports = {
    ask,
    enabled: gemini.enabled,
    model: gemini.model,
    projectMap,
    screenContext,
    codeSnippets,
    diagnostics,
    isReadable,
    MODES,
    MAX_QUESTION,
};
