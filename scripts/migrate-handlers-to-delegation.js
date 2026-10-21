#!/usr/bin/env node
'use strict';
/**
 * migrate-handlers-to-delegation.js — codemod: معالجات سطرية ⇒ تفويض
 * ══════════════════════════════════════════════════════════════════════
 * الهدف: تمكين فرض `script-src-attr 'none'` في سياسة CSP دون eval.
 *
 * القواعد:
 *   onclick="fn()"                      ⇒ data-karim-action="fn"
 *   onclick="fn('a', 1)"                ⇒ data-karim-action="fn" data-karim-args='["a",1]'
 *   onclick="fn('${expr}')"             ⇒ data-karim-action="fn" data-karim-arg0="${expr}"
 *   onclick="fn('${expr}', this.checked)"⇒ (يُترك) — يحتاج قراءة من العنصر
 *   onclick="a();b()"                   ⇒ data-karim-action="a" data-karim-also="b,c"
 *   onclick="fn();return false;"        ⇒ + data-karim-prevent
 *   onchange="fn(x)"                    ⇒ + data-karim-event="change"
 *
 * المعالجات التي تعتمد `this` أو تعابير运行时 تُترك وتُبلَّغ (دفعة لاحقة
 * بتحويل الدوال لتقرأ من العنصر) — لا تلمسها الأداة.
 *
 * الاستخدام:
 *   node scripts/migrate-handlers-to-delegation.js            # تقرير (dry-run)
 *   node scripts/migrate-handlers-to-delegation.js --apply    # تنفيذ
 *   node scripts/migrate-handlers-to-delegation.js --file <مسار>  # ملف واحد
 */
const fs = require('fs');
const path = require('path');
const { parseHandlerCalls } = require('./lib/parse-handler-call');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');

const APPLY = process.argv.includes('--apply');
const fileIdx = process.argv.indexOf('--file');
const ONLY_FILE = fileIdx > -1 ? path.resolve(process.argv[fileIdx + 1]) : null;

const EVENTS = ['click', 'change', 'input', 'submit', 'keydown', 'focus', 'blur', 'keyup'];

/**
 * يجد معالجات السطرية مع قيمة السمة كاملة.
 * لماذا لا Regex؟ قيمة السمة في *المصدر* قد تحوي " عادية (داخل قالب JS)،
 * فالتقاط Regex ينقطع عندها. هنا نمسح حتى الاقتباس الذي يتبعه
 * (> أو / أو اسم سمة جديدة أو نهاية) ⇒ نهاية السمة الحقيقية.
 */
function findHandlerMatches(src) {
    const out = [];
    const re = new RegExp(`\\son(${EVENTS.join('|')})\\s*=\\s*"`, 'g');
    let m;
    while ((m = re.exec(src))) {
        const bodyStart = m.index + m[0].length;
        let i = bodyStart;
        while (i < src.length) {
            const ch = src[i];
            if (ch === '\\') {i += 2; continue;}
            if (ch === '"') {
                const after = src.slice(i + 1).match(/^\s*(.)/);
                const next = after ? after[1] : null;
                if (next === null || next === '>' || next === '/' || /[A-Za-z]/.test(next)) {break;}
            }
            i++;
        }
        out.push({
            index: m.index,
            end: i,
            full: src.slice(m.index, i + 1),
            event: m[1],
            body: src.slice(bodyStart, i),
        });
        re.lastIndex = i + 1;
    }
    return out;
}

/** يفكّ هروب JS داخل جسم المعالج (المصدر ⇒ نص التشغيل). */
function unescapeBody(body) {
    return String(body).replace(/\\(["'\\])/g, '$1');
}

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'vendor', '.git', 'coverage'].includes(e.name)) {continue;}
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {walk(full, out);}
        else if (/\.(js|html)$/.test(e.name)) {out.push(full);}
    }
    return out;
}

function isCommentLine(src, index) {
    const start = src.lastIndexOf('\n', index) + 1;
    const end = src.indexOf('\n', index);
    const line = src.slice(start, end < 0 ? src.length : end).trim();
    return line.startsWith('*') || line.startsWith('//') || line.startsWith('<!--') || line.startsWith('#');
}

