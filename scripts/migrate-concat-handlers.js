#!/usr/bin/env node
'use strict';
/**
 * migrate-concat-handlers.js — تحويل المعالجات داخل سلاسل مُدمجة
 * ══════════════════════════════════════════════════════════════════════
 * حالات لم يلتقطها المولّد الأول لأن السمة مبنية بدمج سلاسل JS:
 *     + '<input ... onchange="rosterMarkDirty(\'' + esc(x) + '\')">'
 * هنا النمط نصّي بحت ⇒ التحويل آمن (نفس قواعد المولّد: literals ⇒ JSON،
 * و${…} ⇒ data-karim-argN).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const APPLY = process.argv.includes('--apply');

// on<event>="fn(args)"  (الاقتباس المزدوج، لا اقتباس داخلي غير مهرَّب)
const RE = /on(click|change|input|submit|keydown)\s*=\s*(["'])([A-Za-z_$][\w$]*)\(([^)]*)\)\2/g;

let converted = 0;
const changed = [];

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
    const out = src.replace(RE, (m, event, attrQuote, name, argsRaw) => {
        // نقسّم الوسائط على الفواصل (خارج الأقواس)
        const args = [];
        let depth = 0; let quote = null; let cur = '';
        for (let i = 0; i < argsRaw.length; i++) {
            const ch = argsRaw[i];
            if (quote) {
                cur += ch;
                if (ch === quote && argsRaw[i - 1] !== '\\') {quote = null;}
                continue;
            }
            if (ch === '"' || ch === "'") {quote = ch; cur += ch; continue;}
            if ('([{'.includes(ch)) {depth++; cur += ch; continue;}
            if (')]}'.includes(ch)) {depth--; cur += ch; continue;}
            if (ch === ',' && depth === 0) {args.push(cur.trim()); cur = ''; continue;}
            cur += ch;
        }
        if (cur.trim()) {args.push(cur.trim());}
        if (!args.length) {return m;}

        const jsonParts = [];
        const argAttrs = [];
        const passNames = [];
        let pi = 0;
        let ok = true;
        for (const a of args) {
            const t = a.trim();
            const dyn = t.match(/^\$\{([\s\S]*)\}$/);
            const quotedTpl = t.match(/^(['"])\$\{([\s\S]*)\}\1$/);
            if (dyn) {
                argAttrs.push(`data-karim-arg${pi}="\${${dyn[1]}}"`);
                pi++;
                jsonParts.push(null);
                continue;
            }
            if (quotedTpl) {
                argAttrs.push(`data-karim-arg${pi}="\${${quotedTpl[2]}}"`);
                pi++;
                jsonParts.push(null);
                continue;
            }
            if (/^'/.test(t)) {jsonParts.push(`"${t.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`); continue;}
            if (/^"/.test(t)) {jsonParts.push(`"${t.slice(1, -1).replace(/"/g, '\\"')}"`); continue;}
            if (/^-?\d+(\.\d+)?$|^true$|^false$|^null$/.test(t)) {jsonParts.push(t); continue;}
            if (t === 'this' || t === 'element') {passNames.push('element'); jsonParts.push(null); continue;}
            const thisProp = t.match(/^this\.(\w+)$/);
            if (thisProp) {passNames.push(thisProp[1]); jsonParts.push(null); continue;}
            ok = false;
            break;
        }
        if (!ok) {return m;}

        const attrs = [`data-karim-action="${name}"`];
        if (event !== 'click') {attrs.push(`data-karim-event="${event}"`);}
        // الوسائط الحرفية في JSON، والديناميكية في argN (ترتيبها كما ورد)
        const literals = jsonParts.filter((x) => x !== null);
        if (literals.length) {
            attrs.push(`data-karim-args="[${literals.join(',').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}]"`);
        }
        for (const a of argAttrs) {attrs.push(a);}
        if (passNames.length) {attrs.push(`data-karim-pass="${passNames.join(',')}"`);}
        converted++;
        return attrs.join(' ');
    });
    if (out !== src) {
        changed.push(path.relative(ROOT, file).split(path.sep).join('/'));
        if (APPLY) {fs.writeFileSync(file, out, 'utf8');}
    }
}

console.log(`\nمُحوَّل: ${converted} · ملفات: ${changed.length}${APPLY ? ' (تم الكتابة)' : ' (dry-run)'}`);
for (const f of changed) {console.log(`  ${f}`);}
