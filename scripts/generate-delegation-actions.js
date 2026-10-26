#!/usr/bin/env node
'use strict';
/**
 * generate-delegation-actions.js — الدفعة الثانية: توليد دوال إجراءات
 * ══════════════════════════════════════════════════════════════════════
 * الدفعة الأولى (migrate-handlers-to-delegation.js) حوّلت ما أمكن تحويلاً
 * ميكانيكيًا. الباقي معالجات **تعدّل حالة داخلية** ثم تنادي دالة، مثل:
 *
 *     onchange="YSSTATE.secInv.date_from=this.value;YSSTATE.secInv.page=1;ysSecInvReload()"
 *
 * ⇒ نولّد داخل نفس الوحدة دالةً تصل إلى نطاقها:
 *
 *     export function kdYsSecInvReload(p0) {
 *         YSSTATE.secInv.date_from = p0;
 *         YSSTATE.secInv.page = 1;
 *         ysSecInvReload();
 *     }
 *
 * وتصبح السمة: data-karim-action="kdYsSecInvReload" data-karim-pass="value"
 *
 * المبادئ:
 *   · بلا eval ولا new Function (يعمل تحت CSP بلا 'unsafe-eval').
 *   · القوالب المتداخلة (${${1}}) مدعومة.
 *   · ما ليس إسنادًا ولا استدعاءً (مثل ${saveFn}) يُترك — يُعالَج يدويًا.
 *
 * الاستخدام:
 *   node scripts/generate-delegation-actions.js            # dry-run
 *   node scripts/generate-delegation-actions.js --apply
 */
const fs = require('fs');
const path = require('path');
const { maskTemplates } = require('./lib/parse-handler-call');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const APPLY = process.argv.includes('--apply');
const MARK = '\uE000';

const EVENTS = ['click', 'change', 'input', 'submit', 'keydown', 'focus', 'blur', 'keyup'];

/** يحدّد نهاية سمة المعالج (الاقتباس الذي يتبعه > أو $ أو اسم سمة …). */
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
                if (next === null || next === '>' || next === '/' || next === '$'
                    || next === '{' || next === '}' || /[A-Za-z]/.test(next)) {break;}
            }
            i++;
        }
        out.push({
            index: m.index, end: i, full: src.slice(m.index, i + 1),
            event: m[1], body: src.slice(bodyStart, i),
        });
        re.lastIndex = i + 1;
    }
    return out;
}

function isCommentLine(src, index) {
    const start = src.lastIndexOf('\n', index) + 1;
    const end = src.indexOf('\n', index);
    const line = src.slice(start, end < 0 ? src.length : end).trim();
    return line.startsWith('*') || line.startsWith('//') || line.startsWith('<!--') || line.startsWith('#');
}

/** عبارات المعالج مفصولة بـ ; على المستوى الأعلى — بنصها الأصلي. */
function splitStatements(body) {
    const masked = maskTemplates(body);
    const stmts = [];
    let depth = 0; let quote = null; let current = '';
    for (let i = 0; i < masked.text.length; i++) {
        const ch = masked.text[i];
        if (quote) {
            current += ch;
            if (ch === quote && masked.text[i - 1] !== '\\') {quote = null;}
            continue;
        }
        if (ch === '"' || ch === "'") {quote = ch; current += ch; continue;}
        if ('([{'.includes(ch)) {depth++; current += ch; continue;}
        if (')]}'.includes(ch)) {depth--; current += ch; continue;}
        if (ch === ';' && depth === 0) {stmts.push(current.trim()); current = ''; continue;}
        current += ch;
    }
    if (current.trim()) {stmts.push(current.trim());}
    return stmts.map((s) => {
        let out = s;
        masked.placeholders.forEach((ph, i) => {
            out = out.split(`${MARK}${i}${MARK}`).join(`\${${ph}}`);
        });
        return out.replace(/\\(['"])/g, '$1');
    });
}

/** يقسّم وسائط الاستدعاء على الفواصل顶层. */
function splitCallArgs(text) {
    const parts = [];
    let depth = 0; let quote = null; let current = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            current += ch;
            if (ch === quote && text[i - 1] !== '\\') {quote = null;}
            continue;
        }
        if (ch === '"' || ch === "'") {quote = ch; current += ch; continue;}
        if ('([{'.includes(ch)) {depth++; current += ch; continue;}
        if (')]}'.includes(ch)) {depth--; current += ch; continue;}
        if (ch === ',' && depth === 0) {parts.push(current.trim()); current = ''; continue;}
        current += ch;
    }
    if (current.trim()) {parts.push(current.trim());}
    return parts;
}

/**
 * يحوّل نصًّا فيه قوالب إلى معاملات.
 * @param {{pi:number,params:string[],argAttrs:string[],passNames:string[]}} ctx
 * @param {string} text
 * @returns {string} النص بعد الاستبدال
 */
function parametrize(ctx, text) {
    const t = text.trim();
    // قالب داخل اقتباس ('${x}') ⇒ الوسيط كله معامل
    const quoted = t.match(/^(['"])\$\{([\s\S]*)\}(.*)\1$/);
    if (quoted) {
        const name = `p${ctx.pi++}`;
        ctx.params.push(name);
        ctx.argAttrs.push(`data-karim-arg${ctx.pi - 1}="\${${quoted[2]}}"`);
        const tail = quoted[3];
        return tail ? `${name} + ${quoted[1]}${tail}${quoted[1]}` : name;
    }
    // قوالب مدمجة (مثل {mapId:${st.mapId}}) ⇒ كل ${…} معامل
    if (t.includes('${')) {
        return t.replace(/\$\{([\s\S]*?)\}/g, (m, g1) => {
            const name = `p${ctx.pi++}`;
            ctx.params.push(name);
            ctx.argAttrs.push(`data-karim-arg${ctx.pi - 1}="\${${g1}}"`);
            return name;
        });
    }
    const thisProp = t.match(/^this\.(\w+)$/);
    if (thisProp) {
        const name = `p${ctx.pi++}`;
        ctx.params.push(name);
        ctx.passNames.push(thisProp[1]);
        return name;
    }
    if (t === 'this' || t === 'event') {
        const name = `p${ctx.pi++}`;
        ctx.params.push(name);
        ctx.passNames.push(t === 'this' ? 'element' : 'event');
        return name;
    }
    return text;
}

const stats = {converted: 0, skipped: 0};
const skipped = [];
let counter = 0;

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'vendor'].includes(e.name)) {continue;}
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {walk(full, out);}
        else if (/\.(js|html)$/.test(e.name)) {out.push(full);}
    }
    return out;
}