/** يحلل جسم المعالج ⇒ { action, args, also, prevent, skip } */
function parseHandler(body) {
    const raw = String(body || '').trim();
    if (!raw) {return {skip: 'empty'};}
    // `return false` وحدها ⇒ منع فقط
    if (/^return\s+(false|true);?$/.test(raw)) {
        return {prevent: true, skip: raw.includes('false') ? null : 'prevent-only-true'};
    }
    const parsedCalls = parseHandlerCalls(raw);
    if (!parsedCalls) {return {skip: 'غير استدعاء'};}
    const { calls, prevent, stop, assignments } = parsedCalls;

    // تعوينات window.X = value ⇒ data-karim-set (الموزّع ينفّذها بلا eval)
    const sets = [];
    for (const a of (assignments || [])) {
        const m = a.target.match(/^window\.([A-Za-z_$][\w$]*)$/);
        if (!m) {return {skip: `تعيين غير قابل للتفويض: ${a.target}`};}
        const expr = a.expr.trim();
        let source;
        const thisProp = expr.match(/^this\.(\w+)$/);
        if (thisProp) {source = `@${thisProp[1]}`;}
        else if (/^'.*'$|^".*"$|^-?\d+(\.\d+)?$|^true$|^false$|^null$/.test(expr)) {source = expr;}
        else {return {skip: `قيمة تعيين غير مدعومة: ${expr.slice(0, 30)}`};}
        sets.push(`${m[1]}:${source}`);
    }
    if (!calls.length && sets.length) {
        return {skip: 'تعيين بلا استدعاء (يحتاج دالة مسمّاة)'};
    }

    const action = calls[0].name;
    const args = calls[0].args;
    const also = calls.slice(1).map((c) => c.name);

    // إجراءات مدمجة (window.print / window.close)
    const BUILTIN_MAP = { 'window.print': 'print', 'window.close': 'closeWindow' };
    if (BUILTIN_MAP[action]) {
        return {action: BUILTIN_MAP[action], args: null, argAttrs: [], also, prevent};
    }

    // وسائط تعتمد العنصر (this.value / this.checked / this) ⇒ data-karim-pass
    const passNames = [];
    const remaining = [];
    for (const a of args) {
        // this / this.value / this.checked / this.files[0] ⇒ data-karim-pass
        const m = a.text.trim().match(/^this(?:\.(\w+)(?:\[(\d+)\])?)?$/);
        if (m && a.kind === 'literal') {
            passNames.push(m[2] !== undefined ? `${m[1]}.${m[2]}` : (m[1] || 'element'));
            continue;
        }
        remaining.push(a);
    }
    const allLiteral = remaining.every((a) => a.kind === 'literal');
    const allDynamic = remaining.every((a) => a.kind === 'dynamic');

    // الوسائط المختلطة: نقبلها فقط إن كانت كل الحرفية **قبل** كل الديناميكية

    let jsonArgs = null; let argAttrs = [];
    if (!remaining.length) {jsonArgs = null;}
    else if (allLiteral) {
        const jsonish = remaining.map((a) => {
            const t = a.text.trim();
            if (/^'/.test(t)) {return `"${t.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`;}
            if (/^"/.test(t)) {return `"${t.slice(1, -1).replace(/"/g, '\\"')}"`;}
            return t;
        }).join(',');
        // JSON داخل سمة: &quot; ⇒ صالحة داخل قوالب JS بكل أنواع الاقتباس،
        // والمتصفح يفكّها عند القراءة ⇒ نفس النص الأصلي.
        jsonArgs = jsonish.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    } else if (allDynamic) {
        argAttrs = remaining.map((a, i) => `data-karim-arg${i}="${a.text}"`);
    } else {
        // مختلطة: JSON واحد بالترتيب الأصلي. الوسائط الديناميكية تُكتب
        // كقوالب داخل السلسلة ⇒ القالب يقيّمها وقت العرض (كما كان
        // المعالج السطري) ثم JSON.parse يقرأها بالترتيب الصحيح.
        const jsonish = remaining.map((a) => {
            const t = a.text.trim();
            if (a.kind === 'dynamic') {return `"${t}"`;}
            if (/^'/.test(t)) {return `"${t.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`;}
            if (/^"/.test(t)) {return `"${t.slice(1, -1).replace(/"/g, '\\"')}"`;}
            return t;
        }).join(',');
        jsonArgs = jsonish.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    if (passNames.length) {argAttrs = argAttrs.concat(`data-karim-pass="${passNames.join(',')}"`);}
    if (sets.length) {argAttrs = argAttrs.concat(`data-karim-set="${sets.join(',')}"`);}
    return {action, args: jsonArgs, argAttrs, also, prevent, stop};
}

const stats = {converted: 0, skipped: 0};
const skipped = [];
const changedFiles = [];

const files = walk(APP).filter((f) => (f.endsWith('.js') || f.endsWith('.html')) && (!ONLY_FILE || f === ONLY_FILE));

for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    let out = src;
    // نمرّ على المطابقات من الآخر للأول حتى تبقى المؤشرات صحيحة
    const matches = findHandlerMatches(src);
    if (!matches.length) {continue;}

    for (let i = matches.length - 1; i >= 0; i--) {
        const hit = matches[i];
        if (isCommentLine(src, hit.index)) {continue;}
        // حارس: قيمة السمة مبنية بدمج سلاسل JS
        //   onclick="rosterApprove(\'' + esc(x) + '\')"
        // ⇒ لا يمكن تحويلها ميكانيكيًا (نص السمة ليس متصلًا).
        if (/['"]\s*\+|\+\s*['"]/.test(hit.body)) {
            stats.skipped += 1;
            skipped.push({
                file: path.relative(ROOT, file).split(path.sep).join('/'),
                line: src.slice(0, hit.index).split('\n').length,
                body: hit.body.slice(0, 90),
                reason: 'سمة مبنية بدمج سلاسل',
            });
            continue;
        }
        const parsed = parseHandler(unescapeBody(hit.body));
        if (parsed.skip) {
            stats.skipped += 1;
            skipped.push({ file: path.relative(ROOT, file).split(path.sep).join('/'), line: src.slice(0, hit.index).split('\n').length, body: hit.body.slice(0, 90), reason: parsed.skip });
            continue;
        }
        const attrs = [`data-karim-action="${parsed.action}"`];
        if (hit.event !== 'click') {attrs.push(`data-karim-event="${hit.event}"`);}
        if (parsed.args !== null && parsed.args !== undefined) {attrs.push(`data-karim-args="[${parsed.args}]"`);}
        for (const a of parsed.argAttrs) {attrs.push(a);}
        if (parsed.also && parsed.also.length) {attrs.push(`data-karim-also="${parsed.also.join(',')}"`);}
        if (parsed.prevent) {attrs.push('data-karim-prevent');}
        if (parsed.stop) {attrs.push('data-karim-stop');}
        // مسافة قبل السمة (المطابق الأصلي بدأ بمسافة)
        out = out.slice(0, hit.index) + ` ${attrs.join(' ')}` + out.slice(hit.index + hit.full.length);
        stats.converted += 1;
    }
    if (out !== src) {
        changedFiles.push(path.relative(ROOT, file).split(path.sep).join('/'));
        if (APPLY) {fs.writeFileSync(file, out, 'utf8');}
    }
}

console.log(`\nمُحوَّل: ${stats.converted} · متروك: ${stats.skipped} · ملفات: ${changedFiles.length}${APPLY ? ' (تم الكتابة)' : ' (dry-run)'}`);
if (skipped.length) {
    console.log('\n── أمثلة المتروك (تحتاج تحويل الدوال لتقرأ من العنصر) ──');
    const byReason = new Map();
    for (const s of skipped) {
        const key = s.reason.replace(/\d+/g, 'N').slice(0, 40);
        if (!byReason.has(key)) {byReason.set(key, []);}
        byReason.get(key).push(s);
    }
    for (const [reason, list] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  ${list.length}×  ${reason}`);
        console.log(`      مثال: ${list[0].file}:${list[0].line}  ${list[0].body}`);
    }
}
if (changedFiles.length) {
    console.log('\n── الملفات ──');
    for (const f of changedFiles.slice(0, 40)) {console.log(`  ${f}`);}
    if (changedFiles.length > 40) {console.log(`  … (+${changedFiles.length - 40})`);}
}
