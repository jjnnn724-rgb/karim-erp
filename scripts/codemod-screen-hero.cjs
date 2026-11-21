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

function passB(src) {
    // رأس يدوي موحّد: <header …><div><h1 …>…</h1>[<p …>وصف</p>]</div>
    // [<div …data-erp-print-hide…>إجراءات</div>]</header>
    const headerRe = /^[ \t]*<header className="[^"]*">\r?\n([ \t]*)<div>\r?\n([ \t]*)<h1 className="text-display-lg text-ink">([\s\S]*?)<\/h1>\r?\n(?:[ \t]*<p className="[^"]*text-muted[^"]*">([^<]*?)<\/p>\r?\n)?[ \t]*<\/div>\r?\n([ \t]*<div className="flex[^"]*" data-erp-print-hide>[\s\S]*?<\/div>)\r?\n?[ \t]*<\/header>\r?\n?/gm;
    let count = 0;
    const skipped = [];
    const out = src.replace(headerRe, (match, indent1, indent2, h1Inner, desc, actionsBlock) => {
        const title = extractText(h1Inner);
        const englishMatch = /<span[^>]*dir="ltr"[^>]*lang="en"[^>]*>([\s\S]*?)<\/span>/.exec(h1Inner);
        const english = englishMatch ? englishMatch[1].trim() : '';
        if (!title || title.includes('{') || title.includes('<')) {
            skipped.push(title.slice(0, 30));
            return match;
        }
        const indent = /^[ \t]*/.exec(match)[0];
        const pad = (s) => `${indent}    ${s}`;
        const lines = [];
        lines.push('<ScreenHero');
        lines.push(pad(`title="${title}"`));
        if (english) {
            lines.push(pad(`english="${english}"`));
        }
        if (desc && desc.trim()) {
            lines.push(pad(`description="${desc.trim().replace(/"/g, '&quot;')}"`));
        }
        // الإجراءات كما هي — نزيل غلافها الخارجي ونحتفظ بالمحتوى بإزاحة ثابتة
        const actionsInner = actionsBlock.replace(/^[ \t]*<div[^>]*>\r?\n/, '').replace(/\r?\n[ \t]*<\/div>\s*$/, '');
        lines.push(pad('actions={<>'));
        for (const line of actionsInner.split('\n')) {
            lines.push(pad(`    ${line.trim()}`));
        }
        lines.push(pad('</>'));
        lines.push(`${indent}/>`);
        count += 1;
        return `${lines.join('\n')}\n`;
    });
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
