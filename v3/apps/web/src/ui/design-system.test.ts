import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حارس مكتبة المكوّنات — المرحلة 6.
 *
 * `design-tokens.test.ts` يحرس **اللغة** (ألوان، خطوط، مسافات). هذا الملف يحرس
 * **المكتبة** نفسها، فلا تتحوّل بمرور الوقت إلى مجموعة ملفات بلا عقد:
 *
 *   ١) لكل مكوّن ملف اختبار شقيق — لا مكوّن بلا بوابة.
 *   ٢) `index.ts` يصدّر كل مكوّن عام — المصدر الواحد للاستيراد.
 *   ٣) لا لون خام في `src/ui` — الألوان رموز فقط (الوضع الداكن يتبع تلقائيًا).
 *   ٤) لا أسماء هوية تاريخية (`brass`/`copper`/شامبانيا/ياقوت) في المكتبة.
 *   ٥) لا أدوات اتجاه فيزيائية (`ml-`/`text-left`) — RTL أولًا.
 *
 * الاستثناءات معلنة هنا صراحةً ولا تُوسَّع بغير سبب مكتوب.
 */

const UI = dirname(fileURLToPath(import.meta.url));

/** وحدة أيقونات لا مكوّن، و`chart-impl` تفصيل داخلي يُختبر عبر `Chart`. */
const NOT_A_COMPONENT = new Set(['icons.tsx', 'chart-impl.tsx']);

/** مكوّنات تُختبر داخل ملف شقيق آخر — لا تُبحث لها بوابة مستقلة. */
const CO_TESTED: Readonly<Record<string, string>> = {
    'ThemeToggle.tsx': 'ThemeProvider.test.tsx',
};

/**
 * الثوابت الاحتياطية في `SignaturePad` تُستهلك في Canvas لا في CSS، فلا بديل
 * عن قيمة ملموسة إن غاب `getComputedStyle`. مطابقة لعقد DESIGN.md.
 */
const COLOR_ALLOW_LIST: Readonly<Record<string, readonly string[]>> = {
    'SignaturePad.tsx': ['#172B3B', '#0F766E', '#596E80', '#FFFFFF'],
};

const files = readdirSync(UI, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

/** كل مصدر المكتبة (لا اختبارات — وحارسها أولها). */
const SOURCES = files.filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx'));

const components = files
    .filter((name) => name.endsWith('.tsx'))
    .filter((name) => !name.endsWith('.test.tsx'))
    .filter((name) => !NOT_A_COMPONENT.has(name));

function read(name: string): string {
    return readFileSync(join(UI, name), 'utf8');
}

/** يزيل التعليقات حتى لا يحاكم الحارس نصًّا توثيقيًا. */
function code(name: string): string {
    return read(name)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

describe('مكتبة المكوّنات — العقد', () => {
    it('لكل مكوّن ملف اختبار شقيق', () => {
        const missing = components.filter((name) => !CO_TESTED[name] && !files.includes(name.replace(/\.tsx$/, '.test.tsx')));
        expect(missing).toEqual([]);
    });

    it('كل ملف اختبار له مكوّن حيّ (لا اختبار يتيم)', () => {
        const orphans = files
            .filter((name) => name.endsWith('.test.tsx'))
            .filter((name) => !components.includes(name.replace(/\.test\.tsx$/, '.tsx')))
            .filter((name) => !(name === 'ThemeProvider.test.tsx' && files.includes('ThemeToggle.tsx')));
        expect(orphans).toEqual([]);
    });

    it('index.ts يصدّر كل مكوّن عام بالاسم نفسه', () => {
        const barrel = code('index.ts');
        const notExported = components
            .filter((name) => !barrel.includes(`from './${name.replace(/\.tsx$/, '')}'`))
            .map((name) => name.replace(/\.tsx$/, ''));
        expect(notExported).toEqual([]);
    });

    it('كل استثناء في القائمة ما زال موجودًا (لا استثناء ميت)', () => {
        for (const name of [...NOT_A_COMPONENT, ...Object.keys(CO_TESTED), ...Object.keys(COLOR_ALLOW_LIST)]) {
            expect(files, `الاستثناء ${name} يشير إلى ملف غير موجود`).toContain(name);
        }
    });
});

describe('مكتبة المكوّنات — الألوان', () => {
    it('لا لون خام خارج ثوابت Canvas المعلنة', () => {
        const raw = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/;
        const offenders: string[] = [];

        for (const name of SOURCES) {
            const allowed = COLOR_ALLOW_LIST[name] ?? [];
            const source = code(name);
            const hits = source.match(new RegExp(raw.source, 'g')) ?? [];
            const unexpected = hits.filter((hit) => !allowed.includes(hit.toUpperCase()));
            if (unexpected.length > 0) offenders.push(`${name}: ${[...new Set(unexpected)].join(', ')}`);
        }

        expect(offenders).toEqual([]);
    });

    it('لا تعتمد مكوّنات المكتبة على لون محدَّد في الوضعين', () => {
        const offenders = SOURCES.filter((name) => /\b(dark|light):/.test(code(name))).map((name) => name);
        expect(offenders).toEqual([]);
    });
});

describe('مكتبة المكوّنات — الهوية والاتجاه', () => {
    it('لا أسماء هوية تاريخية ولا وصف للهوية القديمة', () => {
        const stale = /brass|copper|شامبانيا|ياقوت/i;
        const offenders = SOURCES.filter((name) => stale.test(code(name))).map((name) => name);
        expect(offenders).toEqual([]);
    });

    it('لا أدوات اتجاه فيزيائية — كل شيء منطقي (RTL أولًا)', () => {
        const physical = /(?:^|[\s"'`])(?:m[lr]|p[lr]|left|right|border-[lr]|rounded-[lr])-|text-(?:left|right)\b/;
        const offenders = SOURCES.filter((name) => physical.test(code(name))).map((name) => name);
        expect(offenders).toEqual([]);
    });

    it('لا لون نصّي أبيض/أسود صريح في المكوّنات', () => {
        const offenders = SOURCES.filter((name) => /\b(?:bg|text|border)-(?:white|black)\b/.test(code(name))).map((name) => name);
        expect(offenders).toEqual([]);
    });
});