for (const file of walk(APP)) {
    const src = fs.readFileSync(file, 'utf8');
    const matches = findHandlerMatches(src).filter((h) => !isCommentLine(src, h.index));
    if (!matches.length) {continue;}

    const generated = [];
    const replacements = [];

    for (const hit of matches) {
        // حارس: نص ليس إسنادًا ولا استدعاءً (مثل ${saveFn}) ⇒ يدوي.
        if (!/=/.test(hit.body) && !/\(/.test(hit.body)) {
            stats.skipped++; skipped.push({file, hit, reason: 'ليس إسنادًا ولا استدعاءً'}); continue;
        }
        // حارس: وسيط معقّد (JSON مدمج/استبدال regex) ⇒ لا يمكن تمثيله
        // في سمة بأمان ⇒ يُعالَج يدويًا.
        if (/\.replace\s*\(\s*\//.test(hit.body)) {
            stats.skipped++; skipped.push({file, hit, reason: 'وسيط معقّد'}); continue;
        }
        // حارس: وسيط معقّد (JSON مدمج/استبدال regex) ⇒ لا يمكن تمثيله
        // في سمة بأمان ⇒ يُعالَج يدويًا.
        if (/\.replace\s*\(\s*\//.test(hit.body)) {
            stats.skipped++; skipped.push({file, hit, reason: 'وسيط معقّد'}); continue;
        }
        // حارس: وسيط معقّد (JSON مدمج/استبدال regex) ⇒ لا يمكن تمثيله
        // في سمة بأمان ⇒ يُعالَج يدويًا.
        if (/\.replace\s*\(\s*\//.test(hit.body)) {
            stats.skipped++; skipped.push({file, hit, reason: 'وسيط معقّد'}); continue;
        }
        // حارس: وسيط معقّد (JSON مدمج/استبدال regex) ⇒ لا يمكن تمثيله
        // في سمة بأمان ⇒ يُعالَج يدويًا.
        if (/\.replace\s*\(\s*\//.test(hit.body)) {
            stats.skipped++; skipped.push({file, hit, reason: 'وسيط معقّد'}); continue;
        }
        // حارس: وسيط معقّد (JSON مدمج/استبدال regex) ⇒ لا يمكن تمثيله
        // في سمة بأمان ⇒ يُعالَج يدويًا.
        if (/\.replace\s*\(\s*\//.test(hit.body)) {
            stats.skipped++; skipped.push({file, hit, reason: 'وسيط معقّد'}); continue;
        }
        // حارس: السمة ممتدة على حدود قوالب JS ⇒ نصها غير متصل.
        if (/['"]\s*\+|\+\s*['"]/.test(hit.body)) {
            stats.skipped++; skipped.push({file, hit, reason: 'سمة ممتدة على حدود قوالب'}); continue;
        }

        const stmts = splitStatements(hit.body);
        if (!stmts.length) {stats.skipped++; skipped.push({file, hit, reason: 'بلا عبارات'}); continue;}

        const ctx = {pi: 0, params: [], argAttrs: [], passNames: []};
        const bodyLines = [];
        for (const st of stmts) {
            if (/^\s*return\b/.test(st)) {bodyLines.push(`    ${st}`); continue;}
            const assign = st.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=(?!=)\s*([\s\S]+)$/);
            if (assign) {
                bodyLines.push(`    ${assign[1]} = ${parametrize(ctx, assign[2])};`);
                continue;
            }
            const call = st.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(([\s\S]*)\)$/);
            if (call) {
                const args = splitCallArgs(call[2]).map((a) => parametrize(ctx, a)).join(',');
                bodyLines.push(`    ${call[1]}(${args});`);
                continue;
            }
            // عبارة عامة (تحكّم / DOM)
            let generic = st
                .replace(/(['"])\$\{([\s\S]*?)\}([^'"]*)\1/g, (m, q, g1, tail) => {
                    const n = `p${ctx.pi++}`;
                    ctx.params.push(n);
                    ctx.argAttrs.push(`data-karim-arg${ctx.pi - 1}="\${${g1}}"`);
                    return tail ? `${n} + ${q}${tail}${q}` : n;
                })
                .replace(/\bthis\.value\b/g, () => {const n = `p${ctx.pi++}`; ctx.params.push(n); ctx.passNames.push('value'); return n;})
                .replace(/\bthis\.checked\b/g, () => {const n = `p${ctx.pi++}`; ctx.params.push(n); ctx.passNames.push('checked'); return n;})
                .replace(/\bevent\b/g, () => {const n = `p${ctx.pi++}`; ctx.params.push(n); ctx.passNames.push('event'); return n;});
            generic = parametrize(ctx, generic);
            bodyLines.push(`    ${generic}`);
        }

        const lastCall = [...stmts].reverse().find((s) => /^[A-Za-z_$][\w$]*\s*\(/.test(s));
        let base = 'kdAct';
        if (lastCall) {
            const n = lastCall.match(/^([A-Za-z_$][\w$]*)/)[1];
            base = `kd${n.charAt(0).toUpperCase()}${n.slice(1)}`;
        }
        let name = base;
        while (generated.some((g) => g.name === name)) {name = `${base}${++counter}`;}
        counter += 1;

        const attrs = [`data-karim-action="${name}"`];
        if (hit.event !== 'click') {attrs.push(`data-karim-event="${hit.event}"`);}
        for (const a of ctx.argAttrs) {attrs.push(a);}
        if (ctx.passNames.length) {attrs.push(`data-karim-pass="${ctx.passNames.join(',')}"`);}

        generated.push({name, params: ctx.params, lines: bodyLines});
        replacements.push({hit, attrText: ` ${attrs.join(' ')}`});
        stats.converted += 1;
    }

    if (!replacements.length) {continue;}

    let out = src;
    for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        out = out.slice(0, r.hit.index) + r.attrText + out.slice(r.hit.index + r.hit.full.length);
    }

    const funcs = generated.map((g) => {
        // بلا export: نضيف الأسماء لقائمة التصدير أدناه — والاختبارات التي
        // تقرأ المصدر وتبنيه بـ new Function تبقى صالحة.
        const decl = `function ${g.name}(${g.params.join(', ')}) {`;
        return `${decl}\n${g.lines.join('\n')}\n}\n`;
    }).join('\n');
    const block = `/* ─── إجراءات مولَّدة (تفويض بدل معالجات سطرية) ─── */\n${funcs}\n`;
    const names = generated.map((g) => g.name);
    const exportIdx = out.search(/^\s*export\s*\{/m);
    if (exportIdx > -1) {
        out = out.slice(0, exportIdx) + block + out.slice(exportIdx);
        // نضيف الأسماء المولَّدة إلى قائمة التصدير (كي يصلها التفويض عبر window)
        out = out.replace(/export\s*\{([^}]*)\}/, (m, inner) => {
            const have = inner.split(',').map((x) => x.trim()).filter(Boolean);
            const add = names.filter((n) => !have.includes(n));
            return `export {${have.join(', ')}${add.length ? ', ' + add.join(', ') : ''} };`;
        });
    } else {out = out.replace(/\s*$/, '\n\n') + block;}

    if (APPLY) {fs.writeFileSync(file, out, 'utf8');}
}

console.log(`\nمُحوَّل: ${stats.converted} · متروك: ${stats.skipped}${APPLY ? ' (تم الكتابة)' : ' (dry-run)'}`);
if (skipped.length) {
    console.log('\n── المتروك (يدوي) ──');
    for (const s of skipped.slice(0, 12)) {
        console.log(`  ${path.relative(ROOT, s.file).split(path.sep).join('/')}  ${s.hit.body.slice(0, 80)}`);
    }
}
