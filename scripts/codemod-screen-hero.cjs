'use strict';
/**
 * codemod-screen-hero.cjs — تعميم ScreenHero على شاشات V3 (لغة كريم، 2026-11-21).
 *
 * Pass A: `<ReportHeader title english description pending onRefresh />` (ذاتي الإغلاق)
 *         ⇒ ScreenHero بنفس النصوص حرفيًا + زر تحديث في فتحة الإجراءات
 *           (disabled=pending، onClick=onRefresh) — وحذف الاستيراد الميت.
 * Pass B: الرؤوس اليدوية الموحدة `<header><div><h1>عربي<span>إنجليزي</span></h1>
 *         <p>وصف</p></div><div data-erp-print-hide>إجراءات</div></header>`
 *         ⇒ ScreenHero بنفس النصوص والإجراءات كما هي.
 * Pass C: إن كان شريط `<ul aria-label="مؤشرات…">` يلي الـHero مباشرة
 *         (مسافة بينهما فقط) يُنقل إلى فتحة `answer` — «الجواب أولًا».
 *
 * القواعد: العناوين ذات التعابير ({name}…) تُتخطى وتُسجّل يدوية؛ لا يُلمس
 * سوى ما يطابق الأنماط؛ كل ملف يُعاد كتابته مرة واحدة مع سجل التغييرات.
 *
 * الاستعمال: node scripts/codemod-screen-hero.cjs <ملف…|مجلد>
 */
const fs = require('fs');
const path = require('path');

const targets = [];
for (const arg of process.argv.slice(2)) {
    const stat = fs.statSync(arg);
    if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(arg, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
                targets.push(path.join(arg, entry.name));
            }
        }
    } else {
        targets.push(arg);
    }
}

/** يستخرج قيمة خاصية JSX من كتلة الخصائص — يدعم الأقواس المتوازنة لـ{}. */
function extractProp(blob, name) {
    const opening = blob.indexOf(`${name}=`);
    if (opening === -1) {
        return null;
    }
    let i = opening + name.length + 1;
    while (blob[i] === ' ') { i += 1; }
    if (blob[i] === '"') {
        const end = blob.indexOf('"', i + 1);
        return { value: blob.slice(i + 1, end), quoted: true };
    }
    if (blob[i] === '{') {
        let depth = 0;
        const start = i + 1;
        for (; i < blob.length; i += 1) {
            if (blob[i] === '{') { depth += 1; }
            if (blob[i] === '}') {
                depth -= 1;
                if (depth === 0) {
                    return { value: blob.slice(start, i).trim(), quoted: false };
                }
            }
        }
    }
    return null;
}

function screenHeroFromReportHeader(block, indent) {
    const title = extractProp(block, 'title');
    const english = extractProp(block, 'english');
    const description = extractProp(block, 'description');
    const pending = extractProp(block, 'pending');
    const onRefresh = extractProp(block, 'onRefresh');
    if (!title || !title.quoted || !onRefresh) {
        return null; // عنوان بتعابير أو بلا تحديث — يدوي.
    }
    const pad = (s) => `${indent}    ${s}`;
    const lines = [];
    lines.push('<ScreenHero');
    lines.push(pad(`title="${title.value}"`));
    if (english) {
        lines.push(pad(`english="${english.value}"`));
    }
    if (description) {
        lines.push(pad(`description="${description.value}"`));
    }
    lines.push(pad('actions={'));
    lines.push(pad('    <>'));
    lines.push(pad('        <button'));
    lines.push(pad('            type="button"'));
    lines.push(pad(`            onClick={() => { ${onRefresh.value} }}`));
    lines.push(pending ? pad(`            disabled={${pending.value}}`) : pad('            disabled={false}'));
    lines.push(pad('            className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"'));
    lines.push(pad('        >'));
    lines.push(pad('            تحديث'));
    lines.push(pad('        </button>'));
    lines.push(pad('    </>'));
    lines.push(pad('}'));
    lines.push(`${indent}/>`);
    return lines.join('\n');
}

