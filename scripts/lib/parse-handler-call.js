/**
 * parse-handler-call.js — محلّل استدعاء داخل معالج سطري (دقيق مع template literals)
 * ══════════════════════════════════════════════════════════════════════
 * النموذج الصحيح: جسم المعالج (قيمة سمة HTML) قد يحتوي على است interpolations
 * من قوالب JS مثل:
 *     openNotification('${String(n.id).replace(/'/g, "'")}')
 * ⇒ الاقتباسات هنا **ليست** محدّدات نصوص (هي نص عادي داخل القالب)، والـ regex
 * داخل التعبير Contains أقواسًا-single quotes. لذلك:
 *   1) نُخفي كل `${...}` (مع احترام النصوص والـregex داخل التعبير) بعنصر نائب.
 *   2) على النص المُخفي نُحلّل الاستدعاءات والوسائط كما هي JS عادية.
 *   3) نُعيد تركيب الوسائط الديناميكية من نصها الأصلي.
 */

/** يخفي كل است interpolations `${...}` ⇒ placeholders[n] = النص الأصلي. */
function maskTemplates(body) {
    const placeholders = [];
    let out = '';
    let i = 0;
    while (i < body.length) {
        const ch = body[i];
        if (ch === '$' && body[i + 1] === '{') {
            let depth = 1;
            let j = i + 2;
            let quote = null;
            let inRegex = false;
            while (j < body.length && depth > 0) {
                const c = body[j];
                if (quote) {
                    if (c === quote && body[j - 1] !== '\\') {quote = null;}
                    j++;
                    continue;
                }
                if (inRegex) {
                    if (c === '\\') {j += 2; continue;}
                    if (c === '/') {inRegex = false;}
                    j++;
                    continue;
                }
                if (c === '"' || c === "'" || c === '`') {quote = c; j++; continue;}
                if (c === '/' && regexCanStartHere(body.slice(i + 2, j))) {inRegex = true; j++; continue;}
                if (c === '{') {depth++;}
                else if (c === '}') {depth--; if (depth === 0) {j++; break;}}
                j++;
            }
            const inner = body.slice(i + 2, j - 1);   // جوهر التعبير
            placeholders.push(inner);
            out += `\uE000${placeholders.length - 1}\uE000`;
            i = j;
            continue;
        }
        out += ch;
        i++;
    }
    return { text: out, placeholders };
}

/** هل يمكن أن يبدأ `/` هنا literal regex؟ */
function regexCanStartHere(before) {
    const trimmed = before.replace(/\s+$/, '');
    if (!trimmed) {return true;}
    const last = trimmed[trimmed.length - 1];
    if (/[A-Za-z0-9_$)\]]/.test(last)) {return false;}
    return true;
}

/** حدّ العبارة: الفاصلة المنقوطة التالية على المستوى الأعلى (أو نهاية النص). */
function statementEnd(text, from) {
    let depth = 0;
    let quote = null;
    for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === quote && text[i - 1] !== '\\') {quote = null;}
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {quote = ch; continue;}
        if ('([{'.includes(ch)) {depth++; continue;}
        if (')]}'.includes(ch)) {depth--; continue;}
        if (ch === ';' && depth === 0) {return i;}
    }
    return text.length;
}

/** يقسّم نص الوسائط على الفواصل顶层 (خارج الأقواس والنصوص). */
function splitArgs(text) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let current = '';
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
 * يحلّل جسم المعالج ⇒ قائمة استدعاءات + منع.
 * @param {string} body نص المعالج (بدون on*="")
 * @returns {{calls:Array<{name:string,args:Array<{kind:'literal'|'dynamic',text:string,value?:any}>}>, prevent:boolean}|null}
 */
function parseHandlerCalls(body) {
    const src = String(body || '').trim();
    if (!src) {return null;}
    const { text: masked, placeholders } = maskTemplates(src);

    const calls = [];
    let pos = 0;
    let prevent = false;
    let stop = false;
    const assignments = [];

    while (pos < masked.length) {
        while (pos < masked.length && /[\s;]/.test(masked[pos])) {pos++;}
        if (pos >= masked.length) {break;}
        const rest = masked.slice(pos);
        if (/^return\s+false/i.test(rest)) {prevent = true; break;}
        if (/^return\b/i.test(rest)) {break;}
        // event.stopPropagation() / event.preventDefault() ⇒ أعلام
        if (/^event\s*\.\s*stopPropagation\s*\(\s*\)/i.test(rest)) {
            stop = true;
            pos += rest.match(/^event\s*\.\s*stopPropagation\s*\(\s*\)\s*;?/i)[0].length;
            continue;
        }
        if (/^event\s*\.\s*preventDefault\s*\(\s*\)/i.test(rest)) {
            prevent = true;
            pos += rest.match(/^event\s*\.\s*preventDefault\s*\(\s*\)\s*;?/i)[0].length;
            continue;
        }

        const nameMatch = rest.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/);
        if (!nameMatch) {
            // عبارة تعيين: name = expr  (وليس ==)
            const assign = rest.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=(?!=)/);
            if (assign) {
                const exprStart = assign[0].length;
                const end = statementEnd(masked, pos + exprStart);
                const expr = masked.slice(pos + exprStart, end).trim();
                assignments.push({ target: assign[1], expr });
                pos = end < masked.length ? end + 1 : masked.length;
                continue;
            }
            return null;
        }
        const name = nameMatch[1];
        let i = pos + nameMatch[0].length - 1;
        let depth = 0;
        let quote = null;
        let argsRaw = '';
        for (; i < masked.length; i++) {
            const ch = masked[i];
            if (quote) {
                argsRaw += ch;
                if (ch === quote && masked[i - 1] !== '\\') {quote = null;}
                continue;
            }
            if (ch === '"' || ch === "'") {quote = ch; argsRaw += ch; continue;}
            if (ch === '(' || ch === '[' || ch === '{') {
                depth++;
                if (depth === 1) {continue;}
                argsRaw += ch;
                continue;
            }
            if (ch === ')' || ch === ']' || ch === '}') {
                depth--;
                if (depth === 0) {break;}
                argsRaw += ch;
                continue;
            }
            argsRaw += ch;
        }
        if (depth !== 0) {return null;}

        const args = splitArgs(argsRaw).map((raw) => {
            const dyn = raw.match(/^['"]?\uE000(\d+)\uE000['"]?$/);
            if (dyn) {
                return { kind: 'dynamic', text: `\${${placeholders[Number(dyn[1])]}}` };
            }
            return { kind: 'literal', text: raw };
        });
        calls.push({ name, args });
        pos = i + 1;
    }

    if (!calls.length && !assignments.length) {return null;}
    return { calls, prevent, stop, assignments };
}

module.exports = { parseHandlerCalls, maskTemplates, splitArgs };
