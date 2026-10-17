#!/usr/bin/env node
/* v2-revision.js — عقدُ مراجَعة وِحدات V2 (البند ١٤، مسار أ)
   ═══════════════════════════════════════════════════════════════════════
   القاعدة ذاتُ طبقتين، وهي الواقعُ الذي فرضته دفعاتُ P0:
   • JS (استيرادات + وسم preview) يساوي مراجعةَ الصفحة حرفًا — لا يتقدّم
     ولا يتأخّر عنها.
   • CSS قد يتقدّم عليها لكل دفعة (4.9.135…4.9.143)، لكن لا يجوز أن يسبقها
     للخلف؛ وإلا خُدمت ورقةٌ أقدم من الصفحة.
   المراجعة تُقرأ من رابط preview.js أو تُمرَّر بـ --rev. الكاش الفعلي لا
   يعتمد على هذا الرقم: الخادم no-cache للكود وSW network-first (server.js
   :370/:373 · sw.js:246)؛ فالأداة تحرس الاتساق لا التخزين.
   الحراسة: tests/v2-revision.test.js.

   node scripts/v2-revision.js                 → يوائمُ كلَّ شيءٍ على مراجَعة الصفحة
   node scripts/v2-revision.js --rev 4.9.139  → يوائمُ على مراجَعةٍ جديدةٍ صراحةً
   node scripts/v2-revision.js --check        → لا يكتب؛ يطبعُ الانحرافَ ويخرجُ 1
   node scripts/v2-revision.js --dry-run      → يطبعُ ما سيكتبه دونَ كتابة
   ═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const HTML = path.join(APP, 'v2.html');
const V2_JS = path.join(APP, 'js', 'v2');
const EXT = String.raw`js|mjs|css|json`;

/* كلُّ محدِّدٍ نسبيٍّ مراجَع: يبدأ بنقطةٍ داخل علاماتِ اقتراحٍ وينتهي بامتدادٍ
   و`?v=`. يشملُ `from '…'` و`import('…')` معًا، ويستثني مكتبات vendor ذاتِ
   المساراتِ غيرِ النسبية (`vendor/xlsx…?v=4.9.77` في js/v2/vendor.js). */
const REV_IN_SPEC = new RegExp(String.raw`(['"])(\.[^'"]*?\.(?:${EXT}))\?v=([0-9][0-9.]*)(?=['"])`, 'g');
const LINK_IN_HTML = /(href="css\/v2\/[^"]*?\.css\?v=)([0-9][0-9.]*)(")/g;
const SCRIPT_IN_HTML = /(src="js\/v2\/[^"]*?\.js\?v=)([0-9][0-9.]*)(")/g;
const PAGE_REV = /js\/v2\/preview\.js\?v=([0-9][0-9.]*)/;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const fatal = (msg) => {console.error(`v2-revision: ${msg}`); process.exit(2);};
if (has('--help') || has('-h')) {
    fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).forEach((l) => console.log(l.replace(/^ */, '')));
    process.exit(0);
}
const revArg = (() => {
    const i = argv.indexOf('--rev');
    if (i < 0) {return null;}
    const v = argv[i + 1];
    if (!v || !/^\d+\.\d+\.\d+$/.test(v)) {fatal('--rev يحتاج رقمًا مثل 4.9.139');}
    return v;
})();

const html = fs.readFileSync(HTML, 'utf8');
const pageRev = (html.match(PAGE_REV) || [])[1];
const rev = revArg || pageRev;
if (!rev) {fatal(`لا مراجَعةَ في ${path.relative(ROOT, HTML)} (رابط preview.js؟)`);}

const jsFiles = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {walk(p);} else if (e.name.endsWith('.js')) {jsFiles.push(p);}
    }
})(V2_JS);

const hits = (src, re) => {
    re.lastIndex = 0;
    let n = 0;
    while (re.exec(src) !== null) {n += 1;}
    return n;
};

const versionCmp = (a, b) => {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) {return d < 0 ? -1 : 1;}
    }
    return 0;
};

const plan = [];
for (const f of jsFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const out = src.replace(REV_IN_SPEC, (_m, quote, spec) => `${quote}${spec}?v=${rev}`);
    const before = hits(src, REV_IN_SPEC);
    const changing = before > 0 && out !== src;
    if (changing) {plan.push({ file: f, src, out, count: before });}
}
{
    /* CSS يتقدّم ولا يتأخّر: لا نُنزل ورقةً أحدث من الصفحة. */
    const out = html
        .replace(LINK_IN_HTML, (m, pre, v, post) => (versionCmp(v, rev) < 0 ? `${pre}${rev}${post}` : m))
        .replace(SCRIPT_IN_HTML, `$1${rev}$3`);
    const count = hits(html, LINK_IN_HTML) + hits(html, SCRIPT_IN_HTML);
    if (out !== html) {plan.push({ file: HTML, src: html, out, count });}
}

/* مجموعةُ الرقمِ المرجعيٍّ differ بين الأنماطِ الثلاثة: 3 للمحدِّد، 2 للروابط. */
const JS_PROBES = [[REV_IN_SPEC, 3], [SCRIPT_IN_HTML, 2]];
const driftOf = (src) => {
    const bad = [];
    for (const [re, gv] of JS_PROBES) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src)) !== null) {
            if (m[gv] !== rev) {bad.push(m[0]);}
        }
    }
    LINK_IN_HTML.lastIndex = 0;
    let m;
    while ((m = LINK_IN_HTML.exec(src)) !== null) {
        if (versionCmp(m[2], rev) < 0) {bad.push(m[0]);}
    }
    return bad;
};
const drift = [];
for (const f of jsFiles.concat([HTML])) {
    for (const s of driftOf(fs.readFileSync(f, 'utf8'))) {drift.push(`${path.relative(ROOT, f).split(path.sep).join('/')} → ${s}`);}
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
console.log(`مراجعُ الصفحة: ${pageRev || '—'} · الهدف: ${rev} · ملفاتُ js/v2: ${jsFiles.length}`);

if (has('--check')) {
    if (drift.length === 0) {console.log(`صادقٌ تمامًا: لا انحرافَ عن ${rev} في ${jsFiles.length + 1} ملفًا.`); process.exit(0);}
    console.error(`منحرفٌ عن ${rev}: ${drift.length}`);
    drift.slice(0, 40).forEach((d) => console.error('  ' + d));
    if (drift.length > 40) {console.error(`  … و${drift.length - 40} آخر.`);}
    process.exit(1);
}

if (plan.length === 0) {console.log('الشجرةُ موائمةٌ تمامًا — لا كتابةَ لازمَة (idempotent).'); process.exit(0);}
for (const p of plan) {console.log(`  ${rel(p.file)}: ${p.count} محدِّدًا ← ${rev}`);}
if (has('--dry-run')) {console.log(`dry-run: كان سيُكتَب ${plan.length} ملفًا.`); process.exit(0);}
for (const p of plan) {fs.writeFileSync(p.file, p.out); console.log(`✓ ${rel(p.file)}`);}
const left = jsFiles.concat([HTML]).reduce((n, f) => n + driftOf(fs.readFileSync(f, 'utf8')).length, 0);
console.log(`موائمٌ ${plan.length} ملفًا؛ الانحرافُ المتبقّي: ${left}`);
if (left > 0) {process.exit(1);}