function passA(src) {
    const reportHeaderRe = /[ \t]*<ReportHeader\b[\s\S]*?\/>\r?\n/g;
    let count = 0;
    let out = src;
    out = out.replace(reportHeaderRe, (match) => {
        const indentMatch = /^[ \t]*/.exec(match);
        const indent = indentMatch ? indentMatch[0] : '';
        const hero = screenHeroFromReportHeader(match, indent);
        if (hero === null) {
            return match;
        }
        count += 1;
        return `${hero}\n`;
    });
    // حذف ReportHeader من الاستيراد (المصدر: components/Reports)
    out = out.replace(/^(\s*import \{[^}]*?)\bReportHeader,\s*/m, '$1');
    out = out.replace(/^(\s*import \{[^}]*?), ReportHeader/m, '$1');
    return { src: out, count };
}

function extractText(jsx) {
    return jsx
        .replace(/<span[^>]*>[\s\S]*?<\/span>/g, '')
        .replace(/\{' '\}/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** يجد نهاية وسم متوازن (عداد فتح/إغلاق لنفس الوسم) من موضع فتحه. */
function balancedClose(src, openIdx, tag) {
    const openRe = new RegExp(`<${tag}(\\s|>)`, 'g');
    const closeRe = new RegExp(`</${tag}>`, 'g');
    openRe.lastIndex = openIdx + 1;
    let depth = 1;
    let open;
    const closes = [];
    while ((open = openRe.exec(src)) !== null) {
        depth += 1;
    }
    while ((closeRe.exec(src)) !== null) {
        closes.push(closeRe.lastIndex);
    }
    // الطريقة الأدق: مسح متسلسل لكلا النمطين بالترتيب
    const tokens = [];
    openRe.lastIndex = openIdx + 1;
    while ((open = openRe.exec(src)) !== null) {
        tokens.push({ at: open.index, open: true });
    }
    let closeScan = /<\/div>/g;
    closeScan.lastIndex = openIdx + 1;
    let close;
    while ((close = closeScan.exec(src)) !== null) {
        tokens.push({ at: close.index + close[0].length, open: false });
    }
    tokens.sort((x, y) => x.at - y.at);
    for (const token of tokens) {
        depth += token.open ? 1 : -1;
        if (depth === 0) {
            return token.at;
        }
    }
    return -1;
}

function passB(src) {
    // رأس يدوي: أي <header> يحوي <h1 className="text-display-lg text-ink"> —
    // استخراج بالمسح المتوازن (div/header) ليتحمل الإجراءات المتشعبة.
    let count = 0;
    const skipped = [];
    let out = '';
    let cursor = 0;
    const H1 = '<h1 className="text-display-lg text-ink">';
    while (true) {
        const h1At = src.indexOf(H1, cursor);
        if (h1At === -1) {
            out += src.slice(cursor);
            break;
        }
        const headerAt = src.lastIndexOf('<header', h1At);
        const between = src.slice(headerAt === -1 ? cursor : headerAt, h1At);
        if (headerAt === -1 || headerAt < cursor || between.includes('ScreenHero') || between.length > 400) {
            out += src.slice(cursor, h1At + H1.length);
            cursor = h1At + H1.length;
            continue;
        }
        const headerEnd = src.indexOf('</header>', h1At);
        if (headerEnd === -1) {
            out += src.slice(cursor, h1At + H1.length);
            cursor = h1At + H1.length;
            continue;
        }
        const headerBlock = src.slice(headerAt, headerEnd + '</header>'.length);
        const afterHeader = src.indexOf('<', headerEnd + 1);
        const h1Inner = headerBlock.slice(headerBlock.indexOf(H1) + H1.length, headerBlock.indexOf('</h1>'));
        const title = extractText(h1Inner);
        const englishMatch = /<span[^>]*dir="ltr"[^>]*lang="en"[^>]*>([\s\S]*?)<\/span>/.exec(h1Inner);
        const english = englishMatch ? englishMatch[1].trim() : '';
        const descMatch = /<p className="[^"]*text-muted[^"]*">([\s\S]*?)<\/p>/.exec(headerBlock.slice(headerBlock.indexOf('</h1>')));
        const descRaw = descMatch ? descMatch[1] : '';
        const descText = extractText(descRaw);
        const printHideAt = headerBlock.indexOf('data-erp-print-hide');
        let actionsInner = '';
        if (printHideAt !== -1) {
            const divAt = headerBlock.lastIndexOf('<div', printHideAt);
            const closeAt = balancedClose(headerBlock, divAt, 'div');
            if (closeAt !== -1) {
                const block = headerBlock.slice(divAt, closeAt);
                actionsInner = block.replace(/^[ \t]*<div[^>]*>\r?\n/, '').replace(/\r?\n[ \t]*<\/div>\s*$/, '');
            }
        }
        if (!title || title.includes('{') || title.includes('<') || !actionsInner) {
            skipped.push(title.slice(0, 30) || '(بلا عنوان)');
            out += src.slice(cursor, headerEnd + '</header>'.length);
            cursor = headerEnd + '</header>'.length;
            continue;
        }
        const indent = /^[ \t]*/.exec(headerBlock)[0];
        const pad = (s) => `${indent}    ${s}`;
        const lines = [];
        lines.push('<ScreenHero');
        lines.push(pad(`title="${title}"`));
        if (english) {
            lines.push(pad(`english="${english}"`));
        }
        if (descText && !descText.includes('{')) {
            lines.push(pad(`description="${descText.replace(/"/g, '&quot;')}"`));
        } else if (descRaw.trim()) {
            lines.push(pad(`description={<>${descRaw.trim()}</>}`));
        }
        lines.push(pad('actions={<>'));
        for (const line of actionsInner.split('\n')) {
            lines.push(pad(`    ${line.trim()}`));
        }
        lines.push(pad('</>'));
        lines.push(`${indent}/>`);
        out += src.slice(cursor, headerAt) + lines.join('\n') + '\n';
        cursor = headerEnd + '</header>'.length;
        count += 1;
    }
    return { src: out, count, skipped };
}

/** Pass C: نقل شريط المؤشرات الملاصق للـHero إلى فتحة answer. */
function passC(src) {
    const re = /(<ScreenHero[\s\S]*?^)([ \t]*\/>)(\r?\n)([ \t]*)(<ul className="grid list-none gap-sm[^"]*" aria-label="مؤشرات[^"]*">[\s\S]*?<\/ul>)/gm;
    let count = 0;
    const out = src.replace(re, (match, head, close, nl, indent, ulBlock) => {
        // أدخل answer={…} قبل الإغلاق: نحول `/>` إلى `answer={…}\n{indent}/>`.
        const ulLines = ulBlock.split('\n').map((line, index) => (index === 0 ? line : `    ${line}`)).join('\n');
        count += 1;
        return `${head}${indent}answer={${nl}${indent}    ${ulBlock.replace(/\r?\n/g, `\n${indent}    `)}\n${indent}}\n${close}${nl}`;
    });
    return { src: out, count };
}

let totals = { a: 0, b: 0, c: 0, files: 0 };
for (const file of targets) {
    const original = fs.readFileSync(file, 'utf8');
    let src = original;
    const log = [];
    const a = passA(src);
    if (a.count) { log.push(`A:${a.count}`); src = a.src; totals.a += a.count; }
    const b = passB(src);
    if (b.count) { log.push(`B:${b.count}`); src = b.src; totals.b += b.count; }
    if (b.skipped.length) { log.push(`تخطي يدوي: ${b.skipped.join(' · ')}`); }
    const c = passC(src);
    if (c.count) { log.push(`C:${c.count}`); src = c.src; totals.c += c.count; }
    if (src !== original) {
        fs.writeFileSync(file, src, 'utf8');
        totals.files += 1;
        console.log(`[hero] ${path.relative(process.cwd(), file)} — ${log.join(' · ')}`);
    }
}
console.log(`[hero] الإجمالي: ملفات ${totals.files} · A(ReportHeader)=${totals.a} · B(يدوي)=${totals.b} · C(جواب)=${totals.c}`);
